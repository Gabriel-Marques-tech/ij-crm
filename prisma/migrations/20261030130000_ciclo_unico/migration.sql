-- GAB-81: ciclo único do Projeto (spec fase 2 §4.1/§4.2).
--
-- ANTES DO DEPLOY: pg_dump de produção (docs/runbook.md, "Ciclo único (GAB-81)").
-- Rollback = restaurar esse dump; esta migration não tem "down".
--
-- Sem BEGIN/COMMIT explícitos: o Prisma roda o arquivo como um script só (transação
-- implícita do Postgres), então qualquer erro desfaz tudo e a mensagem
-- ("ciclo único: …") aparece no P3018 do `migrate deploy`. RAISE NOTICE não aparece
-- no log do deploy: confira com scripts/verificar-ciclo-unico.sql.
--
-- O que faz, tudo ou nada:
-- 1. Schema (só ADITIVO; nada é removido): enum "Marco", fase.marco (único),
--    oportunidade.absorvido_por_id e oportunidade.vendedor_id (FKs, índices).
-- 2. Marcos: em cada quadro, a fase que vira cada marco — adotada pela chave da v1
--    (montando_contrato, contrato_assinado, perdido, finalizado; proposta/handoff/
--    execucao se a gestão já tiver criado com essa chave e tipo) ou, para os
--    terminais, a 1ª fase ativa do mesmo tipo; senão é criada. Marco adotado
--    arquivado volta a ficar ativo.
-- 3. Ordem das fases ATIVAS de cada quadro, preservando a posição relativa das
--    subfases (fases sem marco) e respeitando a ordem fixa dos marcos:
--      Vendas:   [subfases antes de Montando contrato] Proposta, Montando contrato,
--                [subfases abertas depois dele] Ganho, [outros terminais] Perdido
--      Projetos: Handoff, Execução, [subfases abertas] Finalizado, [outros terminais]
-- 4. Cada par venda → card de projetos (origem_oportunidade_id) vira UM Projeto: a
--    VENDA sobrevive (id, criado_em, criado_via, pipefy_id); Timeline,
--    TransicaoFase, prazos, mensagens enviadas e reaberturas do card de projetos
--    passam para ela. Posição (quadro/fase/fase_desde), responsável, próxima ação,
--    revisar, título e lixeira vêm do lado "atual" (regra abaixo; quando é o
--    projeto, a próxima ação vazia cai para a da venda e revisar = OU dos dois);
--    os demais campos vêm dele com o outro como reserva (COALESCE); descrições
--    diferentes são concatenadas (se passar de 5000 caracteres, fica a da venda e
--    a do projeto vira uma NOTA na Timeline). vendedor_id = responsável da venda
--    (quem ganhou). O card de projetos NÃO é apagado: fica com
--    absorvido_por_id = venda e deletado_em preenchido (fora de todas as telas e
--    da lixeira). A venda ganha uma Timeline VINCULO_PROJETO { evento:
--    "ciclo_unico", projetoAbsorvidoId, antes: <linha da venda antes da união> }
--    datada com o último `em` das Timelines do par (não o instante do deploy), e
--    atualizado_em = o maior dos dois. Cards de projetos sem origem ficam como estão.
--    EXCEÇÃO (decisão do usuário, "não unidos"): venda fora do Ganho (reaberta ou
--    perdida depois do ganho) com o card de projetos vivo → NÃO une. Os dois seguem
--    como Projetos separados, cada um no seu quadro; origem_oportunidade_id fica
--    intacto (não destrutivo, @unique continua válido) e cada um ganha uma Timeline
--    VINCULO_PROJETO { evento: "ciclo_unico_nao_unido", ... } (uma vez só). Projeto
--    na lixeira segue a regra normal (une).
-- 5. vendedor_id = responsavel_id nos demais cards de Vendas que já têm data_ganho.
--
-- Idempotente: tudo é "se ainda não feito" (marco já existe, ordem já certa, par
-- já absorvido); rodar de novo não muda nenhuma linha. Instalação nova (sem
-- pipelines) não faz nada aqui: o seed cria os quadros já com os marcos.

-- ---------------------------------------------------------------- 1. schema

DO $tipo$ BEGIN
  CREATE TYPE "Marco" AS ENUM ('PROPOSTA', 'MONTANDO_CONTRATO', 'GANHO', 'PERDIDO', 'HANDOFF', 'EXECUCAO', 'FINALIZADO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $tipo$;

ALTER TABLE "fase" ADD COLUMN IF NOT EXISTS "marco" "Marco";
ALTER TABLE "oportunidade" ADD COLUMN IF NOT EXISTS "absorvido_por_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "fase_marco_key" ON "fase"("marco");
ALTER TABLE "oportunidade" ADD COLUMN IF NOT EXISTS "vendedor_id" TEXT;
CREATE INDEX IF NOT EXISTS "oportunidade_absorvido_por_id_idx" ON "oportunidade"("absorvido_por_id");
CREATE INDEX IF NOT EXISTS "oportunidade_vendedor_id_idx" ON "oportunidade"("vendedor_id");

DO $fk$ BEGIN
  ALTER TABLE "oportunidade" ADD CONSTRAINT "oportunidade_absorvido_por_id_fkey" FOREIGN KEY ("absorvido_por_id") REFERENCES "oportunidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;

DO $fk2$ BEGIN
  ALTER TABLE "oportunidade" ADD CONSTRAINT "oportunidade_vendedor_id_fkey" FOREIGN KEY ("vendedor_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk2$;

-- ---------------------------------------------------------------- 2–4. dados

DO $ciclo$
DECLARE
  -- Colunas timestamp(3) sem fuso guardam UTC (como o Prisma grava).
  agora      TIMESTAMP(3) := (now() AT TIME ZONE 'UTC');
  v_vendas   TEXT;
  v_proj     TEXT;
  m          RECORD;
  r          RECORD;
  pid        TEXT;
  fid        TEXT;
  chave_nova TEXT;
  n          INT;
  criadas    INT := 0;
  adotadas   INT := 0;
  unidos     INT := 0;
  nao_unidos INT := 0;
  v          oportunidade%ROWTYPE;
  p          oportunidade%ROWTYPE;
  s          oportunidade%ROWTYPE; -- lado "atual" (posição, responsável…)
  o          oportunidade%ROWTYPE; -- o outro lado (reserva)
  v_ganho    BOOLEAN;
  restos     INT;
  s_projeto  BOOLEAN;
  em_audit   TIMESTAMP(3);
  desc_nova  TEXT;
  nota_desc  BOOLEAN;
BEGIN
  SELECT id INTO v_vendas FROM pipeline WHERE chave = 'vendas';
  SELECT id INTO v_proj FROM pipeline WHERE chave = 'projetos';
  IF v_vendas IS NULL AND v_proj IS NULL THEN
    RAISE NOTICE 'ciclo único: banco sem quadros (instalação nova), nada a migrar';
    RETURN;
  END IF;
  IF v_vendas IS NULL OR v_proj IS NULL THEN
    RAISE EXCEPTION 'ciclo único: só um dos quadros vendas/projetos existe; banco fora do formato da v1';
  END IF;

  -- ---------------------------------------------------------- 2. marcos
  FOR m IN
    SELECT * FROM (VALUES
      ('PROPOSTA',          'vendas',   'proposta',          'Proposta',          NULL,      '#ffc857', 10),
      ('MONTANDO_CONTRATO', 'vendas',   'montando_contrato', 'Montando Contrato', NULL,      '#b447eb', 7),
      ('GANHO',             'vendas',   'contrato_assinado', 'Contrato assinado', 'GANHO',   '#1e9b6b', NULL),
      ('PERDIDO',           'vendas',   'perdido',           'Perdido',           'PERDIDO', '#6b7280', NULL),
      ('HANDOFF',           'projetos', 'handoff',           'Handoff',           NULL,      '#8a5cf6', 7),
      ('EXECUCAO',          'projetos', 'execucao',          'Execução',          NULL,      '#4cc9f0', NULL),
      ('FINALIZADO',        'projetos', 'finalizado',        'Finalizado',        'GANHO',   '#1e9b6b', NULL)
    ) AS t(marco, quadro, chave, nome, tipo, cor, limite)
  LOOP
    IF EXISTS (SELECT 1 FROM fase WHERE marco = m.marco::"Marco") THEN CONTINUE; END IF;
    pid := CASE m.quadro WHEN 'vendas' THEN v_vendas ELSE v_proj END;

    -- Adoção pela chave da v1, se o tipo (aberta/ganho/perdido) bate.
    fid := NULL;
    SELECT id INTO fid FROM fase
     WHERE pipeline_id = pid AND chave = m.chave AND marco IS NULL
       AND tipo_terminal IS NOT DISTINCT FROM m.tipo::"TipoTerminal";
    -- Terminais: senão, a 1ª fase ativa do mesmo tipo no quadro.
    IF fid IS NULL AND m.tipo IS NOT NULL THEN
      SELECT id INTO fid FROM fase
       WHERE pipeline_id = pid AND marco IS NULL AND arquivada_em IS NULL AND tipo_terminal = m.tipo::"TipoTerminal"
       ORDER BY ordem, criado_em, id LIMIT 1;
    END IF;

    IF fid IS NOT NULL THEN
      UPDATE fase SET marco = m.marco::"Marco", arquivada_em = NULL, atualizado_em = agora WHERE id = fid;
      adotadas := adotadas + 1;
    ELSE
      chave_nova := m.chave;
      n := 1;
      WHILE EXISTS (SELECT 1 FROM fase WHERE pipeline_id = pid AND chave = chave_nova) LOOP
        n := n + 1;
        chave_nova := m.chave || '_' || n;
      END LOOP;
      -- ordem provisória alta: a etapa 3 põe no lugar.
      INSERT INTO fase (id, pipeline_id, chave, nome, ordem, is_terminal, tipo_terminal, cor, limite_dias_alerta, marco, criado_em, atualizado_em)
      VALUES ('gab81' || replace(gen_random_uuid()::text, '-', ''), pid, chave_nova, m.nome, 100000,
              m.tipo IS NOT NULL, m.tipo::"TipoTerminal", m.cor, m.limite, m.marco::"Marco", agora, agora);
      criadas := criadas + 1;
    END IF;
  END LOOP;

  -- ---------------------------------------------------------- 3. ordem das fases ativas
  WITH mc AS (SELECT ordem, criado_em, id FROM fase WHERE marco = 'MONTANDO_CONTRATO'),
  b AS (
    SELECT f.id, f.ordem, f.criado_em,
           CASE
             WHEN f.marco = 'PROPOSTA' THEN 1
             WHEN f.marco = 'MONTANDO_CONTRATO' THEN 2
             WHEN f.marco = 'GANHO' THEN 4
             WHEN f.marco = 'PERDIDO' THEN 6
             WHEN f.tipo_terminal IS NOT NULL THEN 5
             WHEN (f.ordem, f.criado_em, f.id) < (SELECT ordem, criado_em, id FROM mc) THEN 0
             ELSE 3
           END AS bloco
      FROM fase f
     WHERE f.pipeline_id = v_vendas AND f.arquivada_em IS NULL
  ),
  nova AS (SELECT id, (ROW_NUMBER() OVER (ORDER BY bloco, ordem, criado_em, id) - 1)::int AS ordem FROM b)
  UPDATE fase f SET ordem = nova.ordem, atualizado_em = agora FROM nova WHERE f.id = nova.id AND f.ordem <> nova.ordem;

  WITH b AS (
    SELECT f.id, f.ordem, f.criado_em,
           CASE
             WHEN f.marco = 'HANDOFF' THEN 0
             WHEN f.marco = 'EXECUCAO' THEN 1
             WHEN f.marco = 'FINALIZADO' THEN 3
             WHEN f.tipo_terminal IS NOT NULL THEN 4
             ELSE 2
           END AS bloco
      FROM fase f
     WHERE f.pipeline_id = v_proj AND f.arquivada_em IS NULL
  ),
  nova AS (SELECT id, (ROW_NUMBER() OVER (ORDER BY bloco, ordem, criado_em, id) - 1)::int AS ordem FROM b)
  UPDATE fase f SET ordem = nova.ordem, atualizado_em = agora FROM nova WHERE f.id = nova.id AND f.ordem <> nova.ordem;

  -- ---------------------------------------------------------- 4a. pares NÃO unidos (só auditoria, uma vez)
  FOR r IN
    SELECT pj.id AS p_id, vd.id AS v_id, fv.nome AS v_fase,
           COALESCE((SELECT max(t.em) FROM timeline t WHERE t.oportunidade_id IN (pj.id, vd.id)), GREATEST(pj.atualizado_em, vd.atualizado_em)) AS em
      FROM oportunidade pj
      JOIN oportunidade vd ON vd.id = pj.origem_oportunidade_id
      JOIN fase fv ON fv.id = vd.fase_id
     WHERE pj.absorvido_por_id IS NULL AND vd.absorvido_por_id IS NULL
       AND pj.pipeline_id = v_proj AND vd.pipeline_id = v_vendas
       AND pj.deletado_em IS NULL AND fv.tipo_terminal IS DISTINCT FROM 'GANHO'
       AND NOT EXISTS (SELECT 1 FROM timeline t WHERE t.oportunidade_id = pj.id AND t.tipo = 'VINCULO_PROJETO' AND t.payload ->> 'evento' = 'ciclo_unico_nao_unido')
  LOOP
    INSERT INTO timeline (id, oportunidade_id, tipo, payload, usuario_id, em) VALUES
      ('gab81' || replace(gen_random_uuid()::text, '-', ''), r.p_id, 'VINCULO_PROJETO',
       jsonb_build_object('evento', 'ciclo_unico_nao_unido', 'vendaId', r.v_id, 'vendaFase', r.v_fase), NULL, r.em),
      ('gab81' || replace(gen_random_uuid()::text, '-', ''), r.v_id, 'VINCULO_PROJETO',
       jsonb_build_object('evento', 'ciclo_unico_nao_unido', 'projetoId', r.p_id, 'vendaFase', r.v_fase), NULL, r.em);
    nao_unidos := nao_unidos + 1;
  END LOOP;

  -- ---------------------------------------------------------- 4. pares venda → projeto
  FOR r IN
    SELECT pj.id AS p_id, pj.origem_oportunidade_id AS v_id
      FROM oportunidade pj
      JOIN oportunidade vd ON vd.id = pj.origem_oportunidade_id
     WHERE pj.absorvido_por_id IS NULL
       AND pj.pipeline_id = v_proj
       AND vd.pipeline_id = v_vendas
       AND vd.absorvido_por_id IS NULL
       -- não unidos (4a): venda fora do Ganho com projeto vivo
       AND NOT (pj.deletado_em IS NULL AND (SELECT f.tipo_terminal FROM fase f WHERE f.id = vd.fase_id) IS DISTINCT FROM 'GANHO')
     ORDER BY pj.criado_em, pj.id
  LOOP
    SELECT * INTO v FROM oportunidade WHERE id = r.v_id FOR UPDATE;
    SELECT * INTO p FROM oportunidade WHERE id = r.p_id FOR UPDATE;
    SELECT tipo_terminal = 'GANHO' INTO v_ganho FROM fase WHERE id = v.fase_id;

    -- Lado "atual": o que está fora da lixeira; os dois vivos (ou os dois na
    -- lixeira) → o projeto, se a venda segue ganha; se a venda foi reaberta/perdida
    -- depois do ganho, quem se moveu por último (empate → projeto).
    IF p.deletado_em IS NULL AND v.deletado_em IS NOT NULL THEN s := p; o := v;
    ELSIF v.deletado_em IS NULL AND p.deletado_em IS NOT NULL THEN s := v; o := p;
    ELSIF COALESCE(v_ganho, false) OR p.fase_desde >= v.fase_desde THEN s := p; o := v;
    ELSE s := v; o := p;
    END IF;

    s_projeto := (s.id = p.id);

    -- Descrição: venda + projeto; acima do limite do app (5000), a do projeto vira NOTA.
    desc_nova := CASE
                   WHEN v.descricao IS NULL THEN p.descricao
                   WHEN p.descricao IS NULL OR p.descricao = v.descricao THEN v.descricao
                   ELSE v.descricao || E'\n\n— Projetos —\n' || p.descricao
                 END;
    nota_desc := v.descricao IS NOT NULL AND p.descricao IS NOT NULL AND p.descricao <> v.descricao AND char_length(desc_nova) > 5000;
    IF nota_desc THEN desc_nova := v.descricao; END IF;

    -- Auditoria datada pelo próprio histórico do par, nunca pelo deploy.
    SELECT max(t.em) INTO em_audit FROM timeline t WHERE t.oportunidade_id IN (v.id, p.id);
    em_audit := COALESCE(em_audit, GREATEST(v.atualizado_em, p.atualizado_em));

    -- pipefy_id é único: sai do card de projetos antes de ir para a venda.
    IF v.pipefy_id IS NULL AND p.pipefy_id IS NOT NULL THEN
      UPDATE oportunidade SET pipefy_id = NULL WHERE id = p.id;
    END IF;

    UPDATE oportunidade SET
      pipeline_id        = s.pipeline_id,
      fase_id            = s.fase_id,
      fase_desde         = s.fase_desde,
      responsavel_id     = s.responsavel_id,
      proxima_acao       = CASE WHEN s_projeto AND s.proxima_acao IS NULL AND s.proxima_acao_em IS NULL THEN o.proxima_acao ELSE s.proxima_acao END,
      proxima_acao_em    = CASE WHEN s_projeto AND s.proxima_acao IS NULL AND s.proxima_acao_em IS NULL THEN o.proxima_acao_em ELSE s.proxima_acao_em END,
      revisar            = CASE WHEN s_projeto THEN s.revisar OR o.revisar ELSE s.revisar END,
      vendedor_id        = COALESCE(v.vendedor_id, v.responsavel_id),
      titulo             = s.titulo,
      deletado_em        = s.deletado_em,
      empresa_id         = COALESCE(s.empresa_id, o.empresa_id),
      contato_id         = COALESCE(s.contato_id, o.contato_id),
      origem             = COALESCE(s.origem, o.origem),
      dor                = COALESCE(s.dor, o.dor),
      orcamento_previsto = COALESCE(s.orcamento_previsto, o.orcamento_previsto),
      proposta_url       = COALESCE(s.proposta_url, o.proposta_url),
      cidade             = COALESCE(s.cidade, o.cidade),
      estado             = COALESCE(s.estado, o.estado),
      valor_fechado      = COALESCE(s.valor_fechado, o.valor_fechado),
      data_ganho         = COALESCE(s.data_ganho, o.data_ganho),
      motivo_perda       = COALESCE(s.motivo_perda, o.motivo_perda),
      descricao          = desc_nova,
      reaberta_de_id     = COALESCE(v.reaberta_de_id, NULLIF(p.reaberta_de_id, v.id)),
      pipefy_id          = COALESCE(v.pipefy_id, p.pipefy_id),
      atualizado_em      = GREATEST(v.atualizado_em, p.atualizado_em)
    WHERE id = v.id;

    UPDATE timeline         SET oportunidade_id = v.id WHERE oportunidade_id = p.id;
    UPDATE transicao_fase   SET oportunidade_id = v.id WHERE oportunidade_id = p.id;
    UPDATE prazo            SET oportunidade_id = v.id WHERE oportunidade_id = p.id;
    UPDATE mensagem_enviada SET oportunidade_id = v.id WHERE oportunidade_id = p.id;
    UPDATE oportunidade     SET reaberta_de_id  = v.id WHERE reaberta_de_id = p.id AND id <> v.id;

    UPDATE oportunidade SET absorvido_por_id = v.id, deletado_em = COALESCE(deletado_em, agora) WHERE id = p.id;

    INSERT INTO timeline (id, oportunidade_id, tipo, payload, usuario_id, em)
    VALUES ('gab81' || replace(gen_random_uuid()::text, '-', ''), v.id, 'VINCULO_PROJETO',
            jsonb_build_object('evento', 'ciclo_unico', 'projetoAbsorvidoId', p.id, 'antes', to_jsonb(v)), NULL, em_audit);
    IF nota_desc THEN
      INSERT INTO timeline (id, oportunidade_id, tipo, payload, usuario_id, em)
      VALUES ('gab81' || replace(gen_random_uuid()::text, '-', ''), v.id, 'NOTA',
              jsonb_build_object('texto', p.descricao, 'origem', 'ciclo_unico_descricao_projeto'), NULL, em_audit);
    END IF;
    unidos := unidos + 1;
  END LOOP;

  -- ---------------------------------------------------------- 5. vendedor dos ganhos de Vendas
  UPDATE oportunidade SET vendedor_id = responsavel_id
   WHERE pipeline_id = v_vendas AND data_ganho IS NOT NULL AND vendedor_id IS NULL AND absorvido_por_id IS NULL;

  -- ---------------------------------------------------------- conferência
  IF (SELECT count(*) FROM fase WHERE marco IS NOT NULL AND arquivada_em IS NULL) <> 7
     OR EXISTS (SELECT 1 FROM fase WHERE marco IN ('PROPOSTA', 'MONTANDO_CONTRATO', 'GANHO', 'PERDIDO') AND pipeline_id <> v_vendas)
     OR EXISTS (SELECT 1 FROM fase WHERE marco IN ('HANDOFF', 'EXECUCAO', 'FINALIZADO') AND pipeline_id <> v_proj)
     OR EXISTS (SELECT 1 FROM fase WHERE marco IN ('GANHO', 'FINALIZADO') AND tipo_terminal IS DISTINCT FROM 'GANHO')
     OR EXISTS (SELECT 1 FROM fase WHERE marco = 'PERDIDO' AND tipo_terminal IS DISTINCT FROM 'PERDIDO')
     OR EXISTS (SELECT 1 FROM fase WHERE marco IN ('PROPOSTA', 'MONTANDO_CONTRATO', 'HANDOFF', 'EXECUCAO') AND tipo_terminal IS NOT NULL) THEN
    RAISE EXCEPTION 'ciclo único: marcos inconsistentes depois da migração';
  END IF;
  SELECT count(*) INTO restos FROM oportunidade WHERE origem_oportunidade_id IS NOT NULL AND absorvido_por_id IS NULL;
  RAISE NOTICE 'ciclo único: marcos criados=%, adotados=%, pares unidos=%, não unidos (nesta execução)=%, cards com origem ainda separados=%',
    criadas, adotadas, unidos, nao_unidos, restos;
END $ciclo$;


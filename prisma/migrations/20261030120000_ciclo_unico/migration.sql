-- GAB-81: ciclo único do Projeto (spec fase 2 §4.1/§4.2).
--
-- ANTES DO DEPLOY: pg_dump de produção (docs/runbook.md, "Ciclo único (GAB-81)").
-- Rollback = restaurar esse dump; esta migration não tem "down".
--
-- O que faz, numa transação só:
-- 1. Schema (só ADITIVO; nada é removido): enum "Marco", fase.marco (único),
--    oportunidade.absorvido_por_id (FK, índice).
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
--    revisar, título e lixeira vêm do lado "atual" (regra em `lado`, abaixo); os
--    demais campos vêm dele com o outro como reserva (COALESCE); descrições
--    diferentes são concatenadas. O card de projetos NÃO é apagado: fica com
--    absorvido_por_id = venda e deletado_em preenchido (fora de todas as telas e
--    da lixeira). A venda ganha uma Timeline VINCULO_PROJETO { evento:
--    "ciclo_unico", projetoAbsorvidoId, antes: <linha da venda antes da união> }.
--    Cards de projetos sem origem ficam como estão (Projetos sozinhos).
--
-- Idempotente: tudo é "se ainda não feito" (marco já existe, ordem já certa, par
-- já absorvido); rodar de novo não muda nenhuma linha. Instalação nova (sem
-- pipelines) não faz nada aqui: o seed cria os quadros já com os marcos.

BEGIN;

-- ---------------------------------------------------------------- 1. schema

DO $tipo$ BEGIN
  CREATE TYPE "Marco" AS ENUM ('PROPOSTA', 'MONTANDO_CONTRATO', 'GANHO', 'PERDIDO', 'HANDOFF', 'EXECUCAO', 'FINALIZADO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $tipo$;

ALTER TABLE "fase" ADD COLUMN IF NOT EXISTS "marco" "Marco";
ALTER TABLE "oportunidade" ADD COLUMN IF NOT EXISTS "absorvido_por_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "fase_marco_key" ON "fase"("marco");
CREATE INDEX IF NOT EXISTS "oportunidade_absorvido_por_id_idx" ON "oportunidade"("absorvido_por_id");

DO $fk$ BEGIN
  ALTER TABLE "oportunidade" ADD CONSTRAINT "oportunidade_absorvido_por_id_fkey" FOREIGN KEY ("absorvido_por_id") REFERENCES "oportunidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;

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
  v          oportunidade%ROWTYPE;
  p          oportunidade%ROWTYPE;
  s          oportunidade%ROWTYPE; -- lado "atual" (posição, responsável…)
  o          oportunidade%ROWTYPE; -- o outro lado (reserva)
  v_ganho    BOOLEAN;
  restos     INT;
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

  -- ---------------------------------------------------------- 4. pares venda → projeto
  FOR r IN
    SELECT pj.id AS p_id, pj.origem_oportunidade_id AS v_id
      FROM oportunidade pj
      JOIN oportunidade vd ON vd.id = pj.origem_oportunidade_id
     WHERE pj.absorvido_por_id IS NULL
       AND pj.pipeline_id = v_proj
       AND vd.pipeline_id = v_vendas
       AND vd.absorvido_por_id IS NULL
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

    -- pipefy_id é único: sai do card de projetos antes de ir para a venda.
    IF v.pipefy_id IS NULL AND p.pipefy_id IS NOT NULL THEN
      UPDATE oportunidade SET pipefy_id = NULL WHERE id = p.id;
    END IF;

    UPDATE oportunidade SET
      pipeline_id        = s.pipeline_id,
      fase_id            = s.fase_id,
      fase_desde         = s.fase_desde,
      responsavel_id     = s.responsavel_id,
      proxima_acao       = s.proxima_acao,
      proxima_acao_em    = s.proxima_acao_em,
      revisar            = s.revisar,
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
      descricao          = CASE
                             WHEN v.descricao IS NULL THEN p.descricao
                             WHEN p.descricao IS NULL OR p.descricao = v.descricao THEN v.descricao
                             ELSE v.descricao || E'\n\n— Projetos —\n' || p.descricao
                           END,
      reaberta_de_id     = COALESCE(v.reaberta_de_id, NULLIF(p.reaberta_de_id, v.id)),
      pipefy_id          = COALESCE(v.pipefy_id, p.pipefy_id),
      atualizado_em      = agora
    WHERE id = v.id;

    UPDATE timeline         SET oportunidade_id = v.id WHERE oportunidade_id = p.id;
    UPDATE transicao_fase   SET oportunidade_id = v.id WHERE oportunidade_id = p.id;
    UPDATE prazo            SET oportunidade_id = v.id WHERE oportunidade_id = p.id;
    UPDATE mensagem_enviada SET oportunidade_id = v.id WHERE oportunidade_id = p.id;
    UPDATE oportunidade     SET reaberta_de_id  = v.id WHERE reaberta_de_id = p.id AND id <> v.id;

    UPDATE oportunidade SET absorvido_por_id = v.id, deletado_em = COALESCE(deletado_em, agora), atualizado_em = agora WHERE id = p.id;

    INSERT INTO timeline (id, oportunidade_id, tipo, payload, usuario_id, em)
    VALUES ('gab81' || replace(gen_random_uuid()::text, '-', ''), v.id, 'VINCULO_PROJETO',
            jsonb_build_object('evento', 'ciclo_unico', 'projetoAbsorvidoId', p.id, 'antes', to_jsonb(v)), NULL, agora);
    unidos := unidos + 1;
  END LOOP;

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
  IF restos > 0 THEN
    RAISE NOTICE 'ciclo único: % card(s) com origem_oportunidade_id fora do formato venda→projetos não foram unidos', restos;
  END IF;
  RAISE NOTICE 'ciclo único: marcos criados=%, adotados=%, pares unidos=%', criadas, adotadas, unidos;
END $ciclo$;

COMMIT;

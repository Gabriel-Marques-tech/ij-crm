-- GAB-81: contagens do ciclo único, SÓ LEITURA. Rode ANTES e DEPOIS da migration
-- 20261030130000_ciclo_unico (numa cópia de produção, ou em produção mesmo: não
-- escreve nada) e compare (docs/runbook.md, "Ciclo único (GAB-81)"):
--
--   psql "$DATABASE_URL" -f scripts/verificar-ciclo-unico.sql
--   (no container: docker compose exec -T db psql -U ijcrm -d ijcrm < scripts/verificar-ciclo-unico.sql)
--
-- Funciona com o schema antigo e com o novo: as colunas novas (marco,
-- absorvido_por_id) são lidas via to_jsonb, que devolve NULL se não existem.
--
-- Tudo dentro de BEGIN READ ONLY … ROLLBACK: o Postgres recusa qualquer escrita.
--
-- Saída 1 (contagens). O que tem de bater (antes → depois):
--   projetos_entidades(depois) = cards_total(antes) - cards_absorvidos(depois)
--   pares_venda_projeto(depois) = pares_nao_unidos (os que ficam separados, ver saída 2)
--   cards_absorvidos(depois) = pares_venda_projeto(antes) - pares_nao_unidos(antes)
--   cards_total, transicoes_total, prazos_total e mensagens_enviadas_total: iguais
--   timeline_total(depois) = timeline_total(antes) + cards_absorvidos(depois)
--     + 2 × pares_nao_unidos + 1 NOTA por descrição longa (> 5000) concatenada
--   pipefy_ids e reaberturas: iguais; marcos(depois) = 7
--   vivos(depois) = vivos(antes) - pares unidos com os dois lados vivos
--
-- Saída 2 (pares NÃO unidos): pares venda → projeto em que a venda saiu do ganho
-- ("reaberta" = fase aberta, "perdida" = perdida depois do ganho) com o card de
-- projetos vivo. Por decisão do usuário a migration NÃO junta esses pares: os dois
-- seguem como Projetos separados (venda em Vendas, projeto em Projetos). A lista é
-- a mesma antes e depois da migration.
BEGIN READ ONLY;

SELECT metrica, valor FROM (
  WITH c AS (
    SELECT o.*, p.chave AS quadro, (to_jsonb(o) ->> 'absorvido_por_id') AS absorvido_por
      FROM oportunidade o JOIN pipeline p ON p.id = o.pipeline_id
  ),
  pares AS (
    SELECT pj.id AS p_id, vd.id AS v_id, pj.deletado_em AS p_del, vd.deletado_em AS v_del
      FROM c pj JOIN c vd ON vd.id = pj.origem_oportunidade_id
     WHERE pj.absorvido_por IS NULL AND pj.quadro = 'projetos' AND vd.quadro = 'vendas'
  )
  SELECT 1 AS ord, 'cards_total' AS metrica, (SELECT count(*) FROM c) AS valor
  UNION ALL SELECT 2, 'cards_absorvidos', (SELECT count(*) FROM c WHERE absorvido_por IS NOT NULL)
  UNION ALL SELECT 3, 'projetos_entidades', (SELECT count(*) FROM c WHERE absorvido_por IS NULL)
  UNION ALL SELECT 4, 'pares_venda_projeto', (SELECT count(*) FROM pares)
  UNION ALL SELECT 4, 'pares_nao_unidos', (SELECT count(*) FROM pares x JOIN c vd ON vd.id = x.v_id JOIN fase f ON f.id = vd.fase_id
                                             WHERE x.p_del IS NULL AND f.tipo_terminal IS DISTINCT FROM 'GANHO')
  UNION ALL SELECT 5, 'pares_dois_vivos', (SELECT count(*) FROM pares WHERE p_del IS NULL AND v_del IS NULL)
  UNION ALL SELECT 6, 'orfaos_projetos', (SELECT count(*) FROM c WHERE quadro = 'projetos' AND origem_oportunidade_id IS NULL AND absorvido_por IS NULL
                                            AND NOT EXISTS (SELECT 1 FROM c a WHERE a.absorvido_por = c.id))
  UNION ALL SELECT 7, 'vivos', (SELECT count(*) FROM c WHERE deletado_em IS NULL)
  UNION ALL SELECT 8, 'vivos_em_vendas', (SELECT count(*) FROM c WHERE deletado_em IS NULL AND quadro = 'vendas')
  UNION ALL SELECT 9, 'vivos_em_projetos', (SELECT count(*) FROM c WHERE deletado_em IS NULL AND quadro = 'projetos')
  UNION ALL SELECT 10, 'na_lixeira', (SELECT count(*) FROM c WHERE deletado_em IS NOT NULL AND absorvido_por IS NULL)
  UNION ALL SELECT 11, 'com_data_ganho', (SELECT count(*) FROM c WHERE data_ganho IS NOT NULL AND absorvido_por IS NULL)
  UNION ALL SELECT 12, 'pipefy_ids', (SELECT count(*) FROM c WHERE pipefy_id IS NOT NULL)
  UNION ALL SELECT 13, 'reaberturas', (SELECT count(*) FROM c WHERE reaberta_de_id IS NOT NULL)
  UNION ALL SELECT 14, 'timeline_total', (SELECT count(*) FROM timeline)
  UNION ALL SELECT 15, 'transicoes_total', (SELECT count(*) FROM transicao_fase)
  UNION ALL SELECT 16, 'prazos_total', (SELECT count(*) FROM prazo)
  UNION ALL SELECT 17, 'mensagens_enviadas_total', (SELECT count(*) FROM mensagem_enviada)
  UNION ALL SELECT 18, 'historico_em_card_absorvido', (SELECT (SELECT count(*) FROM timeline t JOIN c ON c.id = t.oportunidade_id WHERE c.absorvido_por IS NOT NULL)
                                                         + (SELECT count(*) FROM transicao_fase t JOIN c ON c.id = t.oportunidade_id WHERE c.absorvido_por IS NOT NULL))
  UNION ALL SELECT 19, 'fases_ativas_vendas', (SELECT count(*) FROM fase f JOIN pipeline p ON p.id = f.pipeline_id WHERE p.chave = 'vendas' AND f.arquivada_em IS NULL)
  UNION ALL SELECT 20, 'fases_ativas_projetos', (SELECT count(*) FROM fase f JOIN pipeline p ON p.id = f.pipeline_id WHERE p.chave = 'projetos' AND f.arquivada_em IS NULL)
  UNION ALL SELECT 21, 'marcos', (SELECT count(*) FROM fase f WHERE to_jsonb(f) ->> 'marco' IS NOT NULL)
  UNION ALL SELECT 22, 'cards_em_fase_de_outro_quadro', (SELECT count(*) FROM c JOIN fase f ON f.id = c.fase_id WHERE f.pipeline_id <> c.pipeline_id)
) m
ORDER BY ord;

SELECT CASE WHEN fv.tipo_terminal = 'PERDIDO' THEN 'nao_unido_perdida' ELSE 'nao_unido_reaberta' END AS conflito,
       vd.id AS venda_id, vd.titulo AS venda_titulo, fv.nome AS venda_fase, uv.nome AS venda_responsavel,
       vd.data_ganho AS venda_data_ganho, vd.fase_desde AS venda_fase_desde,
       pj.id AS projeto_id, pj.titulo AS projeto_titulo, fp.nome AS projeto_fase, up.nome AS projeto_responsavel,
       pj.fase_desde AS projeto_fase_desde
  FROM oportunidade pj
  JOIN oportunidade vd ON vd.id = pj.origem_oportunidade_id
  JOIN pipeline ppj ON ppj.id = pj.pipeline_id AND ppj.chave = 'projetos'
  JOIN pipeline pvd ON pvd.id = vd.pipeline_id AND pvd.chave = 'vendas'
  JOIN fase fv ON fv.id = vd.fase_id
  JOIN fase fp ON fp.id = pj.fase_id
  JOIN usuario uv ON uv.id = vd.responsavel_id
  JOIN usuario up ON up.id = pj.responsavel_id
 WHERE (to_jsonb(pj) ->> 'absorvido_por_id') IS NULL
   AND pj.deletado_em IS NULL
   AND fv.tipo_terminal IS DISTINCT FROM 'GANHO'
 ORDER BY conflito, vd.titulo;

ROLLBACK;

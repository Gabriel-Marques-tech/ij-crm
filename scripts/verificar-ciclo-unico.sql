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
-- O que tem de bater (antes → depois):
--   projetos_entidades(depois) = cards_total(antes) - pares_venda_projeto(antes)
--   pares_venda_projeto(depois) = 0 e cards_absorvidos(depois) = pares_venda_projeto(antes)
--   cards_total, transicoes_total, prazos_total e mensagens_enviadas_total: iguais
--   timeline_total(depois) = timeline_total(antes) + pares_venda_projeto(antes)
--   pipefy_ids e reaberturas: iguais; marcos(depois) = 7
--   vivos_em_vendas + vivos_em_projetos (depois) = vivos (antes) - pares com os dois lados vivos
--     (pares_dois_vivos, antes)
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

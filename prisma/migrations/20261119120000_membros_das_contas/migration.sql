-- GAB-108: toda conta do CRM (usuario) ganha a sua ficha em /membros. Contas criadas antes do
-- módulo G&G (o time de Vendas inteiro em produção) não tinham membro, e a lista vinha vazia.
-- Idempotente: só mexe em contas sem membro ligado; rodar de novo não muda nada.
-- E-mail casa por igualdade EXATA de lower(trim(email)), a forma do índice membro_email_unico
-- (nada de LIKE/ILIKE). Histórico sem autor (autor_id NULL = esta migração).
-- Contas VISUALIZADOR (outras áreas, fora da IJ) ficam de fora.

-- 1. Conta sem membro + membro sem conta com o mesmo e-mail -> liga (NAO_INFORMADO vira ATIVO se a
--    conta está ativa). Duas contas com o mesmo e-mail normalizado: liga a mais antiga; a outra
--    cai no passo 2 e entra sem e-mail (ele já é do membro ligado).
WITH candidatos AS (
  SELECT DISTINCT ON (m.id) m.id AS membro_id, u.id AS usuario_id,
         (m."status" = 'NAO_INFORMADO' AND u."ativo") AS ativar
  FROM "usuario" u
  JOIN "membro" m
    ON m."usuario_id" IS NULL
   AND m."email" IS NOT NULL
   AND lower(trim(m."email")) = lower(trim(u."email"))
  WHERE u."papel" <> 'VISUALIZADOR'
    AND NOT EXISTS (SELECT 1 FROM "membro" x WHERE x."usuario_id" = u.id)
  ORDER BY m.id, u."criado_em", u.id
),
ligados AS (
  UPDATE "membro" m
  SET "usuario_id" = c.usuario_id,
      "status" = CASE WHEN c.ativar THEN 'ATIVO'::"StatusMembro" ELSE m."status" END,
      "atualizado_em" = now()
  FROM candidatos c
  WHERE m.id = c.membro_id
  RETURNING m.id, c.ativar
),
vinculos AS (
  -- quem passou a ATIVO fica com período aberto (entrada desconhecida), como no cadastro pela Gestão
  INSERT INTO "vinculo_ij" ("id", "membro_id", "entrada", "saida")
  SELECT 'gab108' || replace(gen_random_uuid()::text, '-', ''), l.id, NULL, NULL
  FROM ligados l
  WHERE l.ativar
    AND NOT EXISTS (SELECT 1 FROM "vinculo_ij" v WHERE v."membro_id" = l.id AND v."saida" IS NULL)
)
INSERT INTO "historico_org" ("id", "membro_id", "evento", "dados", "criado_em")
SELECT 'gab108' || replace(gen_random_uuid()::text, '-', ''), l.id,
       'Conta do CRM ligada pelo e-mail (migração das contas existentes)', '{}'::jsonb, now()
FROM ligados l;

-- 2. Conta ainda sem membro -> cria. E-mail normalizado (lower/trim), salvo se já for de outro
--    membro (ligado a outra conta) ou de outra conta deste mesmo lote, ou não passar no CHECK
--    membro_email (mesma expressão aqui): aí entra sem e-mail. Nome cabe no CHECK membro_nome
--    (1 a 200 caracteres; vazio cai na parte local do e-mail). Conta com o nome de um membro sem
--    e-mail e sem conta (homônimo, mesma chave do app: sem acento/caixa/espaço extra) fica sem
--    membro: pode ser a mesma pessoa, e a Gestão liga pelo fluxo de homônimos do cadastro.
WITH sem_membro AS (
  SELECT u.id, u."ativo",
         coalesce(nullif(trim(left(trim(u."nome"), 200)), ''),
                  nullif(trim(left(split_part(trim(u."email"), '@', 1), 200)), ''),
                  'Sem nome') AS nome,
         CASE WHEN length(lower(trim(u."email"))) <= 254 AND lower(trim(u."email")) ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
              THEN lower(trim(u."email")) END AS email,
         row_number() OVER (PARTITION BY lower(trim(u."email")) ORDER BY u."criado_em", u.id) AS ordem
  FROM "usuario" u
  WHERE u."papel" <> 'VISUALIZADOR'
    AND NOT EXISTS (SELECT 1 FROM "membro" x WHERE x."usuario_id" = u.id)
    AND NOT EXISTS (
      SELECT 1 FROM "membro" h
      WHERE h."email" IS NULL AND h."usuario_id" IS NULL
        AND public.unaccent(lower(regexp_replace(trim(h."nome"), '\s+', ' ', 'g')))
          = public.unaccent(lower(regexp_replace(trim(u."nome"), '\s+', ' ', 'g')))
    )
),
novos AS (
  INSERT INTO "membro" ("id", "nome", "email", "status", "usuario_id", "criado_em", "atualizado_em")
  SELECT 'gab108' || replace(gen_random_uuid()::text, '-', ''), s.nome,
         CASE WHEN s.email IS NOT NULL AND s.ordem = 1
                   AND NOT EXISTS (SELECT 1 FROM "membro" m WHERE m."email" IS NOT NULL AND lower(trim(m."email")) = s.email)
              THEN s.email END,
         CASE WHEN s."ativo" THEN 'ATIVO' ELSE 'INATIVO' END::"StatusMembro",
         s.id, now(), now()
  FROM sem_membro s
  RETURNING "id", "status"
),
vinculos AS (
  INSERT INTO "vinculo_ij" ("id", "membro_id", "entrada", "saida")
  SELECT 'gab108' || replace(gen_random_uuid()::text, '-', ''), n.id, NULL, NULL
  FROM novos n
  WHERE n."status" = 'ATIVO'
)
INSERT INTO "historico_org" ("id", "membro_id", "evento", "dados", "criado_em")
SELECT 'gab108' || replace(gen_random_uuid()::text, '-', ''), n.id,
       'Membro criado a partir da conta do CRM (migração das contas existentes)', '{}'::jsonb, now()
FROM novos n;

-- DropForeignKey
ALTER TABLE "transicao_fase" DROP CONSTRAINT "transicao_fase_de_fase_id_fkey";

-- DropIndex
DROP INDEX "usuario_convite_token_key";

-- AlterTable
ALTER TABLE "inbox_evento" ALTER COLUMN "status" DROP DEFAULT;

-- AlterTable
ALTER TABLE "oportunidade" ALTER COLUMN "criado_via" DROP DEFAULT;

-- AlterTable
ALTER TABLE "usuario" DROP COLUMN "convite_token",
ADD COLUMN     "convite_token_hash" TEXT,
ALTER COLUMN "senha_hash" DROP NOT NULL,
ALTER COLUMN "senha_hash" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "mensagem_bruta_respondendo_evento_id_idx" ON "mensagem_bruta"("respondendo_evento_id");

-- CreateIndex
CREATE INDEX "oportunidade_origem_oportunidade_id_idx" ON "oportunidade"("origem_oportunidade_id");

-- CreateIndex
CREATE INDEX "oportunidade_reaberta_de_id_idx" ON "oportunidade"("reaberta_de_id");

-- CreateIndex
CREATE INDEX "timeline_mensagem_bruta_id_idx" ON "timeline"("mensagem_bruta_id");

-- CreateIndex
CREATE INDEX "transicao_fase_usuario_id_idx" ON "transicao_fase"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_convite_token_hash_key" ON "usuario"("convite_token_hash");

-- AddForeignKey
ALTER TABLE "transicao_fase" ADD CONSTRAINT "transicao_fase_de_fase_id_fkey" FOREIGN KEY ("de_fase_id") REFERENCES "fase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Raw SQL (não expressável no Prisma schema). Mantido aqui de propósito.
-- ---------------------------------------------------------------------------

-- Fase: terminal <=> tem tipo_terminal (evita estado inconsistente)
ALTER TABLE "fase"
  ADD CONSTRAINT "fase_terminal_consistente"
  CHECK ("is_terminal" = ("tipo_terminal" IS NOT NULL));

-- Busca por nome (contato/empresa) para listar CANDIDATOS à LLM (§4.3 passo 6).
-- Nunca usada para autolink: match automático é só por identificador exato.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE INDEX "contato_nome_trgm_idx" ON "contato" USING gin ("nome" gin_trgm_ops);
CREATE INDEX "empresa_nome_trgm_idx" ON "empresa" USING gin ("nome" gin_trgm_ops);

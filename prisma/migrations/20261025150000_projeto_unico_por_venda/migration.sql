-- GAB-32: ganho em vendas cria UM card de projeto por venda. A unicidade de
-- origem_oportunidade_id é a garantia no banco (NULLs não colidem no Postgres).
-- Sem checagem de duplicatas: hoje nada grava origem_oportunidade_id (a coluna
-- só é preenchida por este ticket). ATENÇÃO GAB-37 (import Pipefy): deduplicar
-- projetos por venda ANTES de carregar origem_oportunidade_id, senão o import
-- (ou um deploy sobre dados importados) falha nesta unicidade.

-- DropIndex
DROP INDEX "oportunidade_origem_oportunidade_id_idx";

-- CreateIndex
CREATE UNIQUE INDEX "oportunidade_origem_oportunidade_id_key" ON "oportunidade"("origem_oportunidade_id");

-- AlterEnum: vínculo venda <-> projeto na Timeline dos dois cards.
ALTER TYPE "TipoTimeline" ADD VALUE 'VINCULO_PROJETO';

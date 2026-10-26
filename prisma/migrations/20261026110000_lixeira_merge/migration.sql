-- GAB-36: lixeira (soft-delete/restaurar) e merge por soft-pointer.
-- Novos tipos de Timeline do card: foi para a lixeira / voltou dela.
ALTER TYPE "TipoTimeline" ADD VALUE 'EXCLUSAO';
ALTER TYPE "TipoTimeline" ADD VALUE 'RESTAURACAO';

-- Leituras do principal juntam os mesclados nele (merged_into_id = principal).
CREATE INDEX "empresa_merged_into_id_idx" ON "empresa"("merged_into_id");
CREATE INDEX "contato_merged_into_id_idx" ON "contato"("merged_into_id");

-- GAB-44: o ranking filtra transições e notas por período (sem varrer o histórico todo).
CREATE INDEX "transicao_fase_em_idx" ON "transicao_fase"("em");
CREATE INDEX "timeline_tipo_em_idx" ON "timeline"("tipo", "em");

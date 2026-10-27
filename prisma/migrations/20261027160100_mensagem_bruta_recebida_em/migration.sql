-- GAB-49: remetentes de uma janela de 12 h (gerarResumosPendentes, cron) sem varrer a tabela.
CREATE INDEX "mensagem_bruta_recebida_em_idx" ON "mensagem_bruta"("recebida_em");

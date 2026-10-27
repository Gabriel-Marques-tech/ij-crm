-- GAB-49: resumo por vendedor da janela de 12 h anterior (contexto da LLM).
-- O ledger da janela é derivado de mensagem_bruta (sem tabela nova).

CREATE TYPE "StatusResumo" AS ENUM ('GERANDO', 'PRONTO', 'FALHA');

CREATE TABLE "resumo_janela" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "janela_inicio" TIMESTAMP(3) NOT NULL,
    "status" "StatusResumo" NOT NULL DEFAULT 'GERANDO',
    "tentativas" INTEGER NOT NULL DEFAULT 1,
    "texto" TEXT,
    "erro" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resumo_janela_pkey" PRIMARY KEY ("id")
);

-- Chave da reivindicação: um resumo por vendedor e janela.
CREATE UNIQUE INDEX "resumo_janela_usuario_id_janela_inicio_key" ON "resumo_janela"("usuario_id", "janela_inicio");
-- Retenção: apaga as janelas mais antigas que a anterior.
CREATE INDEX "resumo_janela_janela_inicio_idx" ON "resumo_janela"("janela_inicio");

ALTER TABLE "resumo_janela" ADD CONSTRAINT "resumo_janela_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

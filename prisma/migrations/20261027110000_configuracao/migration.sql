-- GAB-44: configuração chave → JSON, genérica (ranking agora; config técnica do GAB-42 depois).
-- O valor é validado com zod no serviço (src/lib/configuracao); linha ausente = padrão do código.
CREATE TABLE "configuracao" (
    "chave" TEXT NOT NULL,
    "valor" JSONB NOT NULL,
    "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_por" TEXT,

    CONSTRAINT "configuracao_pkey" PRIMARY KEY ("chave")
);

-- Quem mudou por último; usuário apagado não leva a configuração junto.
ALTER TABLE "configuracao" ADD CONSTRAINT "configuracao_atualizado_por_fkey" FOREIGN KEY ("atualizado_por") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

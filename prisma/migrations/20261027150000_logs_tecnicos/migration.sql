-- GAB-42: logs técnicos do Admin. Tabelas pequenas em anel: cada inserção apaga
-- o que passou das últimas N linhas (src/lib/logs). Nunca guardam texto de
-- mensagem, telefone ou email — só tipo, chat mascarado, resultado e números.
CREATE TABLE "log_webhook" (
    "id" SERIAL NOT NULL,
    "em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tipo" TEXT,
    "chat" TEXT,
    "status" INTEGER NOT NULL,
    "resultado" TEXT NOT NULL,
    "ms" INTEGER NOT NULL,

    CONSTRAINT "log_webhook_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "log_llm" (
    "id" SERIAL NOT NULL,
    "em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "operacao" TEXT NOT NULL,
    "provedor" TEXT,
    "modelo" TEXT,
    "tokens_entrada" INTEGER,
    "tokens_saida" INTEGER,
    "tokens_raciocinio" INTEGER,
    "ms" INTEGER,
    "status" TEXT NOT NULL,
    "ref" TEXT,

    CONSTRAINT "log_llm_pkey" PRIMARY KEY ("id")
);

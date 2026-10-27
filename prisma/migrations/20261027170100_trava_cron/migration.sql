-- GAB-41 (review): trava do cron por "aluguel" de linha, sem segurar conexão do pool.
-- `expira_em` no passado (ou NULL) = livre. Quem pega grava `dono` e solta no fim só se ainda for dono.
CREATE TABLE "trava_cron" (
    "nome" TEXT NOT NULL,
    "dono" TEXT,
    "expira_em" TIMESTAMP(3),

    CONSTRAINT "trava_cron_pkey" PRIMARY KEY ("nome")
);

-- Retenção de 90 dias do JSON da LLM: só as linhas que ainda têm JSON entram no índice.
-- Índice parcial: o Prisma 6 não o representa no schema.prisma (fica só aqui).
CREATE INDEX "mensagem_bruta_resultado_llm_recebida_em_idx" ON "mensagem_bruta" ("recebida_em") WHERE "resultado_llm" IS NOT NULL;

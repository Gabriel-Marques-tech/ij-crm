-- GAB-46: estado de alertas operacionais (hoje só LLM_SEM_CREDITO).
-- Uma linha por chave. Fica no banco (e não em memória) para o cooldown
-- sobreviver a restart do app e o banner valer para todos os requests.
CREATE TABLE "alerta_operacional" (
    "chave" TEXT NOT NULL,
    -- Primeira ocorrência desde o último sucesso; NULL = normalizado (sem banner).
    "ativo_desde" TIMESTAMP(3),
    "ultima_ocorrencia_em" TIMESTAMP(3),
    -- Antes disto não tenta avisar de novo (6 h após entrega, 5 min após falha de envio).
    "proximo_aviso_em" TIMESTAMP(3),
    "avisado_em" TIMESTAMP(3),

    CONSTRAINT "alerta_operacional_pkey" PRIMARY KEY ("chave")
);

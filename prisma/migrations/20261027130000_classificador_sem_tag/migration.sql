-- GAB-39: classificador de mensagens sem #crm.

-- Mensagem sem tag que o classificador achou relevante (limiar de extração mais alto, confirmação "↪️").
ALTER TABLE "mensagem_bruta" ADD COLUMN "sem_tag" BOOLEAN NOT NULL DEFAULT false;

-- Sem tag e o classificador falhou (sem crédito / provedor fora): só a contagem do dia, nunca o texto.
ALTER TABLE "contador_descartadas" ADD COLUMN "nao_classificadas" INTEGER NOT NULL DEFAULT 0;

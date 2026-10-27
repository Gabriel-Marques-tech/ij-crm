-- GAB-34: estado intermediário do processamento pela LLM. `processarMensagem`
-- reivindica a linha com UPDATE ... WHERE status = 'RECEBIDA' → 'PROCESSANDO'
-- (atômico): retry do webhook ou chamada concorrente nunca cobram a LLM duas vezes.
ALTER TYPE "StatusMensagem" ADD VALUE IF NOT EXISTS 'PROCESSANDO' AFTER 'RECEBIDA';

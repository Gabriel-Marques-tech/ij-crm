-- GAB-41: "Resolver manualmente" no painel de mensagens. Quem resolveu e quando
-- (a mensagem vai para PROCESSADA sem passar pela LLM).
ALTER TABLE "mensagem_bruta" ADD COLUMN "resolvida_por_id" TEXT;
ALTER TABLE "mensagem_bruta" ADD COLUMN "resolvida_em" TIMESTAMP(3);
ALTER TABLE "mensagem_bruta" ADD CONSTRAINT "mensagem_bruta_resolvida_por_id_fkey"
  FOREIGN KEY ("resolvida_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- GAB-101: comentários de revisão (sugestão aplicável, revisão em lote, comentário em campo). Só aditiva.
ALTER TABLE "proposta_comentario"
  ADD COLUMN "campo" TEXT,
  ADD COLUMN "sugestao" TEXT,
  ADD COLUMN "sugestao_aplicada_em" TIMESTAMP(3),
  ADD COLUMN "sugestao_aplicada_por_id" TEXT,
  ADD COLUMN "pendente" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "proposta_comentario" ADD CONSTRAINT "proposta_comentario_sugestao_aplicada_por_id_fkey" FOREIGN KEY ("sugestao_aplicada_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Limites (os mesmos de src/lib/propostas/comentarios-limites.ts): defesa no banco.
ALTER TABLE "proposta_comentario" ADD CONSTRAINT "proposta_comentario_sugestao_tamanho" CHECK ("sugestao" IS NULL OR char_length("sugestao") <= 2000);
-- Sugestão só com trecho; campo sem trecho e sem sugestão; os dois só na raiz.
ALTER TABLE "proposta_comentario" ADD CONSTRAINT "proposta_comentario_sugestao_com_trecho" CHECK ("sugestao" IS NULL OR "trecho" IS NOT NULL);
ALTER TABLE "proposta_comentario" ADD CONSTRAINT "proposta_comentario_campo_valido" CHECK ("campo" IS NULL OR ("campo" IN ('valor', 'prazo', 'escopo', 'entregas') AND "trecho" IS NULL));
ALTER TABLE "proposta_comentario" ADD CONSTRAINT "proposta_comentario_resposta_sem_campo" CHECK ("pai_id" IS NULL OR ("campo" IS NULL AND "sugestao" IS NULL));

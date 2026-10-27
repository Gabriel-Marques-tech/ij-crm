-- GAB-51: prazos ("linha de chegada" do Calendário). Só aditiva.
ALTER TYPE "TipoTimeline" ADD VALUE IF NOT EXISTS 'PRAZO';

CREATE TABLE "prazo" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "responsavel_id" TEXT NOT NULL,
    "oportunidade_id" TEXT,
    "feito_em" TIMESTAMP(3),
    "feito_por_id" TEXT,
    "criado_por_id" TEXT NOT NULL,
    "deletado_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prazo_pkey" PRIMARY KEY ("id")
);

-- Semana de uma pessoa (Meu/Pessoa/Minha Semana) e do time.
CREATE INDEX "prazo_responsavel_id_data_idx" ON "prazo"("responsavel_id", "data");
CREATE INDEX "prazo_data_idx" ON "prazo"("data");
CREATE INDEX "prazo_oportunidade_id_idx" ON "prazo"("oportunidade_id");

ALTER TABLE "prazo" ADD CONSTRAINT "prazo_responsavel_id_fkey" FOREIGN KEY ("responsavel_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prazo" ADD CONSTRAINT "prazo_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prazo" ADD CONSTRAINT "prazo_feito_por_id_fkey" FOREIGN KEY ("feito_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "prazo" ADD CONSTRAINT "prazo_oportunidade_id_fkey" FOREIGN KEY ("oportunidade_id") REFERENCES "oportunidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

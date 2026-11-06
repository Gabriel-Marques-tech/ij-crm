-- CreateEnum
CREATE TYPE "StatusTarefa" AS ENUM ('BACKLOG', 'A_FAZER', 'EM_ANDAMENTO', 'EM_REVISAO', 'FEITA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "PrioridadeTarefa" AS ENUM ('SEM_PRIORIDADE', 'URGENTE', 'ALTA', 'MEDIA', 'BAIXA');

-- AlterEnum
ALTER TYPE "TipoAviso" ADD VALUE 'TAREFA_ATRIBUIDA';

-- CreateTable
CREATE TABLE "tarefa" (
    "id" TEXT NOT NULL,
    "oportunidade_id" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "pai_id" TEXT,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "status" "StatusTarefa" NOT NULL DEFAULT 'A_FAZER',
    "prioridade" "PrioridadeTarefa" NOT NULL DEFAULT 'SEM_PRIORIDADE',
    "posicao" DOUBLE PRECISION NOT NULL,
    "responsavel_id" TEXT,
    "prazo" DATE,
    "etiquetas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "concluida_em" TIMESTAMP(3),
    "criado_por_id" TEXT NOT NULL,
    "deletado_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tarefa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tarefa_oportunidade_id_status_posicao_idx" ON "tarefa"("oportunidade_id", "status", "posicao");

-- CreateIndex
CREATE INDEX "tarefa_responsavel_id_idx" ON "tarefa"("responsavel_id");

-- CreateIndex
CREATE INDEX "tarefa_pai_id_idx" ON "tarefa"("pai_id");

-- CreateIndex
CREATE UNIQUE INDEX "tarefa_oportunidade_id_numero_key" ON "tarefa"("oportunidade_id", "numero");

-- AddForeignKey
ALTER TABLE "tarefa" ADD CONSTRAINT "tarefa_oportunidade_id_fkey" FOREIGN KEY ("oportunidade_id") REFERENCES "oportunidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tarefa" ADD CONSTRAINT "tarefa_responsavel_id_fkey" FOREIGN KEY ("responsavel_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tarefa" ADD CONSTRAINT "tarefa_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tarefa" ADD CONSTRAINT "tarefa_pai_id_fkey" FOREIGN KEY ("pai_id") REFERENCES "tarefa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

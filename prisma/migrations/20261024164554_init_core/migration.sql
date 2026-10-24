-- CreateEnum
CREATE TYPE "Papel" AS ENUM ('ADMIN', 'GESTOR', 'VENDEDOR');

-- CreateEnum
CREATE TYPE "TipoContatoPonto" AS ENUM ('TELEFONE', 'EMAIL');

-- CreateEnum
CREATE TYPE "TipoTerminal" AS ENUM ('GANHO', 'PERDIDO');

-- CreateEnum
CREATE TYPE "Origem" AS ENUM ('COLD_CALL', 'RD', 'INDICACAO', 'EVENTO', 'OUTRO');

-- CreateEnum
CREATE TYPE "CriadoVia" AS ENUM ('WHATSAPP', 'UI', 'IMPORT');

-- CreateEnum
CREATE TYPE "OrigemTransicao" AS ENUM ('WHATSAPP', 'UI', 'IMPORT', 'SISTEMA');

-- CreateEnum
CREATE TYPE "TipoTimeline" AS ENUM ('CRIACAO', 'MOVIMENTACAO', 'CAMPO_ALTERADO', 'NOTA', 'MENSAGEM_WHATSAPP', 'IMPORT');

-- CreateEnum
CREATE TYPE "StatusMensagem" AS ENUM ('RECEBIDA', 'CLASSIFICADA_IRRELEVANTE', 'PROCESSADA', 'FALHA', 'PENDENTE_REVISAO');

-- CreateTable
CREATE TABLE "usuario" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senha_hash" TEXT NOT NULL DEFAULT '',
    "papel" "Papel" NOT NULL DEFAULT 'VENDEDOR',
    "telefone_whatsapp" TEXT,
    "whatsapp_lid" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "convite_token" TEXT,
    "convite_expira_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "empresa" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cnpj" TEXT,
    "dominio_email" TEXT,
    "cidade" TEXT,
    "estado" TEXT,
    "site" TEXT,
    "observacoes" TEXT,
    "merged_into_id" TEXT,
    "deletado_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "empresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contato" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "empresa_id" TEXT,
    "cargo" TEXT,
    "observacoes" TEXT,
    "merged_into_id" TEXT,
    "deletado_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contato_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contato_ponto" (
    "id" TEXT NOT NULL,
    "contato_id" TEXT NOT NULL,
    "tipo" "TipoContatoPonto" NOT NULL,
    "valor_normalizado" TEXT NOT NULL,
    "valor_original" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contato_ponto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline" (
    "id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "pipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fase" (
    "id" TEXT NOT NULL,
    "pipeline_id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "is_terminal" BOOLEAN NOT NULL DEFAULT false,
    "tipo_terminal" "TipoTerminal",
    "cor" TEXT,
    "limite_dias_alerta" INTEGER,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oportunidade" (
    "id" TEXT NOT NULL,
    "pipeline_id" TEXT NOT NULL,
    "fase_id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "empresa_id" TEXT,
    "contato_id" TEXT,
    "responsavel_id" TEXT NOT NULL,
    "origem" "Origem",
    "dor" TEXT,
    "orcamento_previsto" DECIMAL(14,2),
    "proposta_url" TEXT,
    "cidade" TEXT,
    "estado" TEXT,
    "valor_fechado" DECIMAL(14,2),
    "data_ganho" TIMESTAMP(3),
    "motivo_perda" TEXT,
    "proxima_acao" TEXT,
    "proxima_acao_em" TIMESTAMP(3),
    "revisar" BOOLEAN NOT NULL DEFAULT false,
    "fase_desde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criado_via" "CriadoVia" NOT NULL DEFAULT 'UI',
    "origem_oportunidade_id" TEXT,
    "reaberta_de_id" TEXT,
    "pipefy_id" TEXT,
    "deletado_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oportunidade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transicao_fase" (
    "id" TEXT NOT NULL,
    "oportunidade_id" TEXT NOT NULL,
    "de_fase_id" TEXT,
    "para_fase_id" TEXT NOT NULL,
    "usuario_id" TEXT,
    "origem" "OrigemTransicao" NOT NULL,
    "em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transicao_fase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timeline" (
    "id" TEXT NOT NULL,
    "oportunidade_id" TEXT NOT NULL,
    "tipo" "TipoTimeline" NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "usuario_id" TEXT,
    "mensagem_bruta_id" TEXT,
    "em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbox_evento" (
    "evento_id" TEXT NOT NULL,
    "recebido_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'PROCESSADO',

    CONSTRAINT "inbox_evento_pkey" PRIMARY KEY ("evento_id")
);

-- CreateTable
CREATE TABLE "mensagem_bruta" (
    "id" TEXT NOT NULL,
    "evento_id" TEXT NOT NULL,
    "remetente_telefone" TEXT,
    "remetente_lid" TEXT,
    "remetente_usuario_id" TEXT,
    "grupo_jid" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "media_type" TEXT,
    "media_url" TEXT,
    "respondendo_evento_id" TEXT,
    "recebida_em" TIMESTAMP(3) NOT NULL,
    "status" "StatusMensagem" NOT NULL DEFAULT 'RECEBIDA',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "resultado_llm" JSONB,
    "erro" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mensagem_bruta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensagem_enviada" (
    "evento_id" TEXT NOT NULL,
    "oportunidade_id" TEXT,
    "grupo_jid" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensagem_enviada_pkey" PRIMARY KEY ("evento_id")
);

-- CreateTable
CREATE TABLE "contador_descartadas" (
    "dia" DATE NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "contador_descartadas_pkey" PRIMARY KEY ("dia")
);

-- CreateTable
CREATE TABLE "remetente_desconhecido" (
    "id" TEXT NOT NULL,
    "telefone" TEXT,
    "lid" TEXT,
    "total" INTEGER NOT NULL DEFAULT 1,
    "ultima_vez" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "remetente_desconhecido_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuario_email_key" ON "usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_telefone_whatsapp_key" ON "usuario"("telefone_whatsapp");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_whatsapp_lid_key" ON "usuario"("whatsapp_lid");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_convite_token_key" ON "usuario"("convite_token");

-- CreateIndex
CREATE UNIQUE INDEX "empresa_cnpj_key" ON "empresa"("cnpj");

-- CreateIndex
CREATE INDEX "empresa_nome_idx" ON "empresa"("nome");

-- CreateIndex
CREATE INDEX "contato_nome_idx" ON "contato"("nome");

-- CreateIndex
CREATE INDEX "contato_empresa_id_idx" ON "contato"("empresa_id");

-- CreateIndex
CREATE INDEX "contato_ponto_contato_id_idx" ON "contato_ponto"("contato_id");

-- CreateIndex
CREATE UNIQUE INDEX "contato_ponto_tipo_valor_normalizado_key" ON "contato_ponto"("tipo", "valor_normalizado");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_chave_key" ON "pipeline"("chave");

-- CreateIndex
CREATE INDEX "fase_pipeline_id_ordem_idx" ON "fase"("pipeline_id", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "fase_pipeline_id_chave_key" ON "fase"("pipeline_id", "chave");

-- CreateIndex
CREATE UNIQUE INDEX "oportunidade_pipefy_id_key" ON "oportunidade"("pipefy_id");

-- CreateIndex
CREATE INDEX "oportunidade_pipeline_id_fase_id_idx" ON "oportunidade"("pipeline_id", "fase_id");

-- CreateIndex
CREATE INDEX "oportunidade_responsavel_id_idx" ON "oportunidade"("responsavel_id");

-- CreateIndex
CREATE INDEX "oportunidade_empresa_id_idx" ON "oportunidade"("empresa_id");

-- CreateIndex
CREATE INDEX "oportunidade_contato_id_idx" ON "oportunidade"("contato_id");

-- CreateIndex
CREATE INDEX "oportunidade_proxima_acao_em_idx" ON "oportunidade"("proxima_acao_em");

-- CreateIndex
CREATE INDEX "transicao_fase_oportunidade_id_em_idx" ON "transicao_fase"("oportunidade_id", "em");

-- CreateIndex
CREATE INDEX "timeline_oportunidade_id_em_idx" ON "timeline"("oportunidade_id", "em");

-- CreateIndex
CREATE UNIQUE INDEX "mensagem_bruta_evento_id_key" ON "mensagem_bruta"("evento_id");

-- CreateIndex
CREATE INDEX "mensagem_bruta_status_idx" ON "mensagem_bruta"("status");

-- CreateIndex
CREATE INDEX "mensagem_bruta_remetente_usuario_id_recebida_em_idx" ON "mensagem_bruta"("remetente_usuario_id", "recebida_em");

-- CreateIndex
CREATE INDEX "mensagem_enviada_oportunidade_id_idx" ON "mensagem_enviada"("oportunidade_id");

-- CreateIndex
CREATE UNIQUE INDEX "remetente_desconhecido_telefone_key" ON "remetente_desconhecido"("telefone");

-- CreateIndex
CREATE UNIQUE INDEX "remetente_desconhecido_lid_key" ON "remetente_desconhecido"("lid");

-- AddForeignKey
ALTER TABLE "empresa" ADD CONSTRAINT "empresa_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "empresa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contato" ADD CONSTRAINT "contato_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contato" ADD CONSTRAINT "contato_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "contato"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contato_ponto" ADD CONSTRAINT "contato_ponto_contato_id_fkey" FOREIGN KEY ("contato_id") REFERENCES "contato"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fase" ADD CONSTRAINT "fase_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "pipeline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oportunidade" ADD CONSTRAINT "oportunidade_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "pipeline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oportunidade" ADD CONSTRAINT "oportunidade_fase_id_fkey" FOREIGN KEY ("fase_id") REFERENCES "fase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oportunidade" ADD CONSTRAINT "oportunidade_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oportunidade" ADD CONSTRAINT "oportunidade_contato_id_fkey" FOREIGN KEY ("contato_id") REFERENCES "contato"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oportunidade" ADD CONSTRAINT "oportunidade_responsavel_id_fkey" FOREIGN KEY ("responsavel_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oportunidade" ADD CONSTRAINT "oportunidade_origem_oportunidade_id_fkey" FOREIGN KEY ("origem_oportunidade_id") REFERENCES "oportunidade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oportunidade" ADD CONSTRAINT "oportunidade_reaberta_de_id_fkey" FOREIGN KEY ("reaberta_de_id") REFERENCES "oportunidade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transicao_fase" ADD CONSTRAINT "transicao_fase_oportunidade_id_fkey" FOREIGN KEY ("oportunidade_id") REFERENCES "oportunidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transicao_fase" ADD CONSTRAINT "transicao_fase_de_fase_id_fkey" FOREIGN KEY ("de_fase_id") REFERENCES "fase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transicao_fase" ADD CONSTRAINT "transicao_fase_para_fase_id_fkey" FOREIGN KEY ("para_fase_id") REFERENCES "fase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transicao_fase" ADD CONSTRAINT "transicao_fase_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timeline" ADD CONSTRAINT "timeline_oportunidade_id_fkey" FOREIGN KEY ("oportunidade_id") REFERENCES "oportunidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timeline" ADD CONSTRAINT "timeline_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timeline" ADD CONSTRAINT "timeline_mensagem_bruta_id_fkey" FOREIGN KEY ("mensagem_bruta_id") REFERENCES "mensagem_bruta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagem_bruta" ADD CONSTRAINT "mensagem_bruta_remetente_usuario_id_fkey" FOREIGN KEY ("remetente_usuario_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagem_enviada" ADD CONSTRAINT "mensagem_enviada_oportunidade_id_fkey" FOREIGN KEY ("oportunidade_id") REFERENCES "oportunidade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

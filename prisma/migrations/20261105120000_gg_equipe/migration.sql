-- CreateEnum
CREATE TYPE "FuncaoProjeto" AS ENUM ('PM', 'PO', 'SCRUM_MASTER', 'MEMBRO');

-- CreateEnum
CREATE TYPE "StatusMembro" AS ENUM ('NAO_INFORMADO', 'ATIVO', 'AFASTADO', 'INATIVO');

-- CreateEnum
CREATE TYPE "TipoAreaOrg" AS ENUM ('AREA', 'FRENTE', 'INSTITUCIONAL');

-- CreateEnum
CREATE TYPE "CategoriaCargo" AS ENUM ('DIRETORIA', 'LIDERANCA', 'MEMBRO');

-- CreateEnum
CREATE TYPE "TipoDemanda" AS ENUM ('ROSA', 'AZUL');

-- CreateEnum
CREATE TYPE "CategoriaEvento" AS ENUM ('RG', 'REUNIAO', 'EVENTO');

-- CreateEnum
CREATE TYPE "DirecaoKpi" AS ENUM ('MAIOR', 'MENOR');

-- CreateEnum
CREATE TYPE "PapelRaci" AS ENUM ('R', 'A', 'C', 'I');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TipoAviso" ADD VALUE 'EQUIPE_PROJETO';
ALTER TYPE "TipoAviso" ADD VALUE 'LEMBRETE_GG';

-- CreateTable
CREATE TABLE "projeto_membro" (
    "id" TEXT NOT NULL,
    "oportunidade_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "funcao" "FuncaoProjeto" NOT NULL DEFAULT 'MEMBRO',
    "inicio" DATE NOT NULL,
    "fim" DATE,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projeto_membro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membro" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT,
    "status" "StatusMembro" NOT NULL DEFAULT 'NAO_INFORMADO',
    "interesse_lideranca" BOOLEAN,
    "usuario_id" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "membro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "area_org" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "TipoAreaOrg" NOT NULL DEFAULT 'AREA',
    "superior_id" TEXT,
    "lado_crm" "Area",
    "eh_gg" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "area_org_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cargo_org" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "categoria" "CategoriaCargo" NOT NULL DEFAULT 'MEMBRO',
    "eh_gp" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "cargo_org_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posicao" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "area_id" TEXT NOT NULL,
    "cargo_id" TEXT NOT NULL,
    "lideranca_id" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "posicao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocupacao" (
    "id" TEXT NOT NULL,
    "membro_id" TEXT NOT NULL,
    "posicao_id" TEXT NOT NULL,
    "inicio" DATE,
    "fim" DATE,
    "principal" BOOLEAN NOT NULL DEFAULT false,
    "invalidado_em" TIMESTAMP(3),
    "motivo_invalidacao" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ocupacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vinculo_ij" (
    "id" TEXT NOT NULL,
    "membro_id" TEXT NOT NULL,
    "entrada" DATE,
    "saida" DATE,

    CONSTRAINT "vinculo_ij_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historico_org" (
    "id" TEXT NOT NULL,
    "membro_id" TEXT,
    "evento" TEXT NOT NULL,
    "dados" JSONB NOT NULL DEFAULT '{}',
    "autor_id" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historico_org_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "importacao_membros" (
    "id" TEXT NOT NULL,
    "autor_id" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "importacao_membros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demanda" (
    "id" TEXT NOT NULL,
    "membro_id" TEXT NOT NULL,
    "tipo" "TipoDemanda" NOT NULL,
    "semestre" TEXT NOT NULL,
    "justificativa" TEXT NOT NULL,
    "autor_id" TEXT NOT NULL,
    "registrante_nome" TEXT NOT NULL,
    "cancelada_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demanda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evento_agenda" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "horario" TEXT,
    "categoria" "CategoriaEvento" NOT NULL DEFAULT 'EVENTO',
    "area_id" TEXT,
    "criado_por_id" TEXT NOT NULL,
    "deletado_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evento_agenda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ausencia" (
    "id" TEXT NOT NULL,
    "evento_id" TEXT NOT NULL,
    "membro_id" TEXT NOT NULL,
    "justificada" BOOLEAN NOT NULL,
    "observacao" TEXT,
    "registrado_por_id" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ausencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lembrete_evento" (
    "evento_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lembrete_evento_pkey" PRIMARY KEY ("evento_id","usuario_id")
);

-- CreateTable
CREATE TABLE "ciclo" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "inicio" DATE NOT NULL,
    "fim" DATE NOT NULL,

    CONSTRAINT "ciclo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "objetivo" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "ciclo_id" TEXT NOT NULL,
    "responsavel_id" TEXT NOT NULL,

    CONSTRAINT "objetivo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resultado_chave" (
    "id" TEXT NOT NULL,
    "objetivo_id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "unidade" TEXT NOT NULL DEFAULT '',
    "inicial" DECIMAL(14,2) NOT NULL,
    "meta" DECIMAL(14,2) NOT NULL,
    "atual" DECIMAL(14,2) NOT NULL,
    "fonte" TEXT,

    CONSTRAINT "resultado_chave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "unidade" TEXT NOT NULL,
    "meta" DECIMAL(14,2) NOT NULL,
    "direcao" "DirecaoKpi" NOT NULL DEFAULT 'MAIOR',
    "fonte" TEXT,

    CONSTRAINT "kpi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medicao_kpi" (
    "id" TEXT NOT NULL,
    "kpi_id" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "medicao_kpi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iniciativa" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "objetivo_id" TEXT,
    "kpi_id" TEXT,
    "responsavel_id" TEXT NOT NULL,
    "prazo" DATE,
    "concluida_em" TIMESTAMP(3),

    CONSTRAINT "iniciativa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processo" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "processo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raci" (
    "processo_id" TEXT NOT NULL,
    "cargo_id" TEXT NOT NULL,
    "papel" "PapelRaci" NOT NULL,

    CONSTRAINT "raci_pkey" PRIMARY KEY ("processo_id","cargo_id")
);

-- CreateIndex
CREATE INDEX "projeto_membro_oportunidade_id_idx" ON "projeto_membro"("oportunidade_id");

-- CreateIndex
CREATE INDEX "projeto_membro_usuario_id_idx" ON "projeto_membro"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "membro_usuario_id_key" ON "membro"("usuario_id");

-- CreateIndex
CREATE INDEX "membro_nome_idx" ON "membro"("nome");

-- CreateIndex
CREATE INDEX "posicao_lideranca_id_idx" ON "posicao"("lideranca_id");

-- CreateIndex
CREATE INDEX "ocupacao_membro_id_idx" ON "ocupacao"("membro_id");

-- CreateIndex
CREATE INDEX "ocupacao_posicao_id_idx" ON "ocupacao"("posicao_id");

-- CreateIndex
CREATE INDEX "vinculo_ij_membro_id_idx" ON "vinculo_ij"("membro_id");

-- CreateIndex
CREATE INDEX "historico_org_membro_id_criado_em_idx" ON "historico_org"("membro_id", "criado_em");

-- CreateIndex
CREATE INDEX "demanda_membro_id_semestre_idx" ON "demanda"("membro_id", "semestre");

-- CreateIndex
CREATE INDEX "evento_agenda_data_idx" ON "evento_agenda"("data");

-- CreateIndex
CREATE UNIQUE INDEX "ausencia_evento_id_membro_id_key" ON "ausencia"("evento_id", "membro_id");

-- CreateIndex
CREATE UNIQUE INDEX "medicao_kpi_kpi_id_data_key" ON "medicao_kpi"("kpi_id", "data");

-- AddForeignKey
ALTER TABLE "projeto_membro" ADD CONSTRAINT "projeto_membro_oportunidade_id_fkey" FOREIGN KEY ("oportunidade_id") REFERENCES "oportunidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projeto_membro" ADD CONSTRAINT "projeto_membro_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membro" ADD CONSTRAINT "membro_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "area_org" ADD CONSTRAINT "area_org_superior_id_fkey" FOREIGN KEY ("superior_id") REFERENCES "area_org"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posicao" ADD CONSTRAINT "posicao_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "area_org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posicao" ADD CONSTRAINT "posicao_cargo_id_fkey" FOREIGN KEY ("cargo_id") REFERENCES "cargo_org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posicao" ADD CONSTRAINT "posicao_lideranca_id_fkey" FOREIGN KEY ("lideranca_id") REFERENCES "posicao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocupacao" ADD CONSTRAINT "ocupacao_membro_id_fkey" FOREIGN KEY ("membro_id") REFERENCES "membro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocupacao" ADD CONSTRAINT "ocupacao_posicao_id_fkey" FOREIGN KEY ("posicao_id") REFERENCES "posicao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vinculo_ij" ADD CONSTRAINT "vinculo_ij_membro_id_fkey" FOREIGN KEY ("membro_id") REFERENCES "membro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historico_org" ADD CONSTRAINT "historico_org_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demanda" ADD CONSTRAINT "demanda_membro_id_fkey" FOREIGN KEY ("membro_id") REFERENCES "membro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demanda" ADD CONSTRAINT "demanda_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_agenda" ADD CONSTRAINT "evento_agenda_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "area_org"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_agenda" ADD CONSTRAINT "evento_agenda_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ausencia" ADD CONSTRAINT "ausencia_evento_id_fkey" FOREIGN KEY ("evento_id") REFERENCES "evento_agenda"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ausencia" ADD CONSTRAINT "ausencia_membro_id_fkey" FOREIGN KEY ("membro_id") REFERENCES "membro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ausencia" ADD CONSTRAINT "ausencia_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lembrete_evento" ADD CONSTRAINT "lembrete_evento_evento_id_fkey" FOREIGN KEY ("evento_id") REFERENCES "evento_agenda"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objetivo" ADD CONSTRAINT "objetivo_ciclo_id_fkey" FOREIGN KEY ("ciclo_id") REFERENCES "ciclo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objetivo" ADD CONSTRAINT "objetivo_responsavel_id_fkey" FOREIGN KEY ("responsavel_id") REFERENCES "membro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resultado_chave" ADD CONSTRAINT "resultado_chave_objetivo_id_fkey" FOREIGN KEY ("objetivo_id") REFERENCES "objetivo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicao_kpi" ADD CONSTRAINT "medicao_kpi_kpi_id_fkey" FOREIGN KEY ("kpi_id") REFERENCES "kpi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iniciativa" ADD CONSTRAINT "iniciativa_objetivo_id_fkey" FOREIGN KEY ("objetivo_id") REFERENCES "objetivo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iniciativa" ADD CONSTRAINT "iniciativa_kpi_id_fkey" FOREIGN KEY ("kpi_id") REFERENCES "kpi"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iniciativa" ADD CONSTRAINT "iniciativa_responsavel_id_fkey" FOREIGN KEY ("responsavel_id") REFERENCES "membro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raci" ADD CONSTRAINT "raci_processo_id_fkey" FOREIGN KEY ("processo_id") REFERENCES "processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raci" ADD CONSTRAINT "raci_cargo_id_fkey" FOREIGN KEY ("cargo_id") REFERENCES "cargo_org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------- regras que o Prisma não expressa
-- Equipe: uma vaga aberta por pessoa e projeto.
CREATE UNIQUE INDEX "projeto_membro_aberto_unico" ON "projeto_membro"("oportunidade_id", "usuario_id") WHERE "fim" IS NULL;
ALTER TABLE "projeto_membro" ADD CONSTRAINT "projeto_membro_periodo" CHECK ("fim" IS NULL OR "fim" >= "inicio");

-- G&G (copiado de automacao-GG 001/005/007, com os nomes do CRM).
ALTER TABLE "membro" ADD CONSTRAINT "membro_nome" CHECK (length(trim("nome")) BETWEEN 1 AND 200);
ALTER TABLE "membro" ADD CONSTRAINT "membro_email" CHECK ("email" IS NULL OR (length("email") <= 254 AND "email" ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'));
CREATE UNIQUE INDEX "membro_email_unico" ON "membro"(lower(trim("email"))) WHERE "email" IS NOT NULL;
CREATE UNIQUE INDEX "area_org_nome_unico" ON "area_org"(lower(trim("nome")));
ALTER TABLE "area_org" ADD CONSTRAINT "area_org_sem_auto" CHECK ("superior_id" IS DISTINCT FROM "id");
CREATE UNIQUE INDEX "cargo_org_nome_unico" ON "cargo_org"(lower(trim("nome")));
ALTER TABLE "posicao" ADD CONSTRAINT "posicao_sem_auto" CHECK ("lideranca_id" IS DISTINCT FROM "id");
ALTER TABLE "ocupacao" ADD CONSTRAINT "ocupacao_periodo" CHECK ("fim" IS NULL OR "inicio" IS NULL OR "fim" >= "inicio");
CREATE UNIQUE INDEX "ocupacao_aberta_unica" ON "ocupacao"("membro_id", "posicao_id") WHERE "fim" IS NULL AND "invalidado_em" IS NULL;
CREATE UNIQUE INDEX "ocupacao_principal_unica" ON "ocupacao"("membro_id") WHERE "fim" IS NULL AND "principal" AND "invalidado_em" IS NULL;
ALTER TABLE "vinculo_ij" ADD CONSTRAINT "vinculo_ij_periodo" CHECK ("saida" IS NULL OR "entrada" IS NULL OR "saida" >= "entrada");
CREATE UNIQUE INDEX "vinculo_ij_aberto_unico" ON "vinculo_ij"("membro_id") WHERE "saida" IS NULL;
CREATE UNIQUE INDEX "raci_um_aprovador" ON "raci"("processo_id") WHERE "papel" = 'A';
ALTER TABLE "demanda" ADD CONSTRAINT "demanda_semestre" CHECK ("semestre" ~ '^[0-9]{4}\.[12]$');
ALTER TABLE "demanda" ADD CONSTRAINT "demanda_justificativa" CHECK (length(trim("justificativa")) BETWEEN 1 AND 1000);
ALTER TABLE "evento_agenda" ADD CONSTRAINT "evento_horario" CHECK ("horario" IS NULL OR "horario" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "ciclo" ADD CONSTRAINT "ciclo_periodo" CHECK ("fim" >= "inicio");

-- ---------------------------------------------------------------- estrutura inicial (sem dados pessoais)
-- Áreas do seed do G&G + a estrutura validada: cada área tem 1 diretor, lideranças (PM, PO, Scrum Master,
-- gerências) e membros. Projetos não tem gerência; Vendas, Marketing e ADM-FIN: diretor e membros.
INSERT INTO "area_org" ("id", "nome", "tipo", "superior_id", "lado_crm", "eh_gg") VALUES
  ('org_gg', 'Gente & Gestão', 'AREA', NULL, NULL, true),
  ('org_projetos', 'Projetos', 'AREA', NULL, 'PROJETOS', false),
  ('org_vendas', 'Vendas', 'AREA', NULL, 'VENDAS', false),
  ('org_marketing', 'Marketing', 'AREA', NULL, NULL, false),
  ('org_admfin', 'ADM-FIN', 'AREA', NULL, NULL, false),
  ('org_presidencia', 'Presidência', 'INSTITUCIONAL', NULL, NULL, false),
  ('org_vp', 'Vice-Presidência', 'INSTITUCIONAL', NULL, NULL, false),
  ('org_rh', 'RH', 'FRENTE', 'org_gg', NULL, false),
  ('org_pessoas', 'Pessoas', 'FRENTE', 'org_gg', NULL, false),
  ('org_endo', 'Endomarketing', 'FRENTE', 'org_gg', NULL, false),
  ('org_processos', 'Processos', 'FRENTE', 'org_gg', NULL, false);

INSERT INTO "cargo_org" ("id", "nome", "categoria", "eh_gp") VALUES
  ('cargo_presidente', 'Presidente', 'DIRETORIA', false),
  ('cargo_vp', 'Vice-Presidente', 'DIRETORIA', false),
  ('cargo_diretor', 'Diretor', 'DIRETORIA', false),
  ('cargo_gerente', 'Gerente', 'LIDERANCA', false),
  ('cargo_pm', 'PM', 'LIDERANCA', true),
  ('cargo_po', 'PO', 'LIDERANCA', false),
  ('cargo_sm', 'Scrum Master', 'LIDERANCA', false),
  ('cargo_head', 'Head', 'LIDERANCA', false),
  ('cargo_membro', 'Membro regular', 'MEMBRO', false),
  ('cargo_analista', 'Analista', 'MEMBRO', false),
  ('cargo_analista_cultura', 'Analista de Cultura/Endomarketing', 'MEMBRO', false);

INSERT INTO "posicao" ("id", "nome", "area_id", "cargo_id", "lideranca_id") VALUES
  ('pos_presidencia', 'Presidência', 'org_presidencia', 'cargo_presidente', NULL),
  ('pos_vp', 'Vice-Presidência', 'org_vp', 'cargo_vp', 'pos_presidencia'),
  ('pos_dir_gg', 'Diretoria de Gente & Gestão', 'org_gg', 'cargo_diretor', 'pos_vp'),
  ('pos_ger_rh', 'Gerência de RH', 'org_rh', 'cargo_gerente', 'pos_dir_gg'),
  ('pos_ger_pessoas', 'Gerência de Pessoas', 'org_pessoas', 'cargo_gerente', 'pos_dir_gg'),
  ('pos_ger_endo', 'Gerência de Endomarketing', 'org_endo', 'cargo_gerente', 'pos_dir_gg'),
  ('pos_ger_processos', 'Gerência de Processos', 'org_processos', 'cargo_gerente', 'pos_dir_gg'),
  ('pos_an_rh', 'Analista de RH', 'org_rh', 'cargo_analista', 'pos_ger_rh'),
  ('pos_an_pessoas', 'Analista de Pessoas', 'org_pessoas', 'cargo_analista', 'pos_ger_pessoas'),
  ('pos_an_endo', 'Analista de Endomarketing', 'org_endo', 'cargo_analista_cultura', 'pos_ger_endo'),
  ('pos_an_processos', 'Analista de Processos', 'org_processos', 'cargo_analista', 'pos_ger_processos'),
  ('pos_dir_projetos', 'Diretoria de Projetos', 'org_projetos', 'cargo_diretor', 'pos_vp'),
  ('pos_pm', 'PM', 'org_projetos', 'cargo_pm', 'pos_dir_projetos'),
  ('pos_po', 'PO', 'org_projetos', 'cargo_po', 'pos_dir_projetos'),
  ('pos_sm', 'Scrum Master', 'org_projetos', 'cargo_sm', 'pos_dir_projetos'),
  ('pos_dir_vendas', 'Diretoria de Vendas', 'org_vendas', 'cargo_diretor', 'pos_vp'),
  ('pos_membro_vendas', 'Membro de Vendas', 'org_vendas', 'cargo_membro', 'pos_dir_vendas'),
  ('pos_dir_marketing', 'Diretoria de Marketing', 'org_marketing', 'cargo_diretor', 'pos_vp'),
  ('pos_dir_admfin', 'Diretoria de ADM-FIN', 'org_admfin', 'cargo_diretor', 'pos_vp');

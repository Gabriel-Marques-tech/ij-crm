-- GAB-37: prévia do import do Pipefy (CSV + mapeamento de fases que o gestor
-- viu). Confirmar aplica exatamente esta linha; expira em 30 min.

-- CreateTable
CREATE TABLE "import_previa" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "nome_arquivo" TEXT NOT NULL,
    "conteudo" TEXT NOT NULL,
    "mapeamento" JSONB NOT NULL,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "usada_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_previa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_previa_expira_em_idx" ON "import_previa"("expira_em");

-- AddForeignKey
ALTER TABLE "import_previa" ADD CONSTRAINT "import_previa_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

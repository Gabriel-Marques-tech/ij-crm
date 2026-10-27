-- GAB-37 (review): escolhas do gestor na prévia além do mapeamento de fases
-- (ex.: motivo padrão para perdidos sem motivo). Entram no hash da prévia.
ALTER TABLE "import_previa" ADD COLUMN "opcoes" JSONB NOT NULL DEFAULT '{}';

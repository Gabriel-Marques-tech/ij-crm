-- encontrarEmpresa(dominio) (GAB-31): match exato por domínio normalizado.
CREATE INDEX "empresa_dominio_email_idx" ON "empresa"("dominio_email");

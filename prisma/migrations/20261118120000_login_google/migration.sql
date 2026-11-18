-- Entrar com Google: `sub` da conta Google amarrada ao usuário no 1º login (aditiva, nula).
ALTER TABLE "usuario" ADD COLUMN "google_sub" TEXT;

CREATE UNIQUE INDEX "usuario_google_sub_key" ON "usuario"("google_sub");

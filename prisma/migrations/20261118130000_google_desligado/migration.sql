-- Entrar com Google: quando a gestão desligou a conta Google (aditiva, nula). Depois disso,
-- o login com Google não apaga mais o convite (link de senha gerado pela gestão).
ALTER TABLE "usuario" ADD COLUMN "google_desligado_em" TIMESTAMP(3);

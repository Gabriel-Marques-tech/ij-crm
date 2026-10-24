import { createHash, randomBytes } from "node:crypto";

export const CONVITE_VALIDADE_DIAS = 7;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Token em claro vai só para o link; no banco fica apenas o hash. */
export function gerarConvite(agora: Date = new Date()) {
  const token = randomBytes(32).toString("hex");
  const expiraEm = new Date(agora.getTime() + CONVITE_VALIDADE_DIAS * 24 * 60 * 60 * 1000);
  return { token, hash: hashToken(token), expiraEm };
}

export function conviteEstaValido(
  u: { conviteExpiraEm: Date | null },
  agora: Date = new Date(),
): boolean {
  return u.conviteExpiraEm !== null && u.conviteExpiraEm.getTime() > agora.getTime();
}

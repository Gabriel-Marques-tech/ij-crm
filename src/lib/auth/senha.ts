import { hash, verify } from "@node-rs/argon2";

export const SENHA_MIN = 8;

export function senhaAtendeRegras(senha: string): boolean {
  return senha.length >= SENHA_MIN;
}

export function gerarHashSenha(senha: string): Promise<string> {
  return hash(senha);
}

/** Hash nulo (convite pendente) nunca autentica. */
export async function verificarSenha(hashArmazenado: string | null, senha: string): Promise<boolean> {
  if (!hashArmazenado) return false;
  try {
    return await verify(hashArmazenado, senha);
  } catch {
    return false;
  }
}

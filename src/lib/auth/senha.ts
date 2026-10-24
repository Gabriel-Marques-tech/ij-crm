import { hash, verify } from "@node-rs/argon2";

export const SENHA_MIN = 8;

export function senhaAtendeRegras(senha: string): boolean {
  return senha.length >= SENHA_MIN;
}

export function gerarHashSenha(senha: string): Promise<string> {
  return hash(senha);
}

// Hash "fantasma" usado quando não há hash real: mantém o custo do argon2 igual
// para email inexistente / convite pendente, evitando enumeração por tempo.
let hashFantasma: Promise<string> | undefined;
function obterHashFantasma(): Promise<string> {
  hashFantasma ??= hash("fantasma-" + Math.random().toString(36));
  return hashFantasma;
}

/** Hash nulo (convite pendente) nunca autentica, mas paga o mesmo tempo. */
export async function verificarSenha(hashArmazenado: string | null, senha: string): Promise<boolean> {
  if (!hashArmazenado) {
    try {
      await verify(await obterHashFantasma(), senha);
    } catch {
      /* ignorado */
    }
    return false;
  }
  try {
    return await verify(hashArmazenado, senha);
  } catch {
    return false;
  }
}

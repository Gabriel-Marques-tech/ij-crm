import type { Papel } from "@prisma/client";

const NIVEL: Record<Papel, number> = { VENDEDOR: 0, GESTOR: 1, ADMIN: 2 };

export function temPapelMinimo(papel: Papel, minimo: Papel): boolean {
  return NIVEL[papel] >= NIVEL[minimo];
}

/** Quem pode convidar/promover para qual papel (design doc, matriz §4.5). */
export function podeAtribuirPapel(quem: Papel, alvo: Papel): boolean {
  if (quem === "VENDEDOR") return false;
  if (quem === "GESTOR") return alvo !== "ADMIN";
  return true;
}

/**
 * Quem pode gerar link de redefinição de senha para quem (GAB-43). Regra
 * própria, mais estrita que `podeAtribuirPapel`: só para papel ESTRITAMENTE
 * inferior (gestor → vendedor), exceto admin, que redefine qualquer um
 * (inclusive outro admin). "A si mesmo" é barrado no serviço.
 */
export function podeGerarRedefinicao(quem: Papel, alvo: Papel): boolean {
  if (quem === "ADMIN") return true;
  return NIVEL[quem] > NIVEL[alvo] && quem !== "VENDEDOR";
}

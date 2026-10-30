import type { Papel } from "@prisma/client";

/**
 * VISUALIZADOR fica ABAIXO do vendedor: `temPapelMinimo(p, "VENDEDOR")` é o
 * mesmo que "pode escrever" (`podeEscrever`). O visualizador só lê.
 * PROJETOS (GAB-82) tem o MESMO nível de VENDEDOR: lê e edita card igual; o
 * que muda é o lado (ver ./areas.ts), não a permissão.
 */
const NIVEL: Record<Papel, number> = { VISUALIZADOR: -1, VENDEDOR: 0, PROJETOS: 0, GESTOR: 1, ADMIN: 2 };

/** Rótulo de tela de cada papel (tabela de usuários, perfil, topbar). */
export const ROTULO_PAPEL: Record<Papel, string> = {
  ADMIN: "Admin",
  GESTOR: "Gestor",
  VENDEDOR: "Vendedor",
  PROJETOS: "Projetos",
  VISUALIZADOR: "Visualizador",
};

/** Todos os papéis, do menor ao maior. */
export const PAPEIS: readonly Papel[] = ["VISUALIZADOR", "VENDEDOR", "PROJETOS", "GESTOR", "ADMIN"];

export function temPapelMinimo(papel: Papel, minimo: Papel): boolean {
  return NIVEL[papel] >= NIVEL[minimo];
}

/** Escreve no CRM (cards, comentários, contatos, empresas, prazos…): todo papel menos VISUALIZADOR. */
export function podeEscrever(papel: Papel): boolean {
  return temPapelMinimo(papel, "VENDEDOR");
}

/**
 * Filtro Prisma de "quem atua em card": pode ser responsável, autor de prazo,
 * remetente do WhatsApp, participante do ranking. Exclui VISUALIZADOR.
 */
export const QUEM_ATUA = { papel: { not: "VISUALIZADOR" } } as const satisfies { papel: { not: Papel } };

/** Quem pode convidar/promover para qual papel (design doc, matriz §4.5). */
export function podeAtribuirPapel(quem: Papel, alvo: Papel): boolean {
  if (!temPapelMinimo(quem, "GESTOR")) return false;
  if (quem === "GESTOR") return alvo !== "ADMIN";
  return true;
}

/**
 * Quem pode gerar link de redefinição de senha para quem (GAB-43). Regra
 * própria, mais estrita que `podeAtribuirPapel`: só para papel ESTRITAMENTE
 * inferior (gestor → vendedor/visualizador), exceto admin, que redefine
 * qualquer um (inclusive outro admin). Gestor → projetos também vale. "A si mesmo" é barrado no serviço.
 */
export function podeGerarRedefinicao(quem: Papel, alvo: Papel): boolean {
  if (quem === "ADMIN") return true;
  return NIVEL[quem] > NIVEL[alvo] && temPapelMinimo(quem, "GESTOR");
}

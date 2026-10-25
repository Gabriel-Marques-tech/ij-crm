/**
 * Busca por nome (Empresa/Contato) para autocomplete e listas. É só para
 * EXIBIR opções: vínculo é sempre escolha explícita do usuário e nunca entra
 * em match automático (anti-objetivo §2, "ELO" × "TORRES DE MELO").
 */

/**
 * Escapa os curingas do LIKE/ILIKE (`\`, `%`, `_`): o Prisma passa o texto de
 * `contains`/`startsWith` direto para o padrão, e "%" listaria tudo.
 */
export function escaparLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export const BUSCA_MAX = 100;

/** Texto da busca: aparado, limitado, já escapado para LIKE. Vazio → null. */
export function termoDeBusca(busca: string | undefined): string | null {
  const q = (busca ?? "").trim().slice(0, BUSCA_MAX);
  return q ? escaparLike(q) : null;
}

/**
 * Prefixo primeiro, depois "contém": duas queries (a segunda exclui os ids da
 * primeira), cada uma já ordenada por nome no banco.
 */
export async function prefixoPrimeiro<T extends { id: string }>(
  limite: number,
  buscar: (modo: "prefixo" | "contem", excluir: string[], take: number) => Promise<T[]>,
): Promise<T[]> {
  const primeiros = await buscar("prefixo", [], limite);
  if (primeiros.length >= limite) return primeiros;
  const resto = await buscar("contem", primeiros.map((p) => p.id), limite - primeiros.length);
  return [...primeiros, ...resto];
}

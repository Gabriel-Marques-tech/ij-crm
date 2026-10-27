/** Consultas com `in` grande divididas em lotes: teto de parâmetros do Postgres (32.767) e planos previsíveis. */
export const TAMANHO_IN = 1000;

export async function emLotes<T, R>(itens: T[], fn: (lote: T[]) => Promise<R[]>, tamanho = TAMANHO_IN): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < itens.length; i += tamanho) out.push(...(await fn(itens.slice(i, i + tamanho))));
  return out;
}

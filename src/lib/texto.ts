/**
 * Corta texto sem partir caractere: anda por code point (`Array.from`), então
 * um emoji (par substituto UTF-16) nunca fica pela metade. O resultado tem no
 * máximo `max` unidades UTF-16 — a mesma conta do `.length`/zod `.max`, então
 * o texto cortado continua passando na validação.
 */
export function cortarTexto(t: string, max: number): { texto: string; truncado: boolean } {
  if (t.length <= max) return { texto: t, truncado: false };
  let tamanho = 0;
  let fim = 0;
  for (const ch of Array.from(t)) {
    if (tamanho + ch.length > max) break;
    tamanho += ch.length;
    fim += ch.length;
  }
  return { texto: t.slice(0, fim), truncado: true };
}

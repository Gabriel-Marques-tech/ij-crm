import type { CardCliente } from "./tipos";

/**
 * Desfaz um movimento otimista que falhou, sobre o estado atual: se o card
 * ainda está na fase para onde o movimento o levou, volta para a fase e o
 * `faseDesde` originais (mesma posição na lista); se já saiu de lá (outro
 * movimento posterior) ou sumiu, não mexe.
 */
export function desfazerMovimento(cards: CardCliente[], cardId: string, paraFaseId: string, original: CardCliente): CardCliente[] {
  const i = cards.findIndex((c) => c.id === cardId);
  if (i < 0 || cards[i].faseId !== paraFaseId) return cards;
  const copia = cards.slice();
  copia[i] = { ...cards[i], faseId: original.faseId, faseDesdeMs: original.faseDesdeMs };
  return copia;
}

/**
 * Ruído óbvio de mensagem sem `#crm` (GAB-39): nenhuma letra nem dígito —
 * só emoji, figurinha convertida, pontuação, símbolo. Não vai à LLM; conta
 * como descartada. Sem regra de tamanho: "fechou!", "perdeu", "fechado"
 * podem ser venda e vão ao classificador. Puro.
 */
export function ruidoObvio(texto: string): boolean {
  return !/[\p{L}\p{N}]/u.test(texto);
}

/**
 * Normalização de identificadores (design doc §4.2). Contrato único: a mesma
 * função é usada na UI, no import e na ingestão do WhatsApp. Match automático
 * entre contatos só acontece por valor normalizado exato — nunca por nome.
 */

export function normalizarEmail(entrada: string): string | null {
  const v = entrada.trim().toLowerCase();
  if (!v || !v.includes("@")) return null;
  return v;
}

/**
 * Telefone brasileiro → E.164 (+55DDNÚMERO). Aceita máscaras comuns, prefixo
 * 0 de operadora, DDI com ou sem "+". Retorna null se não parece BR válido.
 */
export function normalizarTelefoneBr(entrada: string): string | null {
  let d = entrada.replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.startsWith("0") && d.length === 11) d = d.slice(1); // 0 + DDD + 8 dígitos (fixo com zero)
  if (d.startsWith("0") && d.length === 12) d = d.slice(1); // 0 + DDD + 9 dígitos
  if (d.length !== 10 && d.length !== 11) return null;
  const ddd = Number(d.slice(0, 2));
  if (ddd < 11 || ddd > 99) return null;
  return `+55${d}`;
}

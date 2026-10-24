/**
 * Normalização de identificadores (design doc §4.2). Contrato único: a mesma
 * função é usada na UI, no import e na ingestão do WhatsApp. Match automático
 * entre contatos só acontece por valor normalizado exato — nunca por nome.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizarEmail(entrada: string): string | null {
  const v = entrada.trim().toLowerCase();
  if (!EMAIL_RE.test(v)) return null;
  return v;
}

/**
 * Telefone brasileiro → E.164 (+55DDNÚMERO). Aceita máscaras comuns, prefixo
 * 0 de operadora, DDI 55 com ou sem "+". Um "+" seguido de outro DDI é
 * rejeitado (nunca converter número estrangeiro em BR por acidente).
 */
export function normalizarTelefoneBr(entrada: string): string | null {
  const bruto = entrada.trim();
  let d = bruto.replace(/\D/g, "");
  if (!d) return null;
  if (bruto.startsWith("+")) {
    if (!d.startsWith("55")) return null;
    d = d.slice(2);
  } else if (d.startsWith("55") && d.length >= 12) {
    d = d.slice(2);
  }
  if (d.startsWith("0") && (d.length === 11 || d.length === 12)) d = d.slice(1); // 0 + DDD + número
  if (d.length !== 10 && d.length !== 11) return null;
  const ddd = Number(d.slice(0, 2));
  if (ddd < 11 || ddd > 99) return null;
  return `+55${d}`;
}

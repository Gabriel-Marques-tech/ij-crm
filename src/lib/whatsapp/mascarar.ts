/**
 * Mascaramento para logs (design doc §4.6: logs mascaram telefone). Nenhum
 * identificador de WhatsApp sai em claro acima de `debug`.
 */

/** `+5511999998888` → `+55*********88`. Fora do BR mantém só os 2 últimos dígitos. */
export function mascararTelefone(telefone: string): string {
  const digitos = telefone.replace(/\D/g, "");
  if (!digitos) return "";
  if (digitos.length <= 4) return "*".repeat(digitos.length);
  const ddi = digitos.startsWith("55") ? "55" : "";
  const meio = digitos.length - ddi.length - 2;
  return `+${ddi}${"*".repeat(meio)}${digitos.slice(-2)}`;
}

/** JID (`@s.whatsapp.net`, `@g.us`, `@lid`) com a parte local mascarada; sem `@` trata como telefone. */
export function mascararJid(jid: string): string {
  const arroba = jid.indexOf("@");
  if (arroba < 0) return mascararTelefone(jid);
  const local = jid.slice(0, arroba);
  const servidor = jid.slice(arroba);
  if (servidor === "@s.whatsapp.net") return `${mascararTelefone(local)}${servidor}`;
  if (local.length <= 4) return `${"*".repeat(local.length)}${servidor}`;
  return `${local.slice(0, 2)}${"*".repeat(local.length - 4)}${local.slice(-2)}${servidor}`;
}

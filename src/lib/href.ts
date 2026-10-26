/**
 * `href` vindo do banco (site da empresa, link da proposta) só vira link se
 * for http(s) absoluto. Import/edição antiga pode ter gravado `javascript:`,
 * `data:` etc.: aí o valor é exibido como texto, nunca em `href`.
 */
export function hrefSeguro(valor: string | null | undefined): string | null {
  if (!valor) return null;
  try {
    const u = new URL(valor.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

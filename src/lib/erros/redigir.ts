/**
 * Redação de PII na mensagem de um erro genérico antes de ir ao log: mantém
 * o texto técnico legível (a causa precisa estar no log) e mascara o que pode
 * identificar alguém ou dar acesso. Uma função só, para todo log de erro.
 */
const MAX = 200;

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const CNPJ = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
// Token: 20+ caracteres de hex/base64/base64url com ao menos um dígito
// (identificadores de código, como `PrismaClientKnownRequestError`, não têm).
const TOKEN = /[A-Za-z0-9+/_-]{20,}={0,2}/g;
// Telefone / sequência longa de dígitos: 8+ dígitos, com ou sem pontuação.
const NUMERO = /\+?\(?\d[\d\s().-]{6,}\d/g;

export function redigirPii(texto: string): string {
  const r = texto
    .replace(EMAIL, "[email]")
    .replace(CNPJ, "[doc]")
    .replace(CPF, "[doc]")
    .replace(TOKEN, (m) => (/\d/.test(m) && /[A-Za-z]/.test(m) ? "[token]" : m))
    .replace(NUMERO, (m) => ((m.match(/\d/g) ?? []).length >= 8 ? "[num]" : m));
  return r.length > MAX ? `${r.slice(0, MAX)}…` : r;
}

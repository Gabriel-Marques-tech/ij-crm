/**
 * Identificadores EXATOS citados no texto de uma mensagem (design doc §4.3
 * passo 6): telefone, email e CNPJ, já normalizados. É o que alimenta os
 * candidatos de match — nunca nome. Puro.
 *
 * Telefone digitado no texto usa `{ exigirDdi: false }` (ninguém escreve o 55);
 * o telefone do REMETENTE (payload do WhatsApp) usa `exigirDdi: true` em
 * `payload.ts`. CNPJ é extraído primeiro e seus dígitos saem do texto, para
 * não virarem telefone.
 */
import { normalizarCnpj, normalizarEmail, normalizarTelefoneBr } from "@/lib/normalizacao";

export type Identificadores = { telefones: string[]; emails: string[]; cnpjs: string[] };

const EMAIL = /[^\s@<>,;:"'()[\]]+@[^\s@<>,;:"'()[\]]+\.[a-z]{2,}/giu;
const CNPJ = /(?<![0-9A-Z])[0-9A-Z]{2}\.?[0-9A-Z]{3}\.?[0-9A-Z]{3}\/?[0-9A-Z]{4}-?\d{2}(?![0-9A-Z])/giu;
// Opcional +55, DDD (com ou sem parênteses), 8–9 dígitos com hífen/espaço opcional.
const TELEFONE = /(?<![\d/.,])(?:\+?55[\s.-]?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}(?![\d/])/gu;

function unicos(lista: (string | null)[]): string[] {
  return [...new Set(lista.filter((v): v is string => !!v))];
}

export function extrairIdentificadores(texto: string): Identificadores {
  const emails = unicos([...texto.matchAll(EMAIL)].map((m) => normalizarEmail(m[0])));
  let resto = texto.replace(EMAIL, " ");
  const cnpjs = unicos([...resto.matchAll(CNPJ)].map((m) => normalizarCnpj(m[0].toUpperCase())));
  resto = resto.replace(CNPJ, " ");
  const telefones = unicos([...resto.matchAll(TELEFONE)].map((m) => normalizarTelefoneBr(m[0], { exigirDdi: false })));
  return { telefones, emails, cnpjs };
}

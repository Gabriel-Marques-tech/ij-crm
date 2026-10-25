/**
 * Normalização de identificadores (design doc §4.2). Contrato único: a mesma
 * função é usada na UI, no import e na ingestão do WhatsApp. Match automático
 * entre contatos só acontece por valor normalizado exato — nunca por nome.
 *
 * Puro (sem banco): pode ser importado no cliente e no servidor.
 */
import type { TipoContatoPonto } from "@prisma/client";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizarEmail(entrada: string): string | null {
  const v = entrada.trim().toLowerCase();
  if (!EMAIL_RE.test(v)) return null;
  return v;
}

/** DDDs em uso (Anatel). Qualquer outro par de dígitos não é telefone BR. */
const DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62,
  63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/**
 * Telefone brasileiro → E.164 (+55DDNÚMERO). Aceita máscaras comuns, prefixo
 * 0 de operadora, DDI 55 com ou sem "+". Um "+" seguido de outro DDI é
 * rejeitado (nunca converter número estrangeiro em BR por acidente).
 *
 * Nono dígito: celular (assinante começando com 6–9) sem o 9 ganha o 9 —
 * o WhatsApp de contas antigas entrega `55DD8888-7777`, e o mesmo celular
 * digitado com o 9 tem de cair no mesmo valor. Fixo (2–5) fica com 8 dígitos.
 * Com 9 dígitos, o assinante precisa começar com 9 (é a regra do celular).
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
  if (!DDDS.has(Number(d.slice(0, 2)))) return null;
  const ddd = d.slice(0, 2);
  let assinante = d.slice(2);
  if (assinante.length === 9 && assinante[0] !== "9") return null;
  if (assinante.length === 8 && /^[6-9]/.test(assinante)) assinante = `9${assinante}`;
  return `+55${ddd}${assinante}`;
}

// ---------------------------------------------------------------- CNPJ

const PESOS_DV1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_DV2 = [6, ...PESOS_DV1];

/** Valor de um caractere no cálculo do DV do CNPJ alfanumérico: código ASCII − 48 ('0'→0, 'A'→17). */
function valorCnpj(c: string): number {
  return c.charCodeAt(0) - 48;
}

function dvCnpj(base: string, pesos: number[]): number {
  let soma = 0;
  for (let i = 0; i < pesos.length; i++) soma += valorCnpj(base[i]) * pesos[i];
  const r = soma % 11;
  return r < 2 ? 0 : 11 - r;
}

/**
 * CNPJ → 14 caracteres maiúsculos, sem pontuação. Formato alfanumérico
 * (IN RFB 2.229/2024, a partir de jul/2026): 12 posições [0-9A-Z] + 2 DVs
 * numéricos, calculados por módulo 11 com o valor ASCII − 48 de cada
 * caractere — o mesmo algoritmo do CNPJ numérico, que continua válido.
 * Remove só pontuação (`.`, `/`, `-`, espaços); **nunca `\D`**, que apagaria
 * as letras. Outros símbolos, tamanho ≠ 14 ou DV errado → null.
 */
export function normalizarCnpj(entrada: string): string | null {
  const v = entrada.replace(/[\s./-]/g, "").toUpperCase();
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(v)) return null;
  if (/^(.)\1+$/.test(v)) return null;
  const base = v.slice(0, 12);
  const dv1 = dvCnpj(base, PESOS_DV1);
  const dv2 = dvCnpj(base + dv1, PESOS_DV2);
  return v.endsWith(`${dv1}${dv2}`) ? v : null;
}

/** `12ABC34501DE35` → `12.ABC.345/01DE-35` (só exibição). */
export function formatarCnpj(cnpj: string): string {
  if (cnpj.length !== 14) return cnpj;
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
}

// ---------------------------------------------------------------- domínio

const ROTULO_DOMINIO = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Domínio de uma empresa a partir de email (`ana@acme.com.br`), URL
 * (`https://www.acme.com.br/x`) ou do próprio domínio: lowercase, sem
 * `www.`, sem porta/caminho/ponto final. Exige ao menos um ponto e TLD
 * alfabético.
 */
export function normalizarDominio(entrada: string): string | null {
  let v = entrada.trim().toLowerCase();
  if (!v || /\s/.test(v)) return null;
  const arroba = v.lastIndexOf("@");
  if (arroba >= 0) v = v.slice(arroba + 1);
  v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // esquema
  v = v.split(/[/?#]/, 1)[0];
  v = v.replace(/:\d*$/, ""); // porta
  v = v.replace(/\.$/, "");
  v = v.replace(/^www\./, "");
  const rotulos = v.split(".");
  if (rotulos.length < 2) return null;
  if (!rotulos.every((r) => ROTULO_DOMINIO.test(r))) return null;
  if (!/^[a-z]{2,}$/.test(rotulos[rotulos.length - 1])) return null;
  return v;
}

/**
 * Provedores de email de uso pessoal: o domínio não identifica empresa, então
 * nunca é gravado como `dominio_email` nem usado em `encontrarEmpresa`.
 */
const DOMINIOS_PUBLICOS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.com.br",
  "outlook.com",
  "outlook.com.br",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.com.br",
  "icloud.com",
  "me.com",
  "mac.com",
  "uol.com.br",
  "bol.com.br",
  "terra.com.br",
  "ig.com.br",
  "globo.com",
  "globomail.com",
  "r7.com",
  "zipmail.com.br",
  "protonmail.com",
  "proton.me",
  "aol.com",
  "gmx.com",
  "yandex.com",
]);

export function ehDominioPublico(dominio: string): boolean {
  return DOMINIOS_PUBLICOS.has(dominio);
}

// ---------------------------------------------------------------- pontos de contato

export type PontoNormalizado = { tipo: TipoContatoPonto; valorNormalizado: string };

/**
 * Normaliza um ponto de contato. Sem `tipo`, decide pela forma: com `@` é
 * email, senão telefone. null = não é um identificador válido daquele tipo.
 */
export function normalizarPonto(entrada: string, tipo?: TipoContatoPonto): PontoNormalizado | null {
  const t = tipo ?? (entrada.includes("@") ? "EMAIL" : "TELEFONE");
  const v = t === "EMAIL" ? normalizarEmail(entrada) : normalizarTelefoneBr(entrada);
  return v ? { tipo: t, valorNormalizado: v } : null;
}

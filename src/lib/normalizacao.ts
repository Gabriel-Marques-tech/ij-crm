/**
 * Normalização de identificadores (design doc §4.2). Contrato único: a mesma
 * função é usada na UI, no import e na ingestão do WhatsApp. Match automático
 * entre contatos só acontece por valor normalizado exato — nunca por nome.
 *
 * Puro (sem banco): pode ser importado no cliente e no servidor.
 */
import type { TipoContatoPonto } from "@prisma/client";

/** Parte local: sem espaço, `@`, `<>`, `,`, `;`, aspas. */
const LOCAL_EMAIL_RE = /^[^\s@<>,;"']+$/;

/**
 * Email → `local@dominio` em minúsculas. Tira o "embrulho" comum de quem cola
 * de um cabeçalho ou texto (`<ana@acme.com>`, aspas, `.,;:` no fim). O
 * domínio passa pela mesma normalização do domínio de empresa (IDN →
 * punycode, TLD alfabético), para email e empresa casarem igual.
 */
export function normalizarEmail(entrada: string): string | null {
  let v = entrada.trim();
  for (;;) {
    const antes = v;
    v = v.replace(/^[<"'\s]+/, "").replace(/[>"'\s.,;:]+$/, "");
    if (v === antes) break;
  }
  v = v.toLowerCase();
  const arroba = v.indexOf("@");
  if (arroba <= 0 || arroba !== v.lastIndexOf("@")) return null;
  const local = v.slice(0, arroba);
  if (!LOCAL_EMAIL_RE.test(local)) return null;
  const dominio = dominioValido(v.slice(arroba + 1));
  return dominio ? `${local}@${dominio}` : null;
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
 * Assinante: fixo `[2-5]` + 7 dígitos; celular `9[6-9]` + 7 dígitos.
 * Começando com 0/1 não é assinante válido.
 *
 * Sem "+", o padrão é BR (CRM brasileiro: na UI ninguém digita o 55). Quem
 * recebe número que SEMPRE traz DDI (ingestão do WhatsApp, import) passa
 * `{ exigirDdi: true }`: aí `5551234567` não vira um fixo de Porto Alegre
 * por acidente — sem 55 + DDD + assinante completo, é null.
 */
export function normalizarTelefoneBr(entrada: string, opcoes: { exigirDdi?: boolean } = {}): string | null {
  const bruto = entrada.trim();
  let d = bruto.replace(/\D/g, "");
  if (!d) return null;
  if (bruto.startsWith("+") || opcoes.exigirDdi) {
    if (!d.startsWith("55")) return null;
    d = d.slice(2);
  } else if (d.startsWith("55") && d.length >= 12) {
    d = d.slice(2);
  } else if (d.startsWith("0") && (d.length === 11 || d.length === 12)) {
    d = d.slice(1); // 0 + DDD + número
  }
  if (d.length !== 10 && d.length !== 11) return null;
  if (!DDDS.has(Number(d.slice(0, 2)))) return null;
  const ddd = d.slice(0, 2);
  let assinante = d.slice(2);
  if (assinante.length === 9 && !/^9[6-9]/.test(assinante)) return null;
  if (assinante.length === 8) {
    if (/^[6-9]/.test(assinante)) assinante = `9${assinante}`;
    else if (!/^[2-5]/.test(assinante)) return null;
  }
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
const TLD = /^(?:[a-z]{2,}|xn--[a-z0-9-]+)$/;

/**
 * Host → forma canônica: minúsculo, sem ponto final, IDN em punycode
 * (`ação.com.br` → `xn--ao-siap.com.br`, via WHATWG URL), rótulos válidos,
 * ≥ 2 rótulos e TLD alfabético. Usado no domínio de email E no de empresa,
 * para que os dois casem igual.
 */
function dominioValido(host: string): string | null {
  const bruto = host.trim().replace(/\.$/, "");
  if (!bruto || /[\s/?#@:]/.test(bruto)) return null;
  let v: string;
  try {
    v = new URL(`http://${bruto}`).hostname;
  } catch {
    return null;
  }
  const rotulos = v.split(".");
  if (rotulos.length < 2) return null;
  if (!rotulos.every((r) => ROTULO_DOMINIO.test(r))) return null;
  if (!TLD.test(rotulos[rotulos.length - 1])) return null;
  return v;
}

/**
 * Domínio de uma empresa a partir de email (`ana@acme.com.br`), URL
 * (`https://www.acme.com.br/x`) ou do próprio domínio: lowercase, sem
 * `www.`, sem porta/caminho/ponto final, IDN em punycode.
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
  return dominioValido(v);
}

/**
 * Provedores de email de uso pessoal: o domínio não identifica empresa, então
 * nunca é gravado como `dominio_email` nem usado em `encontrarEmpresa`.
 * `familias` cobre os que existem em vários TLDs (`gmx.de`, `yandex.ru`,
 * `yahoo.co.uk`…): primeiro rótulo + TLD de país/genérico curto.
 */
export const PROVEDORES_PESSOAIS = {
  dominios: [
    "gmail.com", "googlemail.com",
    "hotmail.com", "hotmail.com.br", "outlook.com", "outlook.com.br", "live.com", "live.com.br", "msn.com", "msn.com.br",
    "yahoo.com", "yahoo.com.br", "ymail.com", "rocketmail.com",
    "icloud.com", "me.com", "mac.com",
    "proton.me", "protonmail.com", "protonmail.ch", "pm.me",
    "uol.com.br", "bol.com.br", "terra.com.br", "ig.com.br", "globo.com", "globomail.com", "r7.com", "zipmail.com.br", "oi.com.br",
    "zoho.com", "zohomail.com", "aol.com", "mail.com", "email.com", "tutanota.com", "tuta.io", "fastmail.com", "hey.com",
  ],
  familias: ["gmx", "yandex", "yahoo", "hotmail", "outlook", "live"],
} as const;

const PESSOAIS = new Set<string>(PROVEDORES_PESSOAIS.dominios);
const FAMILIA_TLD = /^[a-z]{2,3}(?:\.[a-z]{2})?$/;

export function ehDominioPublico(dominio: string): boolean {
  if (PESSOAIS.has(dominio)) return true;
  const ponto = dominio.indexOf(".");
  const primeiro = dominio.slice(0, ponto);
  return (PROVEDORES_PESSOAIS.familias as readonly string[]).includes(primeiro) && FAMILIA_TLD.test(dominio.slice(ponto + 1));
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

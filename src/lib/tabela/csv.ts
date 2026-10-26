/**
 * Células de CSV para o Excel pt-BR (GAB-35): separador `;`, vírgula decimal,
 * datas dd/mm/aaaa no fuso de negócio, CRLF e BOM UTF-8 (sem o BOM o Excel
 * lê como Windows-1252 e quebra os acentos).
 *
 * Texto vindo do usuário/WhatsApp passa por `celulaTexto`, que neutraliza
 * formula injection (OWASP "CSV Injection"): célula que começa com
 * `= + - @`, tab ou CR ganha um `'` na frente e o Excel a trata como texto.
 * Números e datas são formatados aqui mesmo, então não passam pela guarda
 * (um "-" legítimo de número não vira texto).
 */
import { FUSO_NEGOCIO } from "@/lib/oportunidades/aging";

export const BOM = "﻿";
export const SEPARADOR = ";";
const FIM_LINHA = "\r\n";

const INICIO_PERIGOSO = /^[=+\-@\t\r]/;
const PRECISA_ASPAS = /[;"\r\n]/;

function aspas(v: string): string {
  return PRECISA_ASPAS.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function celulaTexto(v: string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  return aspas(INICIO_PERIGOSO.test(v) ? `'${v}` : v);
}

/** Decimal do Prisma (`toFixed`), string decimal ("1234.5") ou inteiro. */
export function celulaNumero(v: { toFixed(n: number): string } | string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number" && Number.isInteger(v)) return String(v);
  const fixo = typeof v === "string" ? Number(v).toFixed(2) : v.toFixed(2);
  return fixo.replace(".", ",");
}

const DATA = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO_NEGOCIO, day: "2-digit", month: "2-digit", year: "numeric" });
const DATA_HORA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO_NEGOCIO,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function celulaData(d: Date | null | undefined): string {
  return d ? DATA.format(d) : "";
}

export function celulaDataHora(d: Date | null | undefined): string {
  return d ? DATA_HORA.format(d).replace(",", "") : "";
}

/** Células já escapadas → uma linha. */
export function linhaCsv(celulas: string[]): string {
  return celulas.join(SEPARADOR) + FIM_LINHA;
}

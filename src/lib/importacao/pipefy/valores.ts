/**
 * Valores das células do export do Pipefy → tipos do CRM. Puro.
 *
 * Datas: o Pipefy exporta no fuso da conta (São Paulo) como `dd/mm/aaaa HH:mm`
 * (às vezes com segundos, às vezes só a data) e a API devolve ISO 8601. Data
 * sem fuso é lida como São Paulo (-03:00 fixo: sem horário de verão desde 2019).
 */
import type { Origem } from "@prisma/client";
import { lerDinheiro } from "@/lib/oportunidades/terminal-regras";

export type Lido<T> = { ok: true; valor: T | null } | { ok: false };

const BR = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i;

function montar(a: number, m: number, d: number, h: number, min: number, s: number, ms: number, fuso: string | null): Date | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || min > 59 || s > 59) return null;
  const p2 = (n: number) => String(n).padStart(2, "0");
  const offset = fuso === null ? "-03:00" : fuso.toUpperCase() === "Z" ? "Z" : fuso.includes(":") ? fuso : `${fuso.slice(0, 3)}:${fuso.slice(3)}`;
  const iso = `${a}-${p2(m)}-${p2(d)}T${p2(h)}:${p2(min)}:${p2(s)}.${String(ms).padStart(3, "0")}${offset}`;
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return null;
  // Rejeita data que o JS "rola" (31/02 → 03/03): confere o dia no fuso de origem.
  const minutosOffset = offset === "Z" ? 0 : (offset[0] === "-" ? -1 : 1) * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
  const local = new Date(dt.getTime() + minutosOffset * 60_000);
  if (local.getUTCFullYear() !== a || local.getUTCMonth() + 1 !== m || local.getUTCDate() !== d) return null;
  return dt;
}

/** Vazio → null; formato desconhecido ou data impossível → `{ ok: false }`. */
export function lerData(bruto: string): Lido<Date> {
  const t = bruto.trim();
  if (t === "") return { ok: true, valor: null };
  let m = BR.exec(t);
  if (m) {
    const d = montar(+m[3], +m[2], +m[1], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), 0, null);
    return d ? { ok: true, valor: d } : { ok: false };
  }
  m = ISO.exec(t);
  if (m) {
    const ms = m[7] ? Number(m[7].padEnd(3, "0").slice(0, 3)) : 0;
    const d = montar(+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), ms, m[8] ?? null);
    return d ? { ok: true, valor: d } : { ok: false };
  }
  return { ok: false };
}

/**
 * Dinheiro → "12500.00". Aceita o formato BR estrito da UI (`lerDinheiro`:
 * `R$ 12.500,00`) e, por ser export de sistema, também ponto decimal simples
 * (`12500.5`, `12500.00`). `1.234` continua sendo mil duzentos e trinta e quatro.
 */
export function lerValor(bruto: string): Lido<string> {
  const t = bruto.trim();
  if (t === "") return { ok: true, valor: null };
  const br = lerDinheiro(t);
  if (br.ok) return br;
  const m = /^(?:R\$\s*)?(\d{1,12})\.(\d{1,2})$/i.exec(t);
  if (m) return { ok: true, valor: Number(`${m[1]}.${m[2]}`).toFixed(2) };
  return { ok: false };
}

/** Texto comparável: sem acento, minúsculo, espaços/pontuação colapsados. */
export function normalizarTexto(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const ORIGENS: [string, Origem][] = [
  ["cold call", "COLD_CALL"],
  ["cold", "COLD_CALL"],
  ["prospeccao ativa", "COLD_CALL"],
  ["rd", "RD"],
  ["rd station", "RD"],
  ["inbound", "RD"],
  ["indicacao", "INDICACAO"],
  ["evento", "EVENTO"],
  ["eventos", "EVENTO"],
  ["outro", "OUTRO"],
  ["outros", "OUTRO"],
];

/** Origem do lead por rótulo conhecido; texto desconhecido → null (quem chama decide). */
export function lerOrigem(bruto: string): Origem | null {
  const t = normalizarTexto(bruto);
  return ORIGENS.find(([k]) => k === t)?.[1] ?? null;
}

/** Célula com vários valores (responsáveis, etiquetas, telefones): `,` `;` `|` ou quebra de linha. */
export function lerLista(bruto: string): string[] {
  return bruto
    .split(/[,;|\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Janelas de contexto da LLM (GAB-49): blocos FIXOS de 12 h no fuso de
 * negócio — 00:00–12:00 e 12:00–24:00 de America/Sao_Paulo. Puro.
 *
 * O deslocamento do fuso é lido do `Intl` no próprio instante (SP não tem
 * horário de verão desde 2019, mas se voltar a ter o cálculo continua certo
 * fora da hora da troca).
 */
import { FUSO_NEGOCIO } from "@/lib/oportunidades/aging";

export type Janela = { inicio: Date; fim: Date };

const HORA_MS = 60 * 60 * 1000;

const PARTES = new Intl.DateTimeFormat("en-US", {
  timeZone: FUSO_NEGOCIO,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Relógio de parede de SP do instante, como se fosse UTC (ms). */
function paredeComoUtc(instante: Date): { ms: number; ano: number; mes: number; dia: number; hora: number } {
  const p = Object.fromEntries(PARTES.formatToParts(instante).map((x) => [x.type, Number(x.value)]));
  const ms = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return { ms, ano: p.year, mes: p.month, dia: p.day, hora: p.hour };
}

/** Janela de 12 h que contém o instante. */
export function janelaDe(instante: Date): Janela {
  const t = new Date(Math.floor(instante.getTime() / 1000) * 1000);
  const w = paredeComoUtc(t);
  const deslocamento = w.ms - t.getTime(); // SP: -3 h
  const inicioParede = Date.UTC(w.ano, w.mes - 1, w.dia, w.hora < 12 ? 0 : 12);
  const inicio = new Date(inicioParede - deslocamento);
  return { inicio, fim: new Date(inicio.getTime() + 12 * HORA_MS) };
}

/** Janela imediatamente anterior à do instante. */
export function janelaAnterior(instante: Date): Janela {
  return janelaDe(new Date(janelaDe(instante).inicio.getTime() - 1));
}

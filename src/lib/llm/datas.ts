/**
 * Datas relativas da mensagem → dia civil `YYYY-MM-DD` (GAB-34). Puro.
 *
 * A LLM devolve a expressão COMO ESCRITA ("sexta", "semana que vem", "31/10");
 * quem converte é este código, relativo ao instante da mensagem e no fuso de
 * negócio (America/Sao_Paulo). Assim a data não depende do relógio da LLM e
 * a regra é testável.
 *
 * Regras:
 * - dia da semana ("sexta", "sexta que vem", "próxima sexta") → próxima
 *   ocorrência ESTRITAMENTE depois do dia da mensagem (sexta dita numa sexta =
 *   sexta seguinte; para o mesmo dia o vendedor escreve "hoje");
 * - "semana que vem"/"próxima semana" → segunda-feira seguinte;
 * - "mês que vem" → dia 1 do mês seguinte; "fim do mês" → último dia do mês;
 * - "dd/mm" sem ano → este ano, ou o próximo se o dia já passou;
 * - "dia N" → dia N deste mês se ainda não passou, senão do mês seguinte;
 * - "daqui a N dias/semanas", "em N dias".
 * Fora disso → null (quem chama marca o card para revisar).
 */
import { diaEmFuso } from "@/lib/oportunidades/aging";

const DIA_MS = 24 * 60 * 60 * 1000;
const MAX_DIAS_A_FRENTE = 366;

/** 0 = domingo … 6 = sábado (como `Date.getUTCDay`). */
const DIAS_SEMANA: [RegExp, number][] = [
  [/\bdom(?:ingo)?\b/, 0],
  [/\bseg(?:unda)?(?:-feira)?\b/, 1],
  [/\bter(?:ca)?(?:-feira)?\b/, 2],
  [/\bqua(?:rta)?(?:-feira)?\b/, 3],
  [/\bqui(?:nta)?(?:-feira)?\b/, 4],
  [/\bsex(?:ta)?(?:-feira)?\b/, 5],
  [/\bsab(?:ado)?\b/, 6],
];

/** Minúsculas, sem acento, espaços colapsados. */
function simplificar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Dia civil como Date à meia-noite UTC (aritmética de calendário sem fuso). */
function diaUtc(ano: number, mes: number, dia: number): Date | null {
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia ? d : null;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function somarDias(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DIA_MS);
}

function dentroDoLimite(base: Date, alvo: Date | null): string | null {
  if (!alvo) return null;
  const dias = (alvo.getTime() - base.getTime()) / DIA_MS;
  return dias >= 0 && dias <= MAX_DIAS_A_FRENTE ? iso(alvo) : null;
}

export function resolverDataRelativa(expressao: string, referencia: Date): string | null {
  const t = simplificar(expressao);
  if (!t) return null;
  const [a, m, d] = diaEmFuso(referencia).split("-").map(Number);
  const hoje = diaUtc(a, m, d)!;

  // Datas explícitas primeiro: "2025-12-01", "03/11/2025", "3/11/25", "31/10".
  const isoM = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t);
  if (isoM) return dentroDoLimite(hoje, diaUtc(Number(isoM[1]), Number(isoM[2]), Number(isoM[3])));
  const br = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b/.exec(t);
  if (br) {
    const dia = Number(br[1]);
    const mes = Number(br[2]);
    if (br[3]) {
      const ano = br[3].length === 2 ? 2000 + Number(br[3]) : Number(br[3]);
      return dentroDoLimite(hoje, diaUtc(ano, mes, dia));
    }
    let alvo = diaUtc(a, mes, dia);
    if (alvo && alvo < hoje) alvo = diaUtc(a + 1, mes, dia);
    return dentroDoLimite(hoje, alvo);
  }

  if (/\bdepois de amanha\b/.test(t)) return iso(somarDias(hoje, 2));
  if (/\bamanha\b/.test(t)) return iso(somarDias(hoje, 1));
  if (/\bhoje\b/.test(t)) return iso(hoje);

  const daqui = /\b(?:daqui(?: a)?|em|dentro de)\s+(\d{1,3})\s+(dias?|semanas?)\b/.exec(t);
  if (daqui) {
    const n = Number(daqui[1]) * (daqui[2].startsWith("semana") ? 7 : 1);
    return dentroDoLimite(hoje, somarDias(hoje, n));
  }

  if (/\b(?:semana que vem|proxima semana)\b/.test(t)) {
    const ateSegunda = ((1 - hoje.getUTCDay() + 7) % 7) || 7;
    return iso(somarDias(hoje, ateSegunda));
  }
  if (/\b(?:mes que vem|proximo mes)\b/.test(t)) return iso(diaUtc(m === 12 ? a + 1 : a, m === 12 ? 1 : m + 1, 1)!);
  if (/\b(?:fim|final) do mes\b/.test(t)) return iso(new Date(Date.UTC(a, m, 0)));

  const diaN = /\bdia (\d{1,2})\b/.exec(t);
  if (diaN) {
    const n = Number(diaN[1]);
    let alvo = diaUtc(a, m, n);
    if (!alvo || alvo < hoje) alvo = diaUtc(m === 12 ? a + 1 : a, m === 12 ? 1 : m + 1, n);
    return dentroDoLimite(hoje, alvo);
  }

  for (const [re, dow] of DIAS_SEMANA) {
    if (re.test(t)) {
      const delta = ((dow - hoje.getUTCDay() + 7) % 7) || 7;
      return iso(somarDias(hoje, delta));
    }
  }
  return null;
}

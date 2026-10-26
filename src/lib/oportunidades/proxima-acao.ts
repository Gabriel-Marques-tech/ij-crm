/**
 * Faixas da próxima ação, compartilhadas pelo filtro do Kanban e pela Minha
 * Semana (as duas telas precisam concordar). Tudo em dias civis do fuso de
 * negócio (`FUSO_NEGOCIO`), independente do fuso do servidor.
 */
import { diaEmFuso, FUSO_NEGOCIO } from "./aging";

/** `semana` = os 7 dias civis seguintes a hoje (hoje tem faixa própria); `depois` = além disso. */
export type FaixaProximaAcao = "vencida" | "hoje" | "semana" | "depois" | "sem";

export const DIAS_SEMANA = 7;

const DIA_MS = 24 * 60 * 60 * 1000;

function paraUtc(dia: string): number {
  const [a, m, d] = dia.split("-").map(Number);
  return Date.UTC(a, m - 1, d);
}

/** `YYYY-MM-DD` + n dias civis. */
export function somarDias(dia: string, n: number): string {
  return new Date(paraUtc(dia) + n * DIA_MS).toISOString().slice(0, 10);
}

/** Dias civis de `de` até `ate` (negativo se `ate` já passou). */
export function diasAte(de: string, ate: string): number {
  return Math.round((paraUtc(ate) - paraUtc(de)) / DIA_MS);
}

export function faixaProximaAcao(proximaAcaoEm: Date | null, agora: Date, fuso: string = FUSO_NEGOCIO): FaixaProximaAcao {
  if (!proximaAcaoEm) return "sem";
  const dia = diaEmFuso(proximaAcaoEm, fuso);
  const hoje = diaEmFuso(agora, fuso);
  if (dia < hoje) return "vencida";
  if (dia === hoje) return "hoje";
  return dia <= somarDias(hoje, DIAS_SEMANA) ? "semana" : "depois";
}

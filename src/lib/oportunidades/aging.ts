/**
 * Regras puras de "idade" do card (design doc §4.5 / §4.5.1). Calculadas na
 * LEITURA, nunca gravadas: mudar `limite_dias_alerta` de uma fase recolore o
 * quadro na hora.
 */

const DIA_MS = 24 * 60 * 60 * 1000;

/** Fuso de negócio da IJ. "Hoje" e "vencida" são dias civis daqui. */
export const FUSO_NEGOCIO = "America/Sao_Paulo";

export type NivelAging = "neutro" | "verde" | "ambar" | "vermelho";

/** Fração do limite a partir da qual o card fica âmbar. */
export const FRACAO_AMBAR = 0.7;

/** Dias inteiros completos desde `faseDesde` (nunca negativo). */
export function diasNaFase(faseDesde: Date, agora: Date): number {
  return Math.max(0, Math.floor((agora.getTime() - faseDesde.getTime()) / DIA_MS));
}

/**
 * Cor do "dias na fase" pelo `limite_dias_alerta` da fase:
 * - sem limite → `neutro`;
 * - `dias < 70% do limite` → `verde`;
 * - `70% ≤ dias < limite` → `ambar`;
 * - `dias ≥ limite` → `vermelho` (mesma leitura do "alerta ≥ Nd" da Gestão → Fases).
 */
export function nivelAging(dias: number, limiteDiasAlerta: number | null): NivelAging {
  if (limiteDiasAlerta === null || limiteDiasAlerta <= 0) return "neutro";
  if (dias >= limiteDiasAlerta) return "vermelho";
  if (dias >= limiteDiasAlerta * FRACAO_AMBAR) return "ambar";
  return "verde";
}

/** `YYYY-MM-DD` do instante no fuso dado. */
export function diaEmFuso(instante: Date, fuso: string = FUSO_NEGOCIO): string {
  // en-CA formata como ISO (YYYY-MM-DD).
  return new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(instante);
}

export type EstadoProximaAcao = "vencida" | "hoje" | "futura";

/** Compara dias civis (fuso de negócio), não instantes: "hoje" vale o dia todo. */
export function estadoProximaAcao(proximaAcaoEm: Date | null, agora: Date, fuso: string = FUSO_NEGOCIO): EstadoProximaAcao | null {
  if (!proximaAcaoEm) return null;
  const dia = diaEmFuso(proximaAcaoEm, fuso);
  const hoje = diaEmFuso(agora, fuso);
  if (dia < hoje) return "vencida";
  if (dia === hoje) return "hoje";
  return "futura";
}

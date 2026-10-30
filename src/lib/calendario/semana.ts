/**
 * Calendário (GAB-51), parte pura: a semana visível. Começa na SEGUNDA (pt-BR;
 * o ICS começa no domingo) e usa dias civis de São Paulo, qualquer que seja o
 * fuso do servidor. Mesmos helpers da Minha Semana e do Ranking.
 */
import { diaEmFuso } from "@/lib/projetos/aging";
import { inicioDoDia } from "@/lib/projetos/campos";
import { somarDias } from "@/lib/projetos/proxima-acao";

export type SemanaCalendario = {
  /** `YYYY-MM-DD` (SP), inclusivos. */
  segunda: string;
  domingo: string;
  /** Os 7 dias, segunda → domingo. */
  dias: string[];
  hoje: string;
  /** Segunda da semana anterior/seguinte (para `?semana=`). */
  anterior: string;
  proxima: string;
  /** A semana contém hoje. */
  atual: boolean;
  /** Intervalo meio-aberto [inicio, fim) em instantes: segunda 00:00 de SP até a segunda seguinte. */
  inicio: Date;
  fim: Date;
  rotulo: string;
};

/** Navegação aceita até ~5 anos para cada lado; fora disso é URL estragada. */
const LIMITE_ANOS = 5;

/** Segunda-feira da semana de `dia`. */
export function segundaDe(dia: string): string {
  const dow = new Date(`${dia}T00:00:00Z`).getUTCDay(); // 0 = domingo
  return somarDias(dia, -((dow + 6) % 7));
}

const ddmm = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

function rotuloSemana(segunda: string, domingo: string): string {
  const a = segunda.slice(0, 4);
  const b = domingo.slice(0, 4);
  return a === b ? `${ddmm(segunda)} a ${ddmm(domingo)}/${b}` : `${ddmm(segunda)}/${a} a ${ddmm(domingo)}/${b}`;
}

/** `ref` (da URL, não confiável) é um dia `YYYY-MM-DD` real a até ~5 anos de `hoje`. */
export function diaValido(ref: string | undefined, hoje: string): ref is string {
  return !!ref && inicioDoDia(ref) !== null && Math.abs(Number(ref.slice(0, 4)) - Number(hoje.slice(0, 4))) <= LIMITE_ANOS;
}

/** `ref` vem da URL (não confiável): qualquer dia válido → a semana dele; o resto → semana atual. */
export function resolverSemana(ref: string | undefined, agora: Date): SemanaCalendario {
  const hoje = diaEmFuso(agora);
  const segunda = segundaDe(diaValido(ref, hoje) ? ref : hoje);
  const domingo = somarDias(segunda, 6);
  const proxima = somarDias(segunda, 7);
  return {
    segunda,
    domingo,
    dias: Array.from({ length: 7 }, (_, i) => somarDias(segunda, i)),
    hoje,
    anterior: somarDias(segunda, -7),
    proxima,
    atual: segunda <= hoje && hoje <= domingo,
    inicio: inicioDoDia(segunda)!,
    fim: inicioDoDia(proxima)!,
    rotulo: rotuloSemana(segunda, domingo),
  };
}

/** Coluna `prazo.data` é DATE: o Prisma lê/grava como meia-noite UTC. */
export function instanteDoPrazo(dia: string): Date {
  return new Date(`${dia}T00:00:00Z`);
}

export function diaDoPrazo(data: Date): string {
  return data.toISOString().slice(0, 10);
}

export type DiaAgrupado<A, P> = { dia: string; acoes: A[]; prazos: P[] };

/** Os dias na ordem (vazios inclusive), cada um com as ações e os prazos dele. */
export function agruparPorDia<A extends { dia: string }, P extends { dia: string }>(
  dias: readonly string[],
  acoes: readonly A[],
  prazos: readonly P[],
): DiaAgrupado<A, P>[] {
  const porDia = new Map(dias.map((d) => [d, { dia: d, acoes: [] as A[], prazos: [] as P[] }]));
  for (const a of acoes) porDia.get(a.dia)?.acoes.push(a);
  for (const p of prazos) porDia.get(p.dia)?.prazos.push(p);
  return [...porDia.values()];
}

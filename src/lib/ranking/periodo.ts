/**
 * Períodos do ranking (GAB-44): semana seg–dom e mês civil, em dias de
 * America/Sao_Paulo. Intervalo meio-aberto [inicio, fim): segunda 00:00 de SP
 * já é a semana seguinte; domingo 23:59 ainda é a anterior.
 */
import { diaEmFuso } from "@/lib/oportunidades/aging";
import { inicioDoDia } from "@/lib/oportunidades/campos";

export type TipoPeriodo = "semana" | "mes";

export type Periodo = {
  tipo: TipoPeriodo;
  /** `YYYY-MM-DD` (SP), inclusivos. */
  primeiroDia: string;
  ultimoDia: string;
  inicio: Date;
  fim: Date;
  rotulo: string;
  /** Um dia do período anterior/seguinte (para `?ref=`); `proximo` null = período atual. */
  anterior: string;
  proximo: string | null;
  atual: boolean;
};

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** Aritmética de dias civis sobre `YYYY-MM-DD` (meia-noite UTC só como relógio de calendário). */
function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function primeiroDiaDoMesSeguinte(dia: string): string {
  const [a, m] = dia.split("-").map(Number);
  return m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, "0")}-01`;
}

function inicio(dia: string): Date {
  return inicioDoDia(dia)!;
}

const ddmm = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

export function resolverPeriodo(tipo: TipoPeriodo, ref: string | undefined, agora: Date): Periodo {
  const hoje = diaEmFuso(agora);
  const dia = ref && inicioDoDia(ref) && ref <= hoje ? ref : hoje;

  let primeiroDia: string;
  let seguinte: string;
  let rotulo: string;
  if (tipo === "semana") {
    const dow = new Date(`${dia}T00:00:00Z`).getUTCDay(); // 0 = domingo
    primeiroDia = somarDias(dia, -((dow + 6) % 7));
    seguinte = somarDias(primeiroDia, 7);
    const ultimo = somarDias(seguinte, -1);
    rotulo = `${ddmm(primeiroDia)} a ${ddmm(ultimo)}/${ultimo.slice(0, 4)}`;
  } else {
    primeiroDia = `${dia.slice(0, 7)}-01`;
    seguinte = primeiroDiaDoMesSeguinte(primeiroDia);
    rotulo = `${MESES[Number(dia.slice(5, 7)) - 1]} de ${dia.slice(0, 4)}`;
  }
  const atual = seguinte > hoje;
  return {
    tipo,
    primeiroDia,
    ultimoDia: somarDias(seguinte, -1),
    inicio: inicio(primeiroDia),
    fim: inicio(seguinte),
    rotulo,
    anterior: somarDias(primeiroDia, -1),
    proximo: atual ? null : seguinte,
    atual,
  };
}

export function dentroDoPeriodo(em: Date, p: { inicio: Date; fim: Date }): boolean {
  const t = em.getTime();
  return t >= p.inicio.getTime() && t < p.fim.getTime();
}

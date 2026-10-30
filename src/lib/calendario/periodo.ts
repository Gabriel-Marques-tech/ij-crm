/**
 * Calendário: período visível (semana, 15 dias ou mês), parte pura. Dias
 * civis de São Paulo, como a semana (`./semana`). A leitura usa
 * [primeiroDia, ultimoDia] inclusivos; a grade mensal completa as semanas
 * (seg–dom) com dias fora do período, que aparecem apagados.
 */
import { diaEmFuso } from "@/lib/projetos/aging";
import { somarDias } from "@/lib/projetos/proxima-acao";
import { diaValido, resolverSemana, segundaDe } from "./semana";

export const PERIODOS = ["mes", "15d", "semana"] as const;
export type Periodo = (typeof PERIODOS)[number];
/** Sem `?periodo=`: mês. */
export const PERIODO_PADRAO: Periodo = "mes";
/** Tamanho do período "15 dias" (hoje + 14). */
export const DIAS_QUINZENA = 15;

export type PeriodoCalendario = {
  periodo: Periodo;
  /** `YYYY-MM-DD` (SP), inclusivos: o que é lido do banco. */
  primeiroDia: string;
  ultimoDia: string;
  /** Dias do período, em ordem. */
  dias: string[];
  /** Grade seg–dom que cobre o período (semanas completas; = `dias` na semana). */
  grade: string[];
  hoje: string;
  /** Referência (`?data=`) do período anterior/seguinte. */
  anterior: string;
  proxima: string;
  /** Contém hoje (15 dias: começa hoje). Sem `?data=` na URL. */
  atual: boolean;
  /** Valor de `?data=` deste período (null quando atual). */
  ref: string | null;
  /** Título: "Outubro 2026", "27/10 a 10/11/2026". */
  rotulo: string;
  /** Cabeçalho da agenda: "Este mês", "Próximos 15 dias", "Esta semana". */
  rotuloAgenda: string;
};

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

const ddmm = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

function rotuloIntervalo(a: string, b: string): string {
  const ya = a.slice(0, 4);
  const yb = b.slice(0, 4);
  return ya === yb ? `${ddmm(a)} a ${ddmm(b)}/${yb}` : `${ddmm(a)}/${ya} a ${ddmm(b)}/${yb}`;
}

/** Dias de `de` até `ate`, inclusivos. */
export function diasEntre(de: string, ate: string): string[] {
  const r: string[] = [];
  for (let d = de; d <= ate; d = somarDias(d, 1)) r.push(d);
  return r;
}

/** Semanas completas (seg–dom) que cobrem [de, ate]. */
export function gradeDe(de: string, ate: string): string[] {
  return diasEntre(segundaDe(de), somarDias(segundaDe(ate), 6));
}

/** Primeiro dia do mês de `dia` deslocado `n` meses. */
export function primeiroDoMes(dia: string, n = 0): string {
  const d = new Date(Date.UTC(Number(dia.slice(0, 4)), Number(dia.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

export function lerPeriodo(v: string | undefined): Periodo | null {
  return (PERIODOS as readonly string[]).includes(v ?? "") ? (v as Periodo) : null;
}

/**
 * `periodo` e `ref` vêm da URL (não confiáveis). Período inválido → mês;
 * `ref` inválido → o período atual. `ref` é qualquer dia: mês → o mês dele;
 * semana → a semana dele; 15 dias → começa nele.
 */
export function resolverPeriodo(periodo: Periodo, ref: string | undefined, agora: Date): PeriodoCalendario {
  const hoje = diaEmFuso(agora);
  const base = diaValido(ref, hoje) ? ref : hoje;

  if (periodo === "semana") {
    const s = resolverSemana(base, agora);
    return {
      periodo,
      primeiroDia: s.segunda,
      ultimoDia: s.domingo,
      dias: s.dias,
      grade: s.dias,
      hoje,
      anterior: s.anterior,
      proxima: s.proxima,
      atual: s.atual,
      ref: s.atual ? null : s.segunda,
      rotulo: s.rotulo,
      rotuloAgenda: s.atual ? "Esta semana" : "Semana",
    };
  }

  if (periodo === "15d") {
    const primeiro = base;
    const ultimo = somarDias(primeiro, DIAS_QUINZENA - 1);
    const atual = primeiro === hoje;
    return {
      periodo,
      primeiroDia: primeiro,
      ultimoDia: ultimo,
      dias: diasEntre(primeiro, ultimo),
      grade: gradeDe(primeiro, ultimo),
      hoje,
      anterior: somarDias(primeiro, -DIAS_QUINZENA),
      proxima: somarDias(primeiro, DIAS_QUINZENA),
      atual,
      ref: atual ? null : primeiro,
      rotulo: rotuloIntervalo(primeiro, ultimo),
      rotuloAgenda: atual ? "Próximos 15 dias" : "15 dias",
    };
  }

  const primeiro = primeiroDoMes(base);
  const ultimo = somarDias(primeiroDoMes(base, 1), -1);
  const atual = primeiro <= hoje && hoje <= ultimo;
  return {
    periodo,
    primeiroDia: primeiro,
    ultimoDia: ultimo,
    dias: diasEntre(primeiro, ultimo),
    grade: gradeDe(primeiro, ultimo),
    hoje,
    anterior: primeiroDoMes(base, -1),
    proxima: primeiroDoMes(base, 1),
    atual,
    ref: atual ? null : primeiro,
    rotulo: `${MESES[Number(primeiro.slice(5, 7)) - 1]} ${primeiro.slice(0, 4)}`,
    rotuloAgenda: atual ? "Este mês" : "Mês",
  };
}

/**
 * Lê `?periodo=` e `?data=` da URL. Compatível com o link antigo
 * `?semana=YYYY-MM-DD` (sem `?periodo=`): abre aquela semana.
 */
export function periodoDaBusca(busca: { periodo?: string; data?: string; semana?: string }, agora: Date): PeriodoCalendario {
  const p = lerPeriodo(busca.periodo);
  if (!p && busca.semana && !busca.data) return resolverPeriodo("semana", busca.semana, agora);
  return resolverPeriodo(p ?? PERIODO_PADRAO, busca.data, agora);
}

/** Query string (sem `?`) do período: omite o padrão e o período atual. */
export function paramsDoPeriodo(periodo: Periodo, ref: string | null): Record<string, string> {
  const q: Record<string, string> = {};
  if (periodo !== PERIODO_PADRAO) q.periodo = periodo;
  if (ref) q.data = ref;
  return q;
}

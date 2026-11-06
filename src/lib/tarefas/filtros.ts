/**
 * Filtros das tarefas: puros, estado na URL (link para um colega), com
 * operador "é / não é" por dimensão (`n` na frente da chave = "não é").
 * Dentro de uma dimensão os valores combinam com OU; entre dimensões, E.
 */
import type { PrioridadeTarefa, StatusTarefa } from "@prisma/client";
import { PRIORIDADES, STATUS_TAREFA, type TarefaLista } from "./modelo";

export const SEM_RESPONSAVEL_FILTRO = "none";
export type FiltroPrazo = "atrasado" | "hoje" | "semana" | "sem";
export type Dimensao = "resp" | "status" | "prio" | "etiqueta" | "prazo";
export const DIMENSOES: readonly Dimensao[] = ["resp", "status", "prio", "etiqueta", "prazo"];
export const ROTULO_DIMENSAO: Record<Dimensao, string> = { resp: "Responsável", status: "Status", prio: "Prioridade", etiqueta: "Etiqueta", prazo: "Prazo" };
export const OPCOES_PRAZO: { valor: FiltroPrazo; rotulo: string }[] = [
  { valor: "atrasado", rotulo: "Atrasado" },
  { valor: "hoje", rotulo: "Hoje" },
  { valor: "semana", rotulo: "Próximos 7 dias" },
  { valor: "sem", rotulo: "Sem prazo" },
];

export type Filtros = {
  resp: string[];
  status: StatusTarefa[];
  prio: PrioridadeTarefa[];
  etiqueta: string[];
  prazo: FiltroPrazo[];
  /** Dimensões com operador "não é". */
  nao: Dimensao[];
  q: string;
};

export const FILTROS_VAZIOS: Filtros = { resp: [], status: [], prio: [], etiqueta: [], prazo: [], nao: [], q: "" };

const MAX_BUSCA = 100;
type LeitorParams = { get(chave: string): string | null };

function lista<T extends string>(bruto: string | null, permitidos: readonly string[] | null): T[] {
  if (!bruto) return [];
  const saida: T[] = [];
  for (const parte of bruto.split(",")) {
    const v = parte.trim();
    if (!v || (permitidos && !permitidos.includes(v)) || saida.includes(v as T)) continue;
    saida.push(v as T);
  }
  return saida;
}

export function lerFiltros(p: LeitorParams): Filtros {
  const nao: Dimensao[] = [];
  const ler = <T extends string>(k: Dimensao, permitidos: readonly string[] | null): T[] => {
    const positivo = p.get(k);
    if (positivo) return lista<T>(positivo, permitidos);
    const negativo = p.get(`n${k}`);
    if (negativo) {
      const vs = lista<T>(negativo, permitidos);
      if (vs.length) nao.push(k);
      return vs;
    }
    return [];
  };
  return {
    resp: ler("resp", null),
    status: ler("status", STATUS_TAREFA),
    prio: ler("prio", PRIORIDADES.map((x) => x.k)),
    etiqueta: ler("etiqueta", null),
    prazo: ler("prazo", OPCOES_PRAZO.map((o) => o.valor)),
    nao,
    q: (p.get("q") ?? "").trim().slice(0, MAX_BUSCA),
  };
}

/** Novo URLSearchParams com os filtros; outros parâmetros ficam. */
export function escreverFiltros(f: Filtros, base: URLSearchParams): URLSearchParams {
  const p = new URLSearchParams(base);
  for (const k of DIMENSOES) {
    p.delete(k);
    p.delete(`n${k}`);
    const v = f[k].join(",");
    if (v) p.set(f.nao.includes(k) ? `n${k}` : k, v);
  }
  if (f.q.trim()) p.set("q", f.q.trim());
  else p.delete("q");
  return p;
}

export function contarAtivos(f: Filtros): number {
  return DIMENSOES.filter((k) => f[k].length > 0).length + (f.q ? 1 : 0);
}

export function estadoPrazo(prazo: string | null, hoje: string): FiltroPrazo | "futuro" {
  if (!prazo) return "sem";
  if (prazo < hoje) return "atrasado";
  if (prazo === hoje) return "hoje";
  return dentroDeDias(prazo, hoje, 7) ? "semana" : "futuro";
}

function dentroDeDias(dia: string, hoje: string, n: number): boolean {
  return (Date.parse(`${dia}T00:00:00Z`) - Date.parse(`${hoje}T00:00:00Z`)) / 864e5 <= n;
}

function casa(t: TarefaLista, k: Dimensao, valores: readonly string[], hoje: string): boolean {
  switch (k) {
    case "resp":
      return valores.includes(t.responsavelId ?? SEM_RESPONSAVEL_FILTRO);
    case "status":
      return valores.includes(t.status);
    case "prio":
      return valores.includes(t.prioridade);
    case "etiqueta":
      return t.etiquetas.some((e) => valores.includes(e));
    case "prazo": {
      const e = estadoPrazo(t.prazo, hoje);
      return valores.some((v) => (v === "semana" ? e === "hoje" || e === "semana" : v === e));
    }
  }
}

/** `hoje` = `YYYY-MM-DD` no fuso de negócio. */
export function filtrarTarefas(tarefas: readonly TarefaLista[], f: Filtros, hoje: string): TarefaLista[] {
  const q = f.q.trim().toLowerCase();
  return tarefas.filter((t) => {
    if (q && !t.titulo.toLowerCase().includes(q) && `#${t.numero}` !== q) return false;
    for (const k of DIMENSOES) {
      if (!f[k].length) continue;
      if (casa(t, k, f[k], hoje) === f.nao.includes(k)) return false;
    }
    return true;
  });
}

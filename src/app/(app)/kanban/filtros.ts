/**
 * Filtros do Kanban: funções puras (sem React), usadas pelo quadro cliente.
 *
 * - Estado vive nos search params da URL (link compartilhável): `resp`, `q`,
 *   `revisar`, `acao`, `aging`, `origem`, `uf`. Listas são separadas por vírgula.
 * - Dentro de um grupo os valores combinam com OU; grupos diferentes, com E.
 * - Filtragem é no cliente, sobre os cards já carregados (≤15 usuários, um
 *   quadro inteiro cabe na memória).
 */
import type { Origem } from "@prisma/client";
import { diaEmFuso, diasNaFase, estadoProximaAcao, nivelAging, type NivelAging } from "@/lib/oportunidades/aging";
import { ROTULO_ORIGEM, UFS } from "@/lib/oportunidades/campos";
import type { CardCliente, FaseCliente } from "./tipos";

/** `semana` = próximos 7 dias civis, sem contar hoje (hoje tem opção própria). */
export type FiltroAcao = "vencida" | "hoje" | "semana" | "sem";
export type FiltroOrigem = Origem | "SEM";

export type Filtros = {
  resp: string[];
  q: string;
  revisar: "sim" | "nao" | null;
  acao: FiltroAcao[];
  aging: NivelAging[];
  origem: FiltroOrigem[];
  uf: string[];
};

export const FILTROS_VAZIOS: Filtros = { resp: [], q: "", revisar: null, acao: [], aging: [], origem: [], uf: [] };

export const OPCOES_ACAO: { valor: FiltroAcao; rotulo: string }[] = [
  { valor: "vencida", rotulo: "Vencida" },
  { valor: "hoje", rotulo: "Hoje" },
  { valor: "semana", rotulo: "Próximos 7 dias" },
  { valor: "sem", rotulo: "Sem próxima ação" },
];

export const OPCOES_AGING: { valor: NivelAging; rotulo: string }[] = [
  { valor: "verde", rotulo: "Verde" },
  { valor: "ambar", rotulo: "Âmbar" },
  { valor: "vermelho", rotulo: "Vermelho" },
  { valor: "neutro", rotulo: "Sem limite" },
];

export const OPCOES_ORIGEM: { valor: FiltroOrigem; rotulo: string }[] = [
  ...(Object.entries(ROTULO_ORIGEM) as [Origem, string][]).map(([valor, rotulo]) => ({ valor, rotulo })),
  { valor: "SEM", rotulo: "Sem origem" },
];

const MAX_BUSCA = 100;
const DIA_MS = 24 * 60 * 60 * 1000;

type LeitorParams = { get(chave: string): string | null };

/** Só aceita valores da lista permitida; tira repetidos, mantém a ordem. */
function lista<T extends string>(bruto: string | null, permitidos: readonly T[] | null, normalizar: (s: string) => string = (s) => s): T[] {
  if (!bruto) return [];
  const saida: T[] = [];
  for (const parte of bruto.split(",")) {
    const v = normalizar(parte.trim());
    if (!v) continue;
    if (permitidos && !(permitidos as readonly string[]).includes(v)) continue;
    if (!saida.includes(v as T)) saida.push(v as T);
  }
  return saida;
}

export function lerFiltros(p: LeitorParams): Filtros {
  const revisar = p.get("revisar");
  return {
    resp: lista<string>(p.get("resp"), null),
    q: (p.get("q") ?? "").trim().slice(0, MAX_BUSCA),
    revisar: revisar === "sim" || revisar === "nao" ? revisar : null,
    acao: lista(p.get("acao"), OPCOES_ACAO.map((o) => o.valor)),
    aging: lista(p.get("aging"), OPCOES_AGING.map((o) => o.valor)),
    origem: lista(p.get("origem"), OPCOES_ORIGEM.map((o) => o.valor)),
    uf: lista(p.get("uf"), UFS, (s) => s.toUpperCase()),
  };
}

/** Novo URLSearchParams com os filtros aplicados; outros parâmetros (ex.: `quadro`) ficam. */
export function escreverFiltros(f: Filtros, base: URLSearchParams): URLSearchParams {
  const p = new URLSearchParams(base);
  const pares: [string, string][] = [
    ["resp", f.resp.join(",")],
    ["q", f.q.trim()],
    ["revisar", f.revisar ?? ""],
    ["acao", f.acao.join(",")],
    ["aging", f.aging.join(",")],
    ["origem", f.origem.join(",")],
    ["uf", f.uf.join(",")],
  ];
  for (const [k, v] of pares) {
    if (v) p.set(k, v);
    else p.delete(k);
  }
  return p;
}

/** Quantos filtros estão ativos: um por chip (cada valor de lista conta). */
export function contarAtivos(f: Filtros): number {
  return f.resp.length + (f.q ? 1 : 0) + (f.revisar ? 1 : 0) + f.acao.length + f.aging.length + f.origem.length + f.uf.length;
}

/** Minúsculas e sem acento, para busca tolerante. */
export function normalizarBusca(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function categoriaAcao(card: CardCliente, agora: Date, limiteSemana: string): FiltroAcao | "depois" {
  if (card.proximaAcaoEmMs === null) return "sem";
  const quando = new Date(card.proximaAcaoEmMs);
  const estado = estadoProximaAcao(quando, agora);
  if (estado === "vencida" || estado === "hoje") return estado;
  return diaEmFuso(quando) <= limiteSemana ? "semana" : "depois";
}

export type ContextoFiltro = {
  fases: FaseCliente[];
  agoraMs: number;
  /** Cards que ficam visíveis mesmo sem bater (ex.: o que o usuário acabou de mover). */
  sempreVisiveis?: ReadonlySet<string>;
};

export function filtrarCards(cards: CardCliente[], f: Filtros, ctx: ContextoFiltro): CardCliente[] {
  if (contarAtivos(f) === 0) return cards;
  const agora = new Date(ctx.agoraMs);
  const limiteSemana = diaEmFuso(new Date(ctx.agoraMs + 7 * DIA_MS));
  const limites = new Map(ctx.fases.map((x) => [x.id, x.limiteDiasAlerta]));
  const busca = normalizarBusca(f.q);

  return cards.filter((c) => {
    if (ctx.sempreVisiveis?.has(c.id)) return true;
    if (f.resp.length && !f.resp.includes(c.responsavelId)) return false;
    if (busca && !normalizarBusca(`${c.titulo} ${c.empresaNome ?? ""}`).includes(busca)) return false;
    if (f.revisar && c.revisar !== (f.revisar === "sim")) return false;
    if (f.acao.length && !(f.acao as string[]).includes(categoriaAcao(c, agora, limiteSemana))) return false;
    if (f.aging.length) {
      const dias = diasNaFase(new Date(Math.min(c.faseDesdeMs, ctx.agoraMs)), agora);
      if (!f.aging.includes(nivelAging(dias, limites.get(c.faseId) ?? null))) return false;
    }
    if (f.origem.length && !f.origem.includes(c.origem ?? "SEM")) return false;
    if (f.uf.length && !(c.estado && f.uf.includes(c.estado))) return false;
    return true;
  });
}

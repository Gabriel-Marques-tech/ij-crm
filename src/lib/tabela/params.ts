/**
 * Estado da Tabela (GAB-35) na URL: funções puras, usadas pela página
 * (servidor), pelo painel de filtros (cliente) e pelo CSV.
 *
 * Mesmos nomes de parâmetro do Kanban onde coincidem (`resp`, `q`, `revisar`,
 * `acao`, `origem`; `quadro` = chave do pipeline), para um link de filtro
 * valer nas duas telas. Próprios da Tabela: `fase` (ids), `terminais`
 * (`sim` = só ganho/perdido, `nao` = só abertos), `de`/`ate` (período de
 * criação, `YYYY-MM-DD` em SP), `ordem`/`dir` e `pagina`.
 *
 * Listas separadas por vírgula; OU dentro do grupo, E entre grupos. Valor
 * inválido é ignorado em silêncio (link velho/editado à mão não quebra).
 */
import type { Origem } from "@prisma/client";
import { inicioDoDia, ROTULO_ORIGEM } from "@/lib/projetos/campos";

export type FiltroAcao = "vencida" | "hoje" | "semana" | "sem";
export type FiltroOrigem = Origem | "SEM";
export type SimNao = "sim" | "nao";

export type FiltrosTabela = {
  quadro: string[];
  fase: string[];
  resp: string[];
  origem: FiltroOrigem[];
  revisar: SimNao | null;
  acao: FiltroAcao[];
  terminais: SimNao | null;
  de: string | null;
  ate: string | null;
  q: string;
};

export const COLUNAS_ORDENAVEIS = [
  "titulo",
  "empresa",
  "contato",
  "fase",
  "responsavel",
  "origem",
  "diasNaFase",
  "proximaAcao",
  "orcamento",
  "criado",
] as const;

export type ColunaOrdenavel = (typeof COLUNAS_ORDENAVEIS)[number];
export type Direcao = "asc" | "desc";
export type OrdemTabela = { coluna: ColunaOrdenavel; dir: Direcao };

export type EstadoTabela = { filtros: FiltrosTabela; ordem: OrdemTabela; pagina: number };

export const FILTROS_TABELA_VAZIOS: FiltrosTabela = {
  quadro: [],
  fase: [],
  resp: [],
  origem: [],
  revisar: null,
  acao: [],
  terminais: null,
  de: null,
  ate: null,
  q: "",
};

export const ORDEM_PADRAO: OrdemTabela = { coluna: "criado", dir: "desc" };
export const ESTADO_PADRAO: EstadoTabela = { filtros: FILTROS_TABELA_VAZIOS, ordem: ORDEM_PADRAO, pagina: 1 };

/** Colunas que, clicadas pela primeira vez, começam do maior (mais recente, mais caro, mais parado). */
const COMECA_DESC: ReadonlySet<ColunaOrdenavel> = new Set(["criado", "orcamento", "diasNaFase"]);

export const OPCOES_ACAO: { valor: FiltroAcao; rotulo: string }[] = [
  { valor: "vencida", rotulo: "Vencida" },
  { valor: "hoje", rotulo: "Hoje" },
  { valor: "semana", rotulo: "Próximos 7 dias" },
  { valor: "sem", rotulo: "Sem próxima ação" },
];

export const OPCOES_ORIGEM: { valor: FiltroOrigem; rotulo: string }[] = [
  ...(Object.entries(ROTULO_ORIGEM) as [Origem, string][]).map(([valor, rotulo]) => ({ valor, rotulo })),
  { valor: "SEM", rotulo: "Sem origem" },
];

const MAX_BUSCA = 100;
const MAX_ID = 64;
const MAX_PAGINA = 100_000;

type LeitorParams = { get(chave: string): string | null };

function lista<T extends string>(bruto: string | null, permitidos: readonly T[] | null): T[] {
  if (!bruto) return [];
  const saida: T[] = [];
  for (const parte of bruto.split(",")) {
    const v = parte.trim();
    if (!v || v.length > MAX_ID) continue;
    if (permitidos && !(permitidos as readonly string[]).includes(v)) continue;
    if (!saida.includes(v as T)) saida.push(v as T);
  }
  return saida;
}

function simNao(bruto: string | null): SimNao | null {
  return bruto === "sim" || bruto === "nao" ? bruto : null;
}

function dia(bruto: string | null): string | null {
  return bruto && inicioDoDia(bruto) ? bruto : null;
}

export function lerEstado(p: LeitorParams): EstadoTabela {
  const coluna = p.get("ordem");
  const dir = p.get("dir");
  const pagina = /^\d{1,6}$/.test(p.get("pagina") ?? "") ? Number(p.get("pagina")) : 1;
  const ordem: OrdemTabela =
    coluna && (COLUNAS_ORDENAVEIS as readonly string[]).includes(coluna)
      ? { coluna: coluna as ColunaOrdenavel, dir: dir === "asc" || dir === "desc" ? dir : COMECA_DESC.has(coluna as ColunaOrdenavel) ? "desc" : "asc" }
      : ORDEM_PADRAO;
  return {
    filtros: {
      quadro: lista<string>(p.get("quadro"), null),
      fase: lista<string>(p.get("fase"), null),
      resp: lista<string>(p.get("resp"), null),
      origem: lista(p.get("origem"), OPCOES_ORIGEM.map((o) => o.valor)),
      revisar: simNao(p.get("revisar")),
      acao: lista(p.get("acao"), OPCOES_ACAO.map((o) => o.valor)),
      terminais: simNao(p.get("terminais")),
      de: dia(p.get("de")),
      ate: dia(p.get("ate")),
      q: (p.get("q") ?? "").trim().slice(0, MAX_BUSCA),
    },
    ordem,
    pagina: pagina >= 1 && pagina <= MAX_PAGINA ? pagina : 1,
  };
}

/** Novo URLSearchParams com o estado; padrões são omitidos e parâmetros alheios ficam. */
export function escreverEstado(e: EstadoTabela, base?: URLSearchParams): URLSearchParams {
  const p = new URLSearchParams(base);
  const f = e.filtros;
  const padrao = e.ordem.coluna === ORDEM_PADRAO.coluna && e.ordem.dir === ORDEM_PADRAO.dir;
  const pares: [string, string][] = [
    ["quadro", f.quadro.join(",")],
    ["fase", f.fase.join(",")],
    ["resp", f.resp.join(",")],
    ["origem", f.origem.join(",")],
    ["revisar", f.revisar ?? ""],
    ["acao", f.acao.join(",")],
    ["terminais", f.terminais ?? ""],
    ["de", f.de ?? ""],
    ["ate", f.ate ?? ""],
    ["q", f.q.trim()],
    ["ordem", padrao ? "" : e.ordem.coluna],
    ["dir", padrao ? "" : e.ordem.dir],
    ["pagina", e.pagina > 1 ? String(e.pagina) : ""],
  ];
  for (const [k, v] of pares) {
    if (v) p.set(k, v);
    else p.delete(k);
  }
  return p;
}

/** Quantos filtros estão ativos: um por chip. */
export function contarAtivosTabela(f: FiltrosTabela): number {
  return (
    f.quadro.length +
    f.fase.length +
    f.resp.length +
    f.origem.length +
    f.acao.length +
    (f.revisar ? 1 : 0) +
    (f.terminais ? 1 : 0) +
    (f.de ? 1 : 0) +
    (f.ate ? 1 : 0) +
    (f.q ? 1 : 0)
  );
}

/** Clique no cabeçalho: mesma coluna inverte; outra começa no sentido natural dela. */
export function proximaOrdem(atual: OrdemTabela, coluna: ColunaOrdenavel): OrdemTabela {
  if (atual.coluna === coluna) return { coluna, dir: atual.dir === "asc" ? "desc" : "asc" };
  return { coluna, dir: COMECA_DESC.has(coluna) ? "desc" : "asc" };
}

/** `searchParams` do Next (valor pode repetir) → URLSearchParams, primeira ocorrência. */
export function paramsDeRegistro(r: Record<string, string | string[] | undefined>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(r)) {
    const valor = Array.isArray(v) ? v[0] : v;
    if (valor !== undefined) p.set(k, valor);
  }
  return p;
}

/**
 * Visão Tabela (GAB-35), leitura: todas as oportunidades vivas com filtros,
 * ordenação e paginação NO BANCO, e o mesmo conjunto (sem limite) para o CSV.
 *
 * - Vendedor vê tudo (§4.5, matriz de papéis): responsável é filtro, não parede.
 * - Card soft-deletado nunca aparece (`deletadoEm: null` em toda query).
 * - Empresa/contato excluídos ou mesclados vêm descritos por `vinculo.ts` e
 *   aparecem pela regra do Kanban (`nomeExibido`): mesclado → nome da
 *   principal se ela estiver viva, senão o próprio nome (`textoNaTabela`).
 * - Ordenação só por colunas da lista branca, sempre com `id` como desempate
 *   (página estável: o mesmo card não aparece em duas páginas).
 * - Faixas da próxima ação = `faixaProximaAcao` (Kanban e Minha Semana),
 *   traduzidas para intervalos de `proxima_acao_em` em dias civis de SP.
 */
import { Prisma, type Origem, type TipoTerminal } from "@prisma/client";
import { db } from "@/lib/db";
import { BUSCA_MAX, escaparLike } from "@/lib/entidades/busca";
import { descreverVinculos, SELECAO_REF, textoVinculo, type Vinculo } from "@/lib/entidades/vinculo";
import { diaEmFuso, diasNaFase, nivelAging, type NivelAging } from "@/lib/oportunidades/aging";
import { inicioDoDia, ROTULO_ORIGEM } from "@/lib/oportunidades/campos";
import { DIAS_SEMANA, somarDias } from "@/lib/oportunidades/proxima-acao";
import { BOM, celulaData, celulaDataHora, celulaNumero, celulaTexto, linhaCsv } from "./csv";
import type { EstadoTabela, FiltroAcao, FiltrosTabela, OrdemTabela } from "./params";

export const POR_PAGINA = 50;
/** Linhas por ida ao banco no CSV. */
export const LOTE_CSV = 500;

type Where = Prisma.OportunidadeWhereInput;
type OrderBy = Prisma.OportunidadeOrderByWithRelationInput;

function meiaNoite(dia: string): Date {
  // `dia` já validado (lerEstado) ou derivado de diaEmFuso: nunca null aqui.
  return inicioDoDia(dia)!;
}

function whereAcao(faixas: FiltroAcao[], agora: Date): Where {
  const hoje = diaEmFuso(agora);
  const iHoje = meiaNoite(hoje);
  const iAmanha = meiaNoite(somarDias(hoje, 1));
  const iDepois = meiaNoite(somarDias(hoje, DIAS_SEMANA + 1));
  const ou: Where[] = faixas.map((f) => {
    switch (f) {
      case "vencida":
        return { proximaAcaoEm: { lt: iHoje } };
      case "hoje":
        return { proximaAcaoEm: { gte: iHoje, lt: iAmanha } };
      case "semana":
        return { proximaAcaoEm: { gte: iAmanha, lt: iDepois } };
      case "sem":
        return { proximaAcaoEm: null };
    }
  });
  return { OR: ou };
}

/**
 * Termo da busca normalizado como no Kanban (`normalizarBusca`): sem acento,
 * minúsculo, espaços colapsados. Vazio → null.
 */
export function normalizarTermo(q: string): string | null {
  const t = q
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, BUSCA_MAX);
  return t || null;
}

/** Mesma normalização do lado do banco (o `unaccent` vem da migration 20261024174500). */
function normalizarColuna(coluna: string): Prisma.Sql {
  return Prisma.sql`public.unaccent(lower(regexp_replace(${Prisma.raw(coluna)}, ${"\\s+"}, ' ', 'g')))`;
}

/**
 * Ids que batem na busca: título, ou o nome EXIBIDO da empresa/contato
 * (`textoNaTabela`): vivo → o próprio; mesclado → o da principal viva, ou o
 * próprio se a principal morreu (merge tem 1 nível); excluído não conta.
 * `%`, `_` e `\` do termo são literais (`escaparLike`, ESCAPE `\`).
 * `restrito` limita a um lote de ids (CSV).
 */
async function idsDaBusca(termo: string, restrito?: string[]): Promise<string[]> {
  const padrao = `%${escaparLike(termo)}%`;
  const casa = (coluna: string) => Prisma.sql`${normalizarColuna(coluna)} LIKE public.unaccent(lower(${padrao})) ESCAPE ${"\\"}`;
  const linhas = await db.$queryRaw<{ id: string }[]>`
    SELECT o.id FROM oportunidade o
    LEFT JOIN empresa e ON e.id = o.empresa_id AND e.deletado_em IS NULL
    LEFT JOIN empresa ep ON ep.id = e.merged_into_id AND ep.deletado_em IS NULL
    LEFT JOIN contato c ON c.id = o.contato_id AND c.deletado_em IS NULL
    LEFT JOIN contato cp ON cp.id = c.merged_into_id AND cp.deletado_em IS NULL
    WHERE o.deletado_em IS NULL
      ${restrito ? Prisma.sql`AND o.id = ANY(${restrito})` : Prisma.empty}
      AND (${casa("o.titulo")} OR ${casa("COALESCE(ep.nome, e.nome)")} OR ${casa("COALESCE(cp.nome, c.nome)")})`;
  return linhas.map((l) => l.id);
}

/**
 * Filtros → `where` do Prisma. A busca não cabe no Prisma (unaccent): roda
 * antes em SQL e entra aqui como `id IN (...)`. Exportado para os testes.
 */
export async function montarWhere(f: FiltrosTabela, agora: Date, restrito?: string[]): Promise<Where> {
  const e: Where[] = [{ deletadoEm: null }];
  if (f.quadro.length) e.push({ pipeline: { chave: { in: f.quadro } } });
  if (f.fase.length) e.push({ faseId: { in: f.fase } });
  if (f.resp.length) e.push({ responsavelId: { in: f.resp } });
  if (f.origem.length) {
    const valores = f.origem.filter((o): o is Origem => o !== "SEM");
    const ou: Where[] = [];
    if (valores.length) ou.push({ origem: { in: valores } });
    if (f.origem.includes("SEM")) ou.push({ origem: null });
    e.push({ OR: ou });
  }
  if (f.revisar) e.push({ revisar: f.revisar === "sim" });
  if (f.terminais) e.push({ fase: { isTerminal: f.terminais === "sim" } });
  if (f.acao.length) e.push(whereAcao(f.acao, agora));
  // Período inclusivo nas duas pontas, em dias civis de SP.
  if (f.de) e.push({ criadoEm: { gte: meiaNoite(f.de) } });
  if (f.ate) e.push({ criadoEm: { lt: meiaNoite(somarDias(f.ate, 1)) } });
  const termo = normalizarTermo(f.q);
  if (termo) e.push({ id: { in: await idsDaBusca(termo, restrito) } });
  if (restrito) e.push({ id: { in: restrito } });
  return { AND: e };
}

/**
 * Lista branca coluna → ORDER BY. Campos anuláveis: vazios por último nos
 * dois sentidos. Relações opcionais (empresa/contato) seguem o padrão do
 * Postgres (vazios por último no asc, primeiro no desc): o Prisma não aceita
 * `nulls` em campo de relação.
 */
export function montarOrderBy(o: OrdemTabela): OrderBy[] {
  const d = o.dir;
  const inverso = d === "asc" ? "desc" : "asc";
  const porColuna: Record<OrdemTabela["coluna"], OrderBy[]> = {
    titulo: [{ titulo: d }],
    empresa: [{ empresa: { nome: d } }],
    contato: [{ contato: { nome: d } }],
    fase: [{ pipeline: { ordem: d } }, { fase: { ordem: d } }],
    responsavel: [{ responsavel: { nome: d } }],
    origem: [{ origem: { sort: d, nulls: "last" } }],
    // Mais dias na fase = entrou na fase há mais tempo.
    diasNaFase: [{ faseDesde: inverso }],
    proximaAcao: [{ proximaAcaoEm: { sort: d, nulls: "last" } }],
    orcamento: [{ orcamentoPrevisto: { sort: d, nulls: "last" } }],
    criado: [{ criadoEm: d }],
  };
  return [...porColuna[o.coluna], { id: "asc" }];
}

const SELECAO = {
  id: true,
  titulo: true,
  faseDesde: true,
  revisar: true,
  origem: true,
  proximaAcao: true,
  proximaAcaoEm: true,
  orcamentoPrevisto: true,
  criadoEm: true,
  pipeline: { select: { chave: true, nome: true } },
  fase: { select: { nome: true, isTerminal: true, tipoTerminal: true, limiteDiasAlerta: true } },
  responsavel: { select: { id: true, nome: true } },
  empresa: { select: SELECAO_REF },
  contato: { select: SELECAO_REF },
} satisfies Prisma.OportunidadeSelect;

export type LinhaTabela = {
  id: string;
  titulo: string;
  pipeline: { chave: string; nome: string };
  fase: { nome: string; isTerminal: boolean; tipoTerminal: TipoTerminal | null };
  empresa: Vinculo | null;
  contato: Vinculo | null;
  responsavel: { id: string; nome: string };
  origem: Origem | null;
  revisar: boolean;
  diasNaFase: number;
  aging: NivelAging;
  proximaAcao: string | null;
  proximaAcaoEm: Date | null;
  /** String decimal ("12500.00") para atravessar a fronteira servidor → cliente. */
  orcamentoPrevisto: string | null;
  criadoEm: Date;
};

/**
 * Texto da célula de empresa/contato (tela e CSV), na regra do Kanban
 * (`nomeExibido`): mesclado → nome da principal se ela estiver viva, senão o
 * próprio nome. Excluído (sem merge) mantém o aviso "(excluída)".
 */
export function textoNaTabela(tipo: "empresa" | "contato", v: Vinculo | null | undefined): string | null {
  if (!v) return null;
  if (v.estado === "MESCLADO") return v.destino?.nome ?? v.nome;
  return textoVinculo(tipo, v);
}

type Bruta = Prisma.OportunidadeGetPayload<{ select: typeof SELECAO }>;

async function paraLinhas(brutas: Bruta[], agora: Date): Promise<LinhaTabela[]> {
  const [empresas, contatos] = await Promise.all([
    descreverVinculos("empresa", brutas.map((b) => b.empresa)),
    descreverVinculos("contato", brutas.map((b) => b.contato)),
  ]);
  return brutas.map((b) => {
    const dias = diasNaFase(new Date(Math.min(b.faseDesde.getTime(), agora.getTime())), agora);
    return {
      id: b.id,
      titulo: b.titulo,
      pipeline: b.pipeline,
      fase: { nome: b.fase.nome, isTerminal: b.fase.isTerminal, tipoTerminal: b.fase.tipoTerminal },
      empresa: b.empresa ? (empresas.get(b.empresa.id) ?? null) : null,
      contato: b.contato ? (contatos.get(b.contato.id) ?? null) : null,
      responsavel: b.responsavel,
      origem: b.origem,
      revisar: b.revisar,
      diasNaFase: dias,
      aging: nivelAging(dias, b.fase.limiteDiasAlerta),
      proximaAcao: b.proximaAcao,
      proximaAcaoEm: b.proximaAcaoEm,
      orcamentoPrevisto: b.orcamentoPrevisto ? b.orcamentoPrevisto.toFixed(2) : null,
      criadoEm: b.criadoEm,
    };
  });
}

export type PaginaTabela = { linhas: LinhaTabela[]; total: number; pagina: number; paginas: number };

/** Uma página. Página além do fim cai na última (link velho não mostra vazio). */
export async function listarTabela(e: EstadoTabela, agora: Date): Promise<PaginaTabela> {
  const where = await montarWhere(e.filtros, agora);
  const total = await db.oportunidade.count({ where });
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const pagina = Math.min(e.pagina, paginas);
  const brutas = total
    ? await db.oportunidade.findMany({ where, orderBy: montarOrderBy(e.ordem), skip: (pagina - 1) * POR_PAGINA, take: POR_PAGINA, select: SELECAO })
    : [];
  return { linhas: await paraLinhas(brutas, agora), total, pagina, paginas };
}

/** Responsáveis possíveis no filtro: todos, inclusive inativos (ativos primeiro). */
export async function listarPessoas() {
  return db.usuario.findMany({ orderBy: [{ ativo: "desc" }, { nome: "asc" }], select: { id: true, nome: true, ativo: true } });
}

// ---------------------------------------------------------------- CSV

const CABECALHO = [
  "ID",
  "Título",
  "Pipeline",
  "Fase",
  "Empresa",
  "Contato",
  "Responsável",
  "Origem",
  "Revisar",
  "Dias na fase",
  "Próxima ação",
  "Data da próxima ação",
  "Orçamento previsto",
  "Criado em",
];

function linhaParaCsv(l: LinhaTabela): string {
  return linhaCsv([
    celulaTexto(l.id),
    celulaTexto(l.titulo),
    celulaTexto(l.pipeline.nome),
    celulaTexto(l.fase.nome),
    celulaTexto(textoNaTabela("empresa", l.empresa)),
    celulaTexto(textoNaTabela("contato", l.contato)),
    celulaTexto(l.responsavel.nome),
    celulaTexto(l.origem ? ROTULO_ORIGEM[l.origem] : null),
    l.revisar ? "Sim" : "Não",
    celulaNumero(l.diasNaFase),
    celulaTexto(l.proximaAcao),
    celulaData(l.proximaAcaoEm),
    celulaNumero(l.orcamentoPrevisto),
    celulaDataHora(l.criadoEm),
  ]);
}

/**
 * CSV inteiro com os filtros e a ordem da tela (ignora a página), em pedaços
 * de texto para streaming. Primeiro lê só os ids, na ordem final; depois
 * busca os dados de `lote` em `lote`, REAPLICANDO os mesmos filtros (e a
 * busca) a cada lote. Garantia: cada linha exportada ainda batia nos filtros
 * no momento do seu lote, e nenhum card sai duas vezes. Não é um retrato
 * único no tempo (sem transação longa): card que deixou de bater ou foi
 * apagado no meio some; card que passou a bater depois da leitura dos ids
 * não entra.
 *
 * O primeiro `next()` já faz a query dos ids: quem chama pode aguardá-lo
 * antes de começar a resposta e transformar falha em erro 500 com ref.
 */
export async function* exportarCsv(f: FiltrosTabela, ordem: OrdemTabela, agora: Date, lote: number = LOTE_CSV): AsyncGenerator<string> {
  const ids = (await db.oportunidade.findMany({ where: await montarWhere(f, agora), orderBy: montarOrderBy(ordem), select: { id: true } })).map((r) => r.id);
  yield BOM + linhaCsv(CABECALHO.map(celulaTexto));
  for (let i = 0; i < ids.length; i += lote) {
    const fatia = ids.slice(i, i + lote);
    const brutas = await db.oportunidade.findMany({ where: await montarWhere(f, agora, fatia), select: SELECAO });
    const porId = new Map(brutas.map((b) => [b.id, b]));
    const ordenadas = fatia.map((id) => porId.get(id)).filter((b): b is Bruta => !!b);
    yield (await paraLinhas(ordenadas, agora)).map(linhaParaCsv).join("");
  }
}

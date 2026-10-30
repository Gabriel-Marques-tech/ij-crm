/**
 * Visão Tabela (GAB-35), leitura: todas as oportunidades vivas com filtros,
 * ordenação e paginação NO BANCO, e o mesmo conjunto (sem limite) para o CSV.
 *
 * - Vendedor vê tudo (§4.5, matriz de papéis): responsável é filtro, não parede.
 * - Card soft-deletado nunca aparece (`deletadoEm: null` em toda query).
 * - Empresa/contato excluídos ou mesclados vêm descritos por `vinculo.ts` e
 *   aparecem pela regra do Kanban (`nomeExibido`): mesclado → nome da
 *   principal se ela estiver viva, senão o próprio nome (`refNaTabela`).
 * - Ordenação só por colunas da lista branca, sempre com `id` como desempate
 *   (página estável: o mesmo card não aparece em duas páginas). Texto (título,
 *   responsável, empresa/contato pelo nome EXIBIDO) ordena em pt-BR (GAB-48).
 * - Faixas da próxima ação = `faixaProximaAcao` (Kanban e Minha Semana),
 *   traduzidas para intervalos de `proxima_acao_em` em dias civis de SP.
 */
import { Prisma, type Origem, type TipoTerminal } from "@prisma/client";
import { QUEM_ATUA } from "@/lib/auth/papeis";
import { db } from "@/lib/db";
import { BUSCA_MAX, escaparLike } from "@/lib/entidades/busca";
import { nomeExibido, SELECAO_NOME_EXIBIDO, sufixoVinculo } from "@/lib/entidades/vinculo";
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
 * (`refNaTabela`/`nomeExibido`, mesma precedência, 1 nível de merge: ver
 * invariante em `vinculo.ts`): mesclado → principal viva, senão o próprio
 * (mesmo que ele esteja excluído); não mesclado e vivo → o próprio;
 * não mesclado e excluído → não conta.
 * `%`, `_` e `\` do termo são literais (`escaparLike`, ESCAPE `\`).
 * `restrito` limita a um lote de ids (página ou lote do CSV).
 */
/** `refNaTabela` em SQL (`principal` já filtrada por `deletado_em IS NULL` no JOIN). */
function nomeExibidoSql(ref: string, principal: string): string {
  return `CASE WHEN ${ref}.merged_into_id IS NOT NULL THEN COALESCE(${principal}.nome, ${ref}.nome) WHEN ${ref}.deletado_em IS NULL THEN ${ref}.nome END`;
}

async function idsDaBusca(termo: string, restrito?: string[]): Promise<string[]> {
  const padrao = `%${escaparLike(termo)}%`;
  const casa = (coluna: string) => Prisma.sql`${normalizarColuna(coluna)} LIKE public.unaccent(lower(${padrao})) ESCAPE ${"\\"}`;
  const linhas = await db.$queryRaw<{ id: string }[]>`
    SELECT o.id FROM oportunidade o
    LEFT JOIN empresa e ON e.id = o.empresa_id
    LEFT JOIN empresa ep ON ep.id = e.merged_into_id AND ep.deletado_em IS NULL
    LEFT JOIN contato c ON c.id = o.contato_id
    LEFT JOIN contato cp ON cp.id = c.merged_into_id AND cp.deletado_em IS NULL
    WHERE o.deletado_em IS NULL
      ${restrito ? Prisma.sql`AND o.id = ANY(${restrito})` : Prisma.empty}
      AND (${casa("o.titulo")} OR ${casa(nomeExibidoSql("e", "ep"))} OR ${casa(nomeExibidoSql("c", "cp"))})`;
  return linhas.map((l) => l.id);
}

/**
 * Chave de ordenação de empresa/contato = o texto da célula (`refNaTabela`)
 * sem o sufixo "(excluída)": a expressão da busca (`nomeExibidoSql`) e, onde
 * ela não conta (não mesclado e excluído), o próprio nome. Sem vínculo → NULL.
 */
function nomeNaCelulaSql(ref: string, principal: string): string {
  return `COALESCE(${nomeExibidoSql(ref, principal)}, ${ref}.nome)`;
}

/**
 * Colação da ordem das colunas de texto (título, responsável, empresa,
 * contato): `ij_ptbr`, ICU pt-BR criada pela migration
 * 20261027140000_colacao_ptbr (banco sem ICU falha no `migrate deploy`, não
 * no request). A colação padrão do banco (en_US.utf8 sobre musl, imagem
 * postgres:16-alpine) compara bytes: "Zebra" < "abc" < "Ágil". Com a ICU a
 * ordem é a de um leitor: acento e caixa só desempatam ("abc", "Ágil",
 * "Alfa", "beta", "Zebra"), com o nome mostrado como está na célula.
 */
const COLACAO_NOMES = "COLLATE ij_ptbr";

/** Colunas de texto ordenadas em SQL com `ij_ptbr`: JOINs (só literais daqui) + chave. */
const ORDEM_TEXTO: Partial<Record<OrdemTabela["coluna"], { joins: string; chave: string }>> = {
  titulo: { joins: "", chave: "o.titulo" },
  responsavel: { joins: "JOIN usuario u ON u.id = o.responsavel_id", chave: "u.nome" },
  empresa: {
    joins: "LEFT JOIN empresa r ON r.id = o.empresa_id LEFT JOIN empresa rp ON rp.id = r.merged_into_id AND rp.deletado_em IS NULL",
    chave: nomeNaCelulaSql("r", "rp"),
  },
  contato: {
    joins: "LEFT JOIN contato r ON r.id = o.contato_id LEFT JOIN contato rp ON rp.id = r.merged_into_id AND rp.deletado_em IS NULL",
    chave: nomeNaCelulaSql("r", "rp"),
  },
};

/**
 * Todos os ids que batem nos filtros e na busca, já na ordem pedida (a
 * página/lote corta depois e recarrega com `montarWhere(f, agora, fatia)`).
 *
 * - A busca (`idsDaBusca`) é cruzada em memória com os ids dos filtros, nunca
 *   vira `id IN (...)` grande: o Prisma não divide essa lista quando há outros
 *   filtros/ordem, e acima de 32.767 ids o Postgres recusa a query (bind).
 * - Prisma não ordena por expressão nem por colação: as colunas de texto
 *   (`ORDEM_TEXTO`: título, responsável, empresa/contato pelo nome exibido em
 *   `nomeNaCelulaSql`) ordenam os ids em SQL parametrizado (um único parâmetro
 *   array) com `ij_ptbr`, vazios por último nos dois sentidos, desempate por
 *   `id` (critério de `montarOrderBy`). As demais usam `montarOrderBy`.
 *
 * Limite conhecido: lê todos os ids filtrados a cada página (não só 50).
 * Aceito na escala do produto (≤ 15 usuários, alguns milhares de cards: uns
 * poucos ms). Se a base crescer muito, trocar por keyset/`LIMIT … OFFSET` no
 * SQL com a mesma expressão de ordem e os filtros traduzidos para SQL.
 */
async function idsOrdenados(f: FiltrosTabela, ordem: OrdemTabela, agora: Date): Promise<string[]> {
  const where = whereFiltros(f, agora);
  const termo = normalizarTermo(f.q);
  const daBusca = termo ? new Set(await idsDaBusca(termo)) : null;
  const naBusca = (ids: string[]) => (daBusca ? ids.filter((id) => daBusca.has(id)) : ids);
  if (daBusca?.size === 0) return [];
  const texto = ORDEM_TEXTO[ordem.coluna];
  if (!texto) {
    return naBusca((await db.oportunidade.findMany({ where, orderBy: montarOrderBy(ordem), select: { id: true } })).map((r) => r.id));
  }
  const ids = naBusca((await db.oportunidade.findMany({ where, select: { id: true } })).map((r) => r.id));
  if (!ids.length) return [];
  const dir = ordem.dir === "asc" ? "ASC" : "DESC";
  const linhas = await db.$queryRaw<{ id: string }[]>`
    SELECT o.id FROM oportunidade o ${Prisma.raw(texto.joins)}
    WHERE o.id = ANY(${ids})
    ORDER BY ${Prisma.raw(`${texto.chave} ${COLACAO_NOMES} ${dir} NULLS LAST`)}, o.id ASC`;
  return linhas.map((l) => l.id);
}

/** Filtros (sem a busca) → `where` do Prisma. */
function whereFiltros(f: FiltrosTabela, agora: Date): Where {
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
  return { AND: e };
}

/**
 * Filtros + busca → `where` do Prisma, limitado a um lote de ids (página ou
 * lote do CSV, que reaplica os filtros na hora de ler os dados). A busca não
 * cabe no Prisma (unaccent): roda em SQL só sobre o lote e entra como
 * `id IN (...)` pequeno.
 */
export async function montarWhere(f: FiltrosTabela, agora: Date, restrito: string[]): Promise<Where> {
  const e: Where[] = [whereFiltros(f, agora), { id: { in: restrito } }];
  const termo = normalizarTermo(f.q);
  if (termo) e.push({ id: { in: await idsDaBusca(termo, restrito) } });
  return { AND: e };
}

/**
 * Lista branca coluna → ORDER BY. Campos anuláveis: vazios por último nos
 * dois sentidos. Título, responsável, empresa e contato não passam por aqui
 * (`ORDEM_TEXTO` em `idsOrdenados`, colação `ij_ptbr`); as entradas deles são
 * só o fallback na colação padrão.
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

const SELECAO_REF_TABELA = { ...SELECAO_NOME_EXIBIDO, deletadoEm: true, mergedIntoId: true } as const;
type RefBrutaTabela = { nome: string; deletadoEm: Date | null; mergedIntoId: string | null; mergedInto: { nome: string; deletadoEm: Date | null } | null };
/** Empresa/contato já no texto final da célula; `excluido` só para o tom na tela. */
export type RefTabela = { nome: string; excluido: boolean };

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
  empresa: { select: SELECAO_REF_TABELA },
  contato: { select: SELECAO_REF_TABELA },
} satisfies Prisma.OportunidadeSelect;

export type LinhaTabela = {
  id: string;
  titulo: string;
  pipeline: { chave: string; nome: string };
  fase: { nome: string; isTerminal: boolean; tipoTerminal: TipoTerminal | null };
  empresa: RefTabela | null;
  contato: RefTabela | null;
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
 * Empresa/contato na célula (tela e CSV). Mesclado (mesmo se também
 * excluído) → `nomeExibido`, a regra do Kanban: principal viva, senão o
 * próprio nome; 1 nível de merge. Só o não mesclado e excluído ganha o aviso
 * "(excluída)". A busca (`nomeExibidoSql`) segue a mesma precedência.
 */
function refNaTabela(tipo: "empresa" | "contato", r: RefBrutaTabela | null): RefTabela | null {
  if (!r) return null;
  if (!r.mergedIntoId && r.deletadoEm) return { nome: `${r.nome} (${sufixoVinculo(tipo, "EXCLUIDO")})`, excluido: true };
  return { nome: nomeExibido(r), excluido: false };
}

type Bruta = Prisma.OportunidadeGetPayload<{ select: typeof SELECAO }>;

/** Só o CSV lê a descrição (texto longo): a tela não tem essa coluna. */
const SELECAO_CSV = { ...SELECAO, descricao: true } satisfies Prisma.OportunidadeSelect;
type BrutaCsv = Prisma.OportunidadeGetPayload<{ select: typeof SELECAO_CSV }>;

async function paraLinhas(brutas: Bruta[], agora: Date): Promise<LinhaTabela[]> {
  return brutas.map((b) => {
    const dias = diasNaFase(new Date(Math.min(b.faseDesde.getTime(), agora.getTime())), agora);
    return {
      id: b.id,
      titulo: b.titulo,
      pipeline: b.pipeline,
      fase: { nome: b.fase.nome, isTerminal: b.fase.isTerminal, tipoTerminal: b.fase.tipoTerminal },
      empresa: refNaTabela("empresa", b.empresa),
      contato: refNaTabela("contato", b.contato),
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

/**
 * Dados de um lote de ids, na ordem do lote, reaplicando filtros e busca:
 * card apagado (ou que deixou de bater) depois da leitura dos ids some.
 */
async function carregarNaOrdem<B extends { id: string }>(
  f: FiltrosTabela,
  agora: Date,
  fatia: string[],
  select: typeof SELECAO | typeof SELECAO_CSV,
): Promise<B[]> {
  if (!fatia.length) return [];
  const brutas = (await db.oportunidade.findMany({ where: await montarWhere(f, agora, fatia), select })) as unknown as B[];
  const porId = new Map(brutas.map((b) => [b.id, b]));
  return fatia.map((id) => porId.get(id)).filter((b): b is B => !!b);
}

export type PaginaTabela = { linhas: LinhaTabela[]; total: number; pagina: number; paginas: number };

/** Uma página. Página além do fim cai na última (link velho não mostra vazio). */
export async function listarTabela(e: EstadoTabela, agora: Date): Promise<PaginaTabela> {
  // Ids já ordenados (o total sai deles); a página recarrega reaplicando os filtros.
  const ordenados = await idsOrdenados(e.filtros, e.ordem, agora);
  const total = ordenados.length;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const pagina = Math.min(e.pagina, paginas);
  const inicio = (pagina - 1) * POR_PAGINA;
  const brutas = await carregarNaOrdem<Bruta>(e.filtros, agora, ordenados.slice(inicio, inicio + POR_PAGINA), SELECAO);
  return { linhas: await paraLinhas(brutas, agora), total, pagina, paginas };
}

/**
 * Responsáveis possíveis no filtro: todos, inclusive inativos (ativos primeiro).
 * VISUALIZADOR só entra se ainda é dono de algum card (ex.: ex-vendedor rebaixado).
 */
export async function listarPessoas() {
  return db.usuario.findMany({ where: { OR: [QUEM_ATUA, { oportunidades: { some: {} } }] }, orderBy: [{ ativo: "desc" }, { nome: "asc" }], select: { id: true, nome: true, ativo: true } });
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
  "Descrição",
];

function linhaParaCsv(l: LinhaTabela & { descricao: string | null }): string {
  return linhaCsv([
    celulaTexto(l.id),
    celulaTexto(l.titulo),
    celulaTexto(l.pipeline.nome),
    celulaTexto(l.fase.nome),
    celulaTexto(l.empresa?.nome),
    celulaTexto(l.contato?.nome),
    celulaTexto(l.responsavel.nome),
    celulaTexto(l.origem ? ROTULO_ORIGEM[l.origem] : null),
    l.revisar ? "Sim" : "Não",
    celulaNumero(l.diasNaFase),
    celulaTexto(l.proximaAcao),
    celulaData(l.proximaAcaoEm),
    celulaNumero(l.orcamentoPrevisto),
    celulaDataHora(l.criadoEm),
    // Texto livre: passa pela guarda anti fórmula; quebras de linha vão entre aspas.
    celulaTexto(l.descricao),
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
  const ids = await idsOrdenados(f, ordem, agora);
  yield BOM + linhaCsv(CABECALHO.map(celulaTexto));
  for (let i = 0; i < ids.length; i += lote) {
    const ordenadas = await carregarNaOrdem<BrutaCsv>(f, agora, ids.slice(i, i + lote), SELECAO_CSV);
    const linhas = await paraLinhas(ordenadas, agora);
    yield linhas.map((l, j) => linhaParaCsv({ ...l, descricao: ordenadas[j].descricao })).join("");
  }
}

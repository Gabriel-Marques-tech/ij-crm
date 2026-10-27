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
 *   (página estável: o mesmo card não aparece em duas páginas). Empresa e
 *   contato ordenam pelo nome EXIBIDO (`ordemPorNomeSql`, GAB-48).
 * - Faixas da próxima ação = `faixaProximaAcao` (Kanban e Minha Semana),
 *   traduzidas para intervalos de `proxima_acao_em` em dias civis de SP.
 */
import { Prisma, type Origem, type TipoTerminal } from "@prisma/client";
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
 * `restrito` limita a um lote de ids (CSV).
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
 * Colação da ordem por nome: `pt-BR-x-icu` (ICU, vem na imagem
 * postgres:16-alpine de dev e prod). A colação padrão do banco (en_US.utf8
 * sobre musl) compara bytes: "Zebra" < "abc" < "Ágil". Com a ICU a ordem é a
 * de um leitor: acento e caixa só desempatam ("abc", "Ágil", "Alfa", "beta",
 * "Zebra"), com o nome mostrado como está na célula.
 */
const COLACAO_NOMES = 'COLLATE "pt-BR-x-icu"';

const REF_ORDEM = {
  empresa: { tabela: "empresa", coluna: "empresa_id" },
  contato: { tabela: "contato", coluna: "contato_id" },
} as const;

/**
 * Ids do `where` na ordem pedida, todos (a página corta depois). Prisma não
 * ordena por expressão: empresa/contato leem os ids filtrados e ordenam em
 * SQL parametrizado por `nomeNaCelulaSql`, vazios por último nos dois
 * sentidos, desempate por `id` (mesmo critério de `montarOrderBy`).
 */
async function idsOrdenados(where: Where, ordem: OrdemTabela): Promise<string[]> {
  if (ordem.coluna !== "empresa" && ordem.coluna !== "contato") {
    return (await db.oportunidade.findMany({ where, orderBy: montarOrderBy(ordem), select: { id: true } })).map((r) => r.id);
  }
  const ids = (await db.oportunidade.findMany({ where, select: { id: true } })).map((r) => r.id);
  if (!ids.length) return [];
  const { tabela, coluna } = REF_ORDEM[ordem.coluna];
  const dir = ordem.dir === "asc" ? "ASC" : "DESC";
  const linhas = await db.$queryRaw<{ id: string }[]>`
    SELECT o.id FROM oportunidade o
    LEFT JOIN ${Prisma.raw(tabela)} r ON r.id = o.${Prisma.raw(coluna)}
    LEFT JOIN ${Prisma.raw(tabela)} rp ON rp.id = r.merged_into_id AND rp.deletado_em IS NULL
    WHERE o.id = ANY(${ids})
    ORDER BY ${Prisma.raw(`${nomeNaCelulaSql("r", "rp")} ${COLACAO_NOMES} ${dir} NULLS LAST`)}, o.id ASC`;
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
 * dois sentidos. Empresa/contato não passam por aqui (`idsOrdenados`, pelo
 * nome exibido); a entrada deles é só o fallback pelo nome próprio.
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

export type PaginaTabela = { linhas: LinhaTabela[]; total: number; pagina: number; paginas: number };

/** Uma página. Página além do fim cai na última (link velho não mostra vazio). */
export async function listarTabela(e: EstadoTabela, agora: Date): Promise<PaginaTabela> {
  const where = await montarWhere(e.filtros, agora);
  const porNome = e.ordem.coluna === "empresa" || e.ordem.coluna === "contato";
  // Por nome: ids já ordenados (o total sai deles) e a página carregada por id.
  const ordenados = porNome ? await idsOrdenados(where, e.ordem) : null;
  const total = ordenados ? ordenados.length : await db.oportunidade.count({ where });
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const pagina = Math.min(e.pagina, paginas);
  const inicio = (pagina - 1) * POR_PAGINA;
  let brutas: Bruta[] = [];
  if (ordenados) {
    const fatia = ordenados.slice(inicio, inicio + POR_PAGINA);
    const porId = new Map((await db.oportunidade.findMany({ where: { id: { in: fatia } }, select: SELECAO })).map((b) => [b.id, b]));
    brutas = fatia.map((id) => porId.get(id)).filter((b): b is Bruta => !!b);
  } else if (total) {
    brutas = await db.oportunidade.findMany({ where, orderBy: montarOrderBy(e.ordem), skip: inicio, take: POR_PAGINA, select: SELECAO });
  }
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
  const ids = await idsOrdenados(await montarWhere(f, agora), ordem);
  yield BOM + linhaCsv(CABECALHO.map(celulaTexto));
  for (let i = 0; i < ids.length; i += lote) {
    const fatia = ids.slice(i, i + lote);
    const brutas = await db.oportunidade.findMany({ where: await montarWhere(f, agora, fatia), select: SELECAO });
    const porId = new Map(brutas.map((b) => [b.id, b]));
    const ordenadas = fatia.map((id) => porId.get(id)).filter((b): b is Bruta => !!b);
    yield (await paraLinhas(ordenadas, agora)).map(linhaParaCsv).join("");
  }
}

/**
 * Ranking (GAB-44), leitura no servidor. Uma consulta agregada (UNION ALL) por
 * intervalo traz todos os eventos que pontuam; o cálculo é puro (`calculo.ts`).
 * A visibilidade é decidida AQUI: com o ranking escondido o vendedor recebe só
 * a própria linha — a lista dos outros nunca sai do servidor.
 */
import { Prisma, type OrigemTransicao, type Papel, type PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { QUEM_ATUA, temPapelMinimo } from "@/lib/auth/papeis";
import { obterConfiguracao, salvarConfiguracao } from "@/lib/configuracao/servico";
import { calcularRanking, cobreJanelaFeed, janelaFeed, montarFeed, type DadosRanking, type Intervalo, type ItemFeed, type LinhaRanking, type Participante, type Ranking } from "./calculo";
import { CONFIG_RANKING, type ConfigRanking } from "./config";
import { resolverPeriodo, type Periodo } from "./periodo";

/** Chave do quadro de vendas (seed): só ele pontua. */
export const QUADRO_VENDAS = "vendas";

type Linha = {
  tipo: "GANHO" | "PERDIDO" | "TRANSICAO" | "ACAO" | "CRIACAO" | "ABERTO";
  op: string | null;
  titulo: string | null;
  usuario: string | null;
  em: Date | null;
  valor: number | null;
  criado: Date | null;
  tid: string | null;
  origem: OrigemTransicao | null;
  para_id: string | null;
  para_nome: string | null;
  para_ordem: number | null;
  para_terminal: boolean | null;
  de_ordem: number | null;
  qtd: number | null;
};

/** Quem pode rodar a consulta: o `db` ou uma transação (testes fixam o fuso da sessão nela). */
type Consultor = Pick<PrismaClient, "$queryRaw">;

/**
 * Instante JS → `timestamp` (sem fuso) em UTC, como o Prisma grava as colunas
 * `timestamp(3)`. O Prisma manda `Date` como `timestamptz`; comparado direto com
 * `timestamp`, o Postgres converteria pela TimeZone da SESSÃO. Aqui a conversão
 * é explícita e não depende dela.
 */
const utc = (d: Date) => Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

/**
 * Eventos do intervalo [inicio, fim) — só cards vivos de Vendas. Transições:
 * histórico COMPLETO (até `fim`) dos cards que se moveram no intervalo, para
 * achar a primeira entrada por fase. Ganho/perda trazem a origem e o instante
 * da transição que levou o card ao ganho/perda (vindo de fora dele: migração
 * entre duas fases de ganho não troca a origem). ABERTO = situação de agora.
 */
export async function carregarDados({ inicio, fim }: Intervalo, cliente: Consultor = db): Promise<DadosRanking> {
  const ini = utc(inicio);
  const ate = utc(fim);
  const linhas = await cliente.$queryRaw<Linha[]>`
    WITH vendas AS (SELECT id FROM pipeline WHERE chave = ${QUADRO_VENDAS}),
    vivos AS (SELECT o.* FROM oportunidade o WHERE o.pipeline_id IN (SELECT id FROM vendas) AND o.deletado_em IS NULL),
    movidos AS (
      SELECT DISTINCT t.oportunidade_id FROM transicao_fase t JOIN vivos o ON o.id = t.oportunidade_id
      WHERE t.em >= ${ini} AND t.em < ${ate} AND t.de_fase_id IS NOT NULL
    ),
    terminais AS (
      SELECT o.id, o.titulo, o.responsavel_id, o.data_ganho, o.valor_fechado, o.criado_em, f.tipo_terminal, entrada.origem, entrada.em AS entrou_em
        FROM vivos o JOIN fase f ON f.id = o.fase_id
        LEFT JOIN LATERAL (
          SELECT t.origem, t.em FROM transicao_fase t
            JOIN fase pf ON pf.id = t.para_fase_id LEFT JOIN fase df ON df.id = t.de_fase_id
           WHERE t.oportunidade_id = o.id AND pf.tipo_terminal = f.tipo_terminal AND df.tipo_terminal IS DISTINCT FROM f.tipo_terminal
           ORDER BY t.em DESC, t.id DESC LIMIT 1
        ) entrada ON true
       WHERE f.tipo_terminal IS NOT NULL
    )
    SELECT 'GANHO' AS tipo, x.id AS op, x.titulo, x.responsavel_id AS usuario, x.data_ganho AS em, x.valor_fechado::float8 AS valor, x.criado_em AS criado,
           NULL::text AS tid, x.origem, NULL::text AS para_id, NULL::text AS para_nome, NULL::int AS para_ordem,
           NULL::boolean AS para_terminal, NULL::int AS de_ordem, NULL::int AS qtd
      FROM terminais x
     WHERE x.tipo_terminal = 'GANHO' AND x.data_ganho >= ${ini} AND x.data_ganho < ${ate}
    UNION ALL
    SELECT 'PERDIDO', x.id, NULL, x.responsavel_id, x.entrou_em, NULL, NULL, NULL, x.origem, NULL, NULL, NULL, NULL, NULL, NULL
      FROM terminais x
     WHERE x.tipo_terminal = 'PERDIDO' AND x.entrou_em >= ${ini} AND x.entrou_em < ${ate}
    UNION ALL
    SELECT 'TRANSICAO', t.oportunidade_id, o.titulo, t.usuario_id, t.em, NULL, NULL, t.id, t.origem, t.para_fase_id, pf.nome, pf.ordem, pf.is_terminal, df.ordem, NULL
      FROM transicao_fase t JOIN vivos o ON o.id = t.oportunidade_id
      JOIN fase pf ON pf.id = t.para_fase_id LEFT JOIN fase df ON df.id = t.de_fase_id
     WHERE t.oportunidade_id IN (SELECT oportunidade_id FROM movidos) AND t.em < ${ate}
    UNION ALL
    SELECT 'ACAO', tl.oportunidade_id, NULL, tl.usuario_id, tl.em, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      FROM timeline tl JOIN vivos o ON o.id = tl.oportunidade_id
     WHERE tl.tipo = 'NOTA' AND (tl.payload -> 'feito') IS NOT NULL AND tl.usuario_id IS NOT NULL AND tl.em >= ${ini} AND tl.em < ${ate}
    UNION ALL
    SELECT 'CRIACAO', t.oportunidade_id, NULL, t.usuario_id, t.em, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      FROM transicao_fase t JOIN vivos o ON o.id = t.oportunidade_id
     WHERE t.de_fase_id IS NULL AND t.origem IN ('UI', 'WHATSAPP') AND t.usuario_id IS NOT NULL AND t.em >= ${ini} AND t.em < ${ate}
    UNION ALL
    SELECT 'ABERTO', NULL, NULL, o.responsavel_id, NULL, COALESCE(SUM(o.orcamento_previsto), 0)::float8, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, COUNT(*)::int
      FROM vivos o JOIN fase f ON f.id = o.fase_id
     WHERE NOT f.is_terminal
     GROUP BY o.responsavel_id
  `;

  const d: DadosRanking = { ganhos: [], perdas: [], transicoes: [], acoes: [], criacoes: [], abertos: [] };
  for (const l of linhas) {
    switch (l.tipo) {
      case "GANHO":
        d.ganhos.push({ oportunidadeId: l.op!, titulo: l.titulo!, responsavelId: l.usuario!, dataGanho: l.em!, valorFechado: l.valor, criadoEm: l.criado!, origem: l.origem });
        break;
      case "PERDIDO":
        d.perdas.push({ oportunidadeId: l.op!, responsavelId: l.usuario!, em: l.em!, origem: l.origem });
        break;
      case "TRANSICAO":
        d.transicoes.push({
          id: l.tid!,
          oportunidadeId: l.op!,
          titulo: l.titulo!,
          usuarioId: l.usuario,
          origem: l.origem!,
          em: l.em!,
          paraFaseId: l.para_id!,
          paraFaseNome: l.para_nome!,
          paraOrdem: l.para_ordem!,
          paraTerminal: l.para_terminal!,
          deOrdem: l.de_ordem,
        });
        break;
      case "ACAO":
        d.acoes.push({ oportunidadeId: l.op!, usuarioId: l.usuario!, em: l.em! });
        break;
      case "CRIACAO":
        d.criacoes.push({ oportunidadeId: l.op!, usuarioId: l.usuario!, em: l.em! });
        break;
      case "ABERTO":
        d.abertos.push({ responsavelId: l.usuario!, quantidade: l.qtd ?? 0, orcamento: l.valor ?? 0 });
        break;
    }
  }
  return d;
}

/**
 * Quem aparece: usuários ATIVOS com papel VENDEDOR, mais gestores/admins
 * ativos que são responsáveis por algum card vivo de Vendas. VISUALIZADOR
 * ativo nunca aparece (`QUEM_ATUA`), nem com card. `inativos`:
 * desativados — saem da lista, mas o que fizeram conta na linha "Time".
 * Uma consulta só.
 */
export async function listarParticipantes(): Promise<{ participantes: Participante[]; inativos: string[] }> {
  const us = await db.usuario.findMany({
    where: {
      OR: [
        { ativo: false },
        { ativo: true, ...QUEM_ATUA, OR: [{ papel: "VENDEDOR" }, { oportunidades: { some: { deletadoEm: null, pipeline: { chave: QUADRO_VENDAS } } } }] },
      ],
    },
    orderBy: { nome: "asc" },
    select: { id: true, nome: true, ativo: true, foto: { select: { atualizadoEm: true } } },
  });
  return {
    participantes: us.filter((u) => u.ativo).map((u) => ({ id: u.id, nome: u.nome, fotoEm: u.foto?.atualizadoEm.getTime() ?? null })),
    inativos: us.filter((u) => !u.ativo).map((u) => u.id),
  };
}

export async function obterConfigRanking(): Promise<ConfigRanking> {
  return (await obterConfiguracao(CONFIG_RANKING)).valor;
}

type Ator = { id: string; papel: Papel };

/**
 * Gestor/admin e VISUALIZADOR sempre veem tudo (o visualizador não está no
 * ranking, então "só a própria linha" não faria sentido); vendedor, só se o
 * gestor deixou.
 */
export function podeVerRanking(ator: Ator, config: ConfigRanking): boolean {
  return temPapelMinimo(ator.papel, "GESTOR") || ator.papel === "VISUALIZADOR" || config.mostrarAosVendedores;
}

/** Linha do próprio usuário sem a posição (com o ranking escondido, nem ela vaza). */
export type LinhaPropria = Omit<LinhaRanking, "posicao">;

export type VisaoRanking =
  | { modo: "completo"; periodo: Periodo; config: ConfigRanking; ranking: Ranking; eu: LinhaRanking | null; feed: ItemFeed[] }
  | { modo: "proprio"; periodo: Periodo; config: ConfigRanking; eu: LinhaPropria | null; feed: ItemFeed[] };

function soPropria(l: LinhaRanking | undefined): LinhaPropria | null {
  if (!l) return null;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { posicao, ...resto } = l;
  return resto;
}

/**
 * Tela /ranking: período pedido + feed dos últimos 7 dias. Config, participantes
 * e UMA consulta de eventos; o feed reaproveita os eventos do período quando ele
 * cobre os 7 dias (mês atual a partir do dia 8), senão faz a consulta da janela.
 */
export async function carregarRanking(ator: Ator, periodo: Periodo, agora: Date): Promise<VisaoRanking> {
  const reaproveita = cobreJanelaFeed(periodo, agora);
  const [config, { participantes, inativos }, dados, dadosFeed] = await Promise.all([
    obterConfigRanking(),
    listarParticipantes(),
    carregarDados(periodo),
    reaproveita ? null : carregarDados(janelaFeed(agora)),
  ]);
  const ranking = calcularRanking(participantes, dados, periodo, config, { soNoTime: inativos });
  const eu = ranking.linhas.find((l) => l.usuario.id === ator.id);
  const fonteFeed = dadosFeed ?? dados;
  if (podeVerRanking(ator, config)) return { modo: "completo", periodo, config, ranking, eu: eu ?? null, feed: montarFeed(participantes, fonteFeed, agora) };
  // Oculto: filtra pelo próprio usuário ANTES do limite do feed.
  return { modo: "proprio", periodo, config, eu: soPropria(eu), feed: montarFeed(participantes, fonteFeed, agora, { apenas: ator.id }) };
}

export type Top3 = { modo: "completo"; top: LinhaRanking[]; eu: LinhaRanking | null } | { modo: "proprio"; eu: LinhaPropria | null };

/** Card "Top 3 da semana" (Minha Semana): semana atual de SP. */
export async function carregarTop3(ator: Ator, agora: Date): Promise<Top3> {
  const periodo = resolverPeriodo("semana", undefined, agora);
  const [config, { participantes }, dados] = await Promise.all([obterConfigRanking(), listarParticipantes(), carregarDados(periodo)]);
  const { linhas } = calcularRanking(participantes, dados, periodo, config);
  const eu = linhas.find((l) => l.usuario.id === ator.id);
  if (!podeVerRanking(ator, config)) return { modo: "proprio", eu: soPropria(eu) };
  return { modo: "completo", top: linhas.filter((l) => l.pontos > 0).slice(0, 3), eu: eu ?? null };
}

export type ErroConfigRanking =
  | { ok: false; erro: "SEM_PERMISSAO" }
  | { ok: false; erro: "CONFLITO" }
  | { ok: false; erro: "DADOS_INVALIDOS"; mensagem: string };

/**
 * Pesos/visibilidade: só GESTOR+. `versao` = `atualizado_em` que o formulário
 * carregou (null = ainda sem linha): outra gravação no meio → `CONFLITO`.
 */
export async function salvarConfigRanking(entrada: unknown, ator: Ator, versao: Date | null): Promise<{ ok: true; valor: ConfigRanking } | ErroConfigRanking> {
  if (!temPapelMinimo(ator.papel, "GESTOR")) return { ok: false, erro: "SEM_PERMISSAO" };
  const r = await salvarConfiguracao(CONFIG_RANKING, entrada, ator.id, versao);
  if (r.ok) return r;
  return r.erro === "CONFLITO" ? { ok: false, erro: "CONFLITO" } : { ok: false, erro: "DADOS_INVALIDOS", mensagem: r.mensagem };
}

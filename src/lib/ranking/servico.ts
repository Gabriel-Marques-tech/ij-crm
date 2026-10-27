/**
 * Ranking (GAB-44), leitura no servidor. Uma consulta agregada (UNION ALL) por
 * intervalo traz todos os eventos que pontuam; o cálculo é puro (`calculo.ts`).
 * A visibilidade é decidida AQUI: com o ranking escondido o vendedor recebe só
 * a própria linha — a lista dos outros nunca sai do servidor.
 */
import type { OrigemTransicao, Papel } from "@prisma/client";
import { db } from "@/lib/db";
import { temPapelMinimo } from "@/lib/auth/papeis";
import { obterConfiguracao, salvarConfiguracao } from "@/lib/configuracao/servico";
import { calcularRanking, montarFeed, DIAS_FEED, type DadosRanking, type Intervalo, type ItemFeed, type LinhaRanking, type Participante, type Ranking } from "./calculo";
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

/**
 * Eventos do intervalo [inicio, fim) — só cards vivos de Vendas. Transições:
 * histórico COMPLETO (até `fim`) dos cards que se moveram no intervalo, para
 * achar a primeira entrada por fase. ABERTO = situação de agora, por responsável.
 */
export async function carregarDados({ inicio, fim }: Intervalo): Promise<DadosRanking> {
  const linhas = await db.$queryRaw<Linha[]>`
    WITH vendas AS (SELECT id FROM pipeline WHERE chave = ${QUADRO_VENDAS}),
    vivos AS (SELECT o.* FROM oportunidade o WHERE o.pipeline_id IN (SELECT id FROM vendas) AND o.deletado_em IS NULL),
    movidos AS (
      SELECT DISTINCT t.oportunidade_id FROM transicao_fase t JOIN vivos o ON o.id = t.oportunidade_id
      WHERE t.em >= ${inicio} AND t.em < ${fim} AND t.de_fase_id IS NOT NULL
    )
    SELECT 'GANHO' AS tipo, o.id AS op, o.titulo, o.responsavel_id AS usuario, o.data_ganho AS em, o.valor_fechado::float8 AS valor, o.criado_em AS criado,
           NULL::text AS tid, NULL::"OrigemTransicao" AS origem, NULL::text AS para_id, NULL::text AS para_nome, NULL::int AS para_ordem,
           NULL::boolean AS para_terminal, NULL::int AS de_ordem, NULL::int AS qtd
      FROM vivos o JOIN fase f ON f.id = o.fase_id
     WHERE f.tipo_terminal = 'GANHO' AND o.data_ganho >= ${inicio} AND o.data_ganho < ${fim}
    UNION ALL
    SELECT 'PERDIDO', o.id, NULL, o.responsavel_id, o.fase_desde, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      FROM vivos o JOIN fase f ON f.id = o.fase_id
     WHERE f.tipo_terminal = 'PERDIDO' AND o.fase_desde >= ${inicio} AND o.fase_desde < ${fim}
    UNION ALL
    SELECT 'TRANSICAO', t.oportunidade_id, o.titulo, t.usuario_id, t.em, NULL, NULL, t.id, t.origem, t.para_fase_id, pf.nome, pf.ordem, pf.is_terminal, df.ordem, NULL
      FROM transicao_fase t JOIN vivos o ON o.id = t.oportunidade_id
      JOIN fase pf ON pf.id = t.para_fase_id LEFT JOIN fase df ON df.id = t.de_fase_id
     WHERE t.oportunidade_id IN (SELECT oportunidade_id FROM movidos) AND t.em < ${fim}
    UNION ALL
    SELECT 'ACAO', tl.oportunidade_id, NULL, tl.usuario_id, tl.em, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      FROM timeline tl JOIN vivos o ON o.id = tl.oportunidade_id
     WHERE tl.tipo = 'NOTA' AND (tl.payload -> 'feito') IS NOT NULL AND tl.usuario_id IS NOT NULL AND tl.em >= ${inicio} AND tl.em < ${fim}
    UNION ALL
    SELECT 'CRIACAO', t.oportunidade_id, NULL, t.usuario_id, t.em, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      FROM transicao_fase t JOIN vivos o ON o.id = t.oportunidade_id
     WHERE t.de_fase_id IS NULL AND t.origem IN ('UI', 'WHATSAPP') AND t.usuario_id IS NOT NULL AND t.em >= ${inicio} AND t.em < ${fim}
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
        d.ganhos.push({ oportunidadeId: l.op!, titulo: l.titulo!, responsavelId: l.usuario!, dataGanho: l.em!, valorFechado: l.valor, criadoEm: l.criado! });
        break;
      case "PERDIDO":
        d.perdas.push({ oportunidadeId: l.op!, responsavelId: l.usuario!, em: l.em! });
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
 * ativos que são responsáveis por algum card vivo de Vendas.
 */
export async function listarParticipantes(): Promise<Participante[]> {
  const us = await db.usuario.findMany({
    where: {
      ativo: true,
      OR: [{ papel: "VENDEDOR" }, { oportunidades: { some: { deletadoEm: null, pipeline: { chave: QUADRO_VENDAS } } } }],
    },
    orderBy: { nome: "asc" },
    select: { id: true, nome: true, foto: { select: { atualizadoEm: true } } },
  });
  return us.map((u) => ({ id: u.id, nome: u.nome, fotoEm: u.foto?.atualizadoEm.getTime() ?? null }));
}

export async function obterConfigRanking(): Promise<ConfigRanking> {
  return (await obterConfiguracao(CONFIG_RANKING)).valor;
}

type Ator = { id: string; papel: Papel };

/** Gestor/admin sempre veem tudo; vendedor, só se o gestor deixou. */
export function podeVerRanking(ator: Ator, config: ConfigRanking): boolean {
  return temPapelMinimo(ator.papel, "GESTOR") || config.mostrarAosVendedores;
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

/** Tela /ranking: período pedido + feed dos últimos 7 dias. 3 consultas (config, participantes, eventos) + 1 do feed. */
export async function carregarRanking(ator: Ator, periodo: Periodo, agora: Date): Promise<VisaoRanking> {
  const janelaFeed = { inicio: new Date(agora.getTime() - DIAS_FEED * 86_400_000), fim: new Date(agora.getTime() + 1) };
  const [config, participantes, dados, dadosFeed] = await Promise.all([obterConfigRanking(), listarParticipantes(), carregarDados(periodo), carregarDados(janelaFeed)]);
  const ranking = calcularRanking(participantes, dados, periodo, config);
  const feed = montarFeed(participantes, dadosFeed, agora);
  const eu = ranking.linhas.find((l) => l.usuario.id === ator.id);
  if (podeVerRanking(ator, config)) return { modo: "completo", periodo, config, ranking, eu: eu ?? null, feed };
  return { modo: "proprio", periodo, config, eu: soPropria(eu), feed: feed.filter((i) => i.usuario.id === ator.id) };
}

export type Top3 = { modo: "completo"; top: LinhaRanking[]; eu: LinhaRanking | null } | { modo: "proprio"; eu: LinhaPropria | null };

/** Card "Top 3 da semana" (Minha Semana): semana atual de SP. */
export async function carregarTop3(ator: Ator, agora: Date): Promise<Top3> {
  const periodo = resolverPeriodo("semana", undefined, agora);
  const [config, participantes, dados] = await Promise.all([obterConfigRanking(), listarParticipantes(), carregarDados(periodo)]);
  const { linhas } = calcularRanking(participantes, dados, periodo, config);
  const eu = linhas.find((l) => l.usuario.id === ator.id);
  if (!podeVerRanking(ator, config)) return { modo: "proprio", eu: soPropria(eu) };
  return { modo: "completo", top: linhas.filter((l) => l.pontos > 0).slice(0, 3), eu: eu ?? null };
}

export type ErroConfigRanking = { ok: false; erro: "SEM_PERMISSAO" } | { ok: false; erro: "DADOS_INVALIDOS"; mensagem: string };

/** Pesos/visibilidade: só GESTOR+. */
export async function salvarConfigRanking(entrada: unknown, ator: Ator): Promise<{ ok: true; valor: ConfigRanking } | ErroConfigRanking> {
  if (!temPapelMinimo(ator.papel, "GESTOR")) return { ok: false, erro: "SEM_PERMISSAO" };
  const r = await salvarConfiguracao(CONFIG_RANKING, entrada, ator.id);
  return r.ok ? r : { ok: false, erro: "DADOS_INVALIDOS", mensagem: r.mensagem };
}


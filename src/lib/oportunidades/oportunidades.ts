/**
 * Serviço de oportunidades do Kanban (GAB-29): criar card, mover, editar
 * inline, notas e leitura. Permissão é do chamador (`exigirUsuario`): pela
 * matriz de papéis (§4.5) qualquer usuário cria/edita/move.
 *
 * Concorrência: criar e mover tomam o lock de pipeline da Gestão de fases
 * (`travarPipelines`, ordem fixa por id) e releem a fase destino DEPOIS do
 * lock — assim um card nunca cai numa fase que acabou de ser arquivada. Mover
 * para terminal trava também os quadros que o gancho do GAB-32 vai tocar
 * (`pipelinesExtrasDoTerminal`), todos de uma vez e na mesma ordem. Editar trava só a linha do card
 * (`FOR UPDATE`) para o "antes" da Timeline ser o valor que de fato mudou.
 *
 * Todo acesso filtra `deletadoEm: null`: card soft-deletado não aparece, não
 * move e não edita.
 */
import type { Fase, Origem, Prisma, TipoTerminal, TipoTimeline } from "@prisma/client";
import { db } from "@/lib/db";
import { listarPipelines, travarPipelines } from "@/lib/fases/fases";
import { diaEmFuso } from "./aging";
import { validarTitulo, type CampoEditavel, type ValorCampo } from "./campos";
import { ErroDeRegra, type ErroOportunidade } from "./erros";
import { aoEntrarEmTerminal, aoSairDeTerminal, pipelinesExtrasDoTerminal } from "./terminal";
import type { DadosTerminal } from "./terminal-regras";

export type { ErroOportunidade } from "./erros";

export type Resultado<T = object> = ({ ok: true } & T) | { ok: false; erro: ErroOportunidade };

type Tx = Prisma.TransactionClient;
type Ator = { id: string };

function traduzir<T>(e: unknown): Resultado<T> {
  if (e instanceof ErroDeRegra) return { ok: false, erro: e.erro };
  throw e;
}

async function idsDePipelines(tx: Tx, chaves: string[]): Promise<string[]> {
  if (chaves.length === 0) return [];
  const ps = await tx.pipeline.findMany({ where: { chave: { in: chaves } }, select: { id: true } });
  return ps.map((p) => p.id);
}

/** Pressupõe o lock do pipeline: relê a fase e valida que serve de destino. */
async function faseDestino(tx: Tx, faseId: string, pipelineId: string): Promise<Fase> {
  const f = await tx.fase.findUnique({ where: { id: faseId } });
  if (!f) throw new ErroDeRegra("FASE_NAO_ENCONTRADA");
  if (f.pipelineId !== pipelineId) throw new ErroDeRegra("FASE_DE_OUTRO_PIPELINE");
  if (f.arquivadaEm) throw new ErroDeRegra("FASE_ARQUIVADA");
  return f;
}

// ---------------------------------------------------------------- leitura

export type CardDoQuadro = {
  id: string;
  titulo: string;
  faseId: string;
  faseDesde: Date;
  revisar: boolean;
  proximaAcao: string | null;
  proximaAcaoEm: Date | null;
  origem: Origem | null;
  estado: string | null;
  responsavel: { id: string; nome: string };
  empresa: { nome: string } | null;
};

export type Quadro = {
  pipeline: { id: string; chave: string; nome: string };
  fases: Fase[];
  cards: CardDoQuadro[];
};

/**
 * Um quadro (pipeline) para o Kanban: fases ATIVAS em (ordem, criadoEm) e os
 * cards vivos delas. Cards mais recentes na fase primeiro (sem ordenação
 * manual dentro da coluna na v1).
 */
export async function listarQuadro(pipelineChave: string): Promise<Quadro | null> {
  const p = (await listarPipelines()).find((x) => x.chave === pipelineChave);
  if (!p) return null;
  const cards = await db.oportunidade.findMany({
    where: { pipelineId: p.id, deletadoEm: null, faseId: { in: p.fases.map((f) => f.id) } },
    orderBy: [{ faseDesde: "desc" }, { id: "asc" }],
    select: {
      id: true,
      titulo: true,
      faseId: true,
      faseDesde: true,
      revisar: true,
      proximaAcao: true,
      proximaAcaoEm: true,
      origem: true,
      estado: true,
      responsavel: { select: { id: true, nome: true } },
      empresa: { select: { nome: true } },
    },
  });
  return { pipeline: { id: p.id, chave: p.chave, nome: p.nome }, fases: p.fases, cards };
}

export async function obterCard(id: string) {
  return db.oportunidade.findFirst({
    where: { id, deletadoEm: null },
    include: {
      pipeline: { select: { id: true, chave: true, nome: true } },
      fase: true,
      responsavel: { select: { id: true, nome: true } },
      empresa: { select: { id: true, nome: true } },
      contato: { select: { id: true, nome: true } },
      timeline: {
        orderBy: [{ em: "asc" }, { id: "asc" }],
        include: { usuario: { select: { id: true, nome: true } } },
      },
    },
  });
}

export type DetalheCard = NonNullable<Awaited<ReturnType<typeof obterCard>>>;

/** Quem pode ser responsável: usuários ativos. */
export async function listarResponsaveis() {
  return db.usuario.findMany({ where: { ativo: true }, orderBy: { nome: "asc" }, select: { id: true, nome: true } });
}

/** id → nome, inclusive inativos (a Timeline cita quem já saiu). */
export async function nomesDeUsuarios(ids: Iterable<string>): Promise<Map<string, string>> {
  const lista = [...new Set(ids)];
  if (lista.length === 0) return new Map();
  const us = await db.usuario.findMany({ where: { id: { in: lista } }, select: { id: true, nome: true } });
  return new Map(us.map((u) => [u.id, u.nome]));
}

// ---------------------------------------------------------------- escrita

export async function criarCard(
  dados: { pipelineId: string; faseId: string; titulo: string },
  por: Ator,
): Promise<Resultado<{ id: string }>> {
  const titulo = validarTitulo(dados.titulo);
  if (!titulo) return { ok: false, erro: "TITULO_INVALIDO" };
  try {
    const id = await db.$transaction(async (tx) => {
      if (!(await travarPipelines(tx, [dados.pipelineId]))) throw new ErroDeRegra("PIPELINE_NAO_ENCONTRADO");
      const f = await faseDestino(tx, dados.faseId, dados.pipelineId);
      // Ganho/perdido só por movimento: é ele que passa por `aoEntrarEmTerminal`.
      if (f.isTerminal) throw new ErroDeRegra("FASE_TERMINAL");
      const agora = new Date();
      const op = await tx.oportunidade.create({
        data: { pipelineId: dados.pipelineId, faseId: f.id, titulo, responsavelId: por.id, criadoVia: "UI", faseDesde: agora, criadoEm: agora },
        select: { id: true },
      });
      // Entrada no funil: de_fase_id null. Base das métricas de tempo por fase.
      await tx.transicaoFase.create({ data: { oportunidadeId: op.id, deFaseId: null, paraFaseId: f.id, usuarioId: por.id, origem: "UI", em: agora } });
      await tx.timeline.create({ data: { oportunidadeId: op.id, tipo: "CRIACAO", payload: { faseId: f.id, via: "UI" }, usuarioId: por.id, em: agora } });
      return op.id;
    });
    return { ok: true, id };
  } catch (e) {
    return traduzir(e);
  }
}

/**
 * Move o card para `paraFaseId` (qualquer direção). Mesma fase → no-op.
 * Origem terminal (reabrir) → `aoSairDeTerminal`; destino terminal →
 * `aoEntrarEmTerminal` (ganho/perdido, GAB-32). Tudo na mesma transação: erro
 * de regra do gancho (ex.: perdido sem motivo) desfaz o movimento inteiro.
 */
export async function moverCard(
  id: string,
  paraFaseId: string,
  por: Ator,
  opts: { dadosTerminal?: DadosTerminal } = {},
): Promise<Resultado<{ mudou: boolean; terminal: TipoTerminal | null }>> {
  try {
    return await db.$transaction(async (tx) => {
      const alvo = await tx.oportunidade.findFirst({
        where: { id, deletadoEm: null },
        select: { pipelineId: true, pipeline: { select: { chave: true } } },
      });
      if (!alvo) throw new ErroDeRegra("CARD_NAO_ENCONTRADO");
      // Antes do lock só para decidir QUAIS quadros travar (pipelineId de card e
      // de fase nunca mudam). O tipo terminal pode mudar: é reconferido abaixo.
      const previa = await tx.fase.findUnique({ where: { id: paraFaseId }, select: { tipoTerminal: true } });
      const extras = await idsDePipelines(tx, pipelinesExtrasDoTerminal(alvo.pipeline.chave, previa?.tipoTerminal ?? null));
      await travarPipelines(tx, [alvo.pipelineId, ...extras]);

      const op = await tx.oportunidade.findFirst({ where: { id, deletadoEm: null }, select: { faseId: true } });
      if (!op) throw new ErroDeRegra("CARD_NAO_ENCONTRADO");
      const destino = await faseDestino(tx, paraFaseId, alvo.pipelineId);
      if (destino.id === op.faseId) return { ok: true as const, mudou: false, terminal: null };
      // Gestor mudou o tipo terminal da fase entre a prévia e o lock: o conjunto
      // travado pode não bastar, e travar mais agora quebraria a ordem. Recusa.
      const necessarios = await idsDePipelines(tx, pipelinesExtrasDoTerminal(alvo.pipeline.chave, destino.tipoTerminal));
      if (necessarios.some((p) => !extras.includes(p))) throw new ErroDeRegra("CONFLITO_CONCORRENTE");

      const origem = await tx.fase.findUniqueOrThrow({ where: { id: op.faseId } });

      const agora = new Date();
      // Entradas da Timeline depois da MOVIMENTACAO: `em` estritamente crescente.
      let passo = 0;
      const instante = () => new Date(agora.getTime() + ++passo);
      await tx.oportunidade.update({ where: { id }, data: { faseId: destino.id, faseDesde: agora } });
      await tx.transicaoFase.create({ data: { oportunidadeId: id, deFaseId: op.faseId, paraFaseId: destino.id, usuarioId: por.id, origem: "UI", em: agora } });
      await tx.timeline.create({
        data: { oportunidadeId: id, tipo: "MOVIMENTACAO", payload: { deFaseId: op.faseId, paraFaseId: destino.id }, usuarioId: por.id, em: agora },
      });
      // Sai antes de entrar: ganho → perdido limpa o ganho e grava o motivo.
      if (origem.isTerminal) {
        await aoSairDeTerminal({ tx, oportunidadeId: id, pipelineChave: alvo.pipeline.chave, origem, porUsuarioId: por.id, em: agora, instante });
      }
      if (destino.isTerminal) {
        await aoEntrarEmTerminal({
          tx,
          oportunidadeId: id,
          pipelineChave: alvo.pipeline.chave,
          deFaseId: op.faseId,
          destino,
          porUsuarioId: por.id,
          em: agora,
          instante,
          dados: opts.dadosTerminal,
        });
      }
      return { ok: true as const, mudou: true, terminal: destino.tipoTerminal };
    });
  } catch (e) {
    return traduzir(e);
  }
}

export type PatchCard = Partial<Record<CampoEditavel, ValorCampo>>;

/** Valor como fica no payload da Timeline: JSON simples e comparável. */
function serializar(campo: CampoEditavel, v: unknown): string | boolean | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return campo === "proximaAcaoEm" ? diaEmFuso(v) : v.toISOString();
  if (typeof v === "boolean") return v;
  if (typeof v === "object" && "toFixed" in v && typeof v.toFixed === "function") return (v as { toFixed(n: number): string }).toFixed(2);
  return String(v);
}

/**
 * Edita campos do card. Só os que de fato mudaram são gravados, cada um com
 * uma Timeline `CAMPO_ALTERADO { campo, antes, depois }`, na ordem do patch.
 * Valores já vêm interpretados (`interpretarCampo`); aqui só regras de banco.
 */
export async function editarCard(id: string, patch: PatchCard, por: Ator): Promise<Resultado<{ alterados: CampoEditavel[] }>> {
  if ("titulo" in patch && (typeof patch.titulo !== "string" || !validarTitulo(patch.titulo))) {
    return { ok: false, erro: "TITULO_INVALIDO" };
  }
  const campos = Object.keys(patch) as CampoEditavel[];
  try {
    const alterados = await db.$transaction(async (tx) => {
      const travado = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM oportunidade WHERE id = ${id} AND deletado_em IS NULL FOR UPDATE`;
      if (travado.length === 0) throw new ErroDeRegra("CARD_NAO_ENCONTRADO");
      const atual = await tx.oportunidade.findUniqueOrThrow({ where: { id } });

      const mudancas: { campo: CampoEditavel; antes: string | boolean | null; depois: string | boolean | null }[] = [];
      for (const campo of campos) {
        const antes = serializar(campo, atual[campo]);
        const depois = serializar(campo, patch[campo]);
        if (antes !== depois) mudancas.push({ campo, antes, depois });
      }
      if (mudancas.length === 0) return [];

      const data: Prisma.OportunidadeUncheckedUpdateInput = {};
      for (const { campo } of mudancas) {
        const v = patch[campo] ?? null;
        if (campo === "responsavelId") {
          const u = await tx.usuario.findUnique({ where: { id: String(v) }, select: { ativo: true } });
          if (!u?.ativo) throw new ErroDeRegra("RESPONSAVEL_INVALIDO");
          data.responsavelId = String(v);
        } else if (campo === "titulo") {
          data.titulo = validarTitulo(String(v))!;
        } else if (campo === "revisar") {
          data.revisar = v === true;
        } else if (campo === "origem") {
          data.origem = v as Origem | null;
        } else if (campo === "proximaAcaoEm") {
          data.proximaAcaoEm = v as Date | null;
        } else {
          (data as Record<string, unknown>)[campo] = v;
        }
      }
      await tx.oportunidade.update({ where: { id }, data });

      // `em` estritamente crescente: a Timeline ordena por `em` e as entradas
      // de um mesmo patch precisam manter a ordem.
      const base = Date.now();
      await tx.timeline.createMany({
        data: mudancas.map((m, i) => ({
          oportunidadeId: id,
          tipo: "CAMPO_ALTERADO" as TipoTimeline,
          payload: m,
          usuarioId: por.id,
          em: new Date(base + i),
        })),
      });
      return mudancas.map((m) => m.campo);
    });
    return { ok: true, alterados };
  } catch (e) {
    return traduzir(e);
  }
}

export const NOTA_MAX = 5000;

export async function adicionarNota(id: string, texto: string, por: Ator): Promise<Resultado> {
  const t = texto.trim();
  if (t.length === 0 || t.length > NOTA_MAX) return { ok: false, erro: "NOTA_INVALIDA" };
  const op = await db.oportunidade.findFirst({ where: { id, deletadoEm: null }, select: { id: true } });
  if (!op) return { ok: false, erro: "CARD_NAO_ENCONTRADO" };
  await db.timeline.create({ data: { oportunidadeId: id, tipo: "NOTA", payload: { texto: t }, usuarioId: por.id } });
  return { ok: true };
}

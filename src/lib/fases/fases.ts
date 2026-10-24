/**
 * Serviço de pipelines/fases (GAB-27). Leitura passa pelo cache em memória;
 * toda escrita invalida. Permissão (GESTOR+) é do chamador (`exigirPapel`).
 */
import type { Fase, Prisma, TipoTerminal } from "@prisma/client";
import { db } from "@/lib/db";
import { cachePipelines, invalidarCachePipelines } from "./cache";
import {
  chaveDeNome,
  chaveUnica,
  validarCor,
  validarRemocao,
  validarReordenacao,
  validarTerminais,
  type AcaoRemocao,
  type ErroFase,
} from "./regras";
import type { PipelineComFases } from "./tipos";

export type { ErroFase, AcaoRemocao } from "./regras";
export type { PipelineComFases } from "./tipos";

export type Resultado<T = object> = ({ ok: true } & T) | { ok: false; erro: ErroFase };

type Tx = Prisma.TransactionClient;

class ErroDeRegra extends Error {
  constructor(readonly erro: ErroFase) {
    super(erro);
  }
}

async function carregarPipelines(): Promise<PipelineComFases[]> {
  return db.pipeline.findMany({
    orderBy: { ordem: "asc" },
    include: { fases: { orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }] } },
  });
}

/** Pipelines com fases ativas (ordenadas). `incluirArquivadas` só para Gestão. */
export async function listarPipelines(opts: { incluirArquivadas?: boolean } = {}): Promise<PipelineComFases[]> {
  const lista = await cachePipelines.obter(carregarPipelines);
  if (opts.incluirArquivadas) return lista;
  return lista.map((p) => ({ ...p, fases: p.fases.filter((f) => f.arquivadaEm === null) }));
}

export type FaseComUso = Fase & { uso: { cards: number; transicoes: number } };
export type PipelineParaGestao = Omit<PipelineComFases, "fases"> & { fases: FaseComUso[] };

/** Para a tela de Gestão: tudo (inclusive arquivadas) + uso real, que NÃO é cacheado. */
export async function listarPipelinesParaGestao(): Promise<PipelineParaGestao[]> {
  const [lista, cards, de, para] = await Promise.all([
    listarPipelines({ incluirArquivadas: true }),
    db.oportunidade.groupBy({ by: ["faseId"], _count: { _all: true } }),
    db.transicaoFase.groupBy({ by: ["deFaseId"], _count: { _all: true } }),
    db.transicaoFase.groupBy({ by: ["paraFaseId"], _count: { _all: true } }),
  ]);
  const nCards = new Map(cards.map((c) => [c.faseId, c._count._all]));
  const nTrans = new Map<string, number>();
  for (const t of de) if (t.deFaseId) nTrans.set(t.deFaseId, (nTrans.get(t.deFaseId) ?? 0) + t._count._all);
  for (const t of para) nTrans.set(t.paraFaseId, (nTrans.get(t.paraFaseId) ?? 0) + t._count._all);
  return lista.map((p) => ({
    ...p,
    fases: p.fases.map((f) => ({ ...f, uso: { cards: nCards.get(f.id) ?? 0, transicoes: nTrans.get(f.id) ?? 0 } })),
  }));
}

// ---------------------------------------------------------------- validação de campos

function validarNome(nome: string): string | null {
  const n = nome.trim().replace(/\s+/g, " ");
  return n.length >= 2 && n.length <= 60 ? n : null;
}

function validarLimite(limite: number | null): boolean {
  return limite === null || (Number.isInteger(limite) && limite >= 1 && limite <= 365);
}

type CamposTerminal = { isTerminal: boolean; tipoTerminal: TipoTerminal | null };
const terminal = (tipo: TipoTerminal | null): CamposTerminal => ({ isTerminal: tipo !== null, tipoTerminal: tipo });

// ---------------------------------------------------------------- escrita

export async function criarFase(
  pipelineId: string,
  dados: { nome: string; cor?: string | null; limiteDiasAlerta?: number | null; tipoTerminal?: TipoTerminal | null },
): Promise<Resultado<{ faseId: string }>> {
  const nome = validarNome(dados.nome);
  if (!nome) return { ok: false, erro: "NOME_INVALIDO" };
  const cor = dados.cor ? validarCor(dados.cor) : null;
  if (dados.cor && !cor) return { ok: false, erro: "COR_INVALIDA" };
  const limite = dados.limiteDiasAlerta ?? null;
  if (!validarLimite(limite)) return { ok: false, erro: "LIMITE_INVALIDO" };

  const pipeline = await db.pipeline.findUnique({
    where: { id: pipelineId },
    include: { fases: { select: { chave: true, ordem: true } } },
  });
  if (!pipeline) return { ok: false, erro: "PIPELINE_NAO_ENCONTRADO" };

  const chave = chaveUnica(chaveDeNome(nome), pipeline.fases.map((f) => f.chave));
  const ordem = pipeline.fases.reduce((max, f) => Math.max(max, f.ordem), -1) + 1;
  const f = await db.fase.create({
    data: { pipelineId, chave, nome, ordem, cor, limiteDiasAlerta: limite, ...terminal(dados.tipoTerminal ?? null) },
    select: { id: true },
  });
  invalidarCachePipelines();
  return { ok: true, faseId: f.id };
}

/** Edita nome/cor/limite/terminal. `chave` nunca muda. `undefined` = não mexe. */
export async function editarFase(
  faseId: string,
  dados: { nome?: string; cor?: string | null; limiteDiasAlerta?: number | null; tipoTerminal?: TipoTerminal | null },
): Promise<Resultado> {
  const patch: Prisma.FaseUpdateManyMutationInput = {};
  if (dados.nome !== undefined) {
    const nome = validarNome(dados.nome);
    if (!nome) return { ok: false, erro: "NOME_INVALIDO" };
    patch.nome = nome;
  }
  if (dados.cor !== undefined) {
    const cor = dados.cor ? validarCor(dados.cor) : null;
    if (dados.cor && !cor) return { ok: false, erro: "COR_INVALIDA" };
    patch.cor = cor;
  }
  if (dados.limiteDiasAlerta !== undefined) {
    if (!validarLimite(dados.limiteDiasAlerta)) return { ok: false, erro: "LIMITE_INVALIDO" };
    patch.limiteDiasAlerta = dados.limiteDiasAlerta;
  }

  try {
    await db.$transaction(async (tx) => {
      const fase = await tx.fase.findUnique({ where: { id: faseId }, include: { pipeline: { select: { chave: true } } } });
      if (!fase) throw new ErroDeRegra("FASE_NAO_ENCONTRADA");
      if (fase.arquivadaEm) throw new ErroDeRegra("FASE_ARQUIVADA");
      if (dados.tipoTerminal !== undefined && dados.tipoTerminal !== fase.tipoTerminal) {
        const ativas = await tx.fase.findMany({ where: { pipelineId: fase.pipelineId, arquivadaEm: null }, select: { id: true, tipoTerminal: true } });
        const simuladas = ativas.map((f) => (f.id === faseId ? { tipoTerminal: dados.tipoTerminal! } : f));
        const erro = validarTerminais(fase.pipeline.chave, simuladas);
        if (erro) throw new ErroDeRegra(erro);
        Object.assign(patch, terminal(dados.tipoTerminal));
      }
      await tx.fase.update({ where: { id: faseId }, data: patch });
    });
  } catch (e) {
    if (e instanceof ErroDeRegra) return { ok: false, erro: e.erro };
    throw e;
  }
  invalidarCachePipelines();
  return { ok: true };
}

async function aplicarOrdem(tx: Tx, pipelineId: string, faseIds: string[]) {
  const ativas = await tx.fase.findMany({ where: { pipelineId, arquivadaEm: null }, select: { id: true }, orderBy: { ordem: "asc" } });
  if (!validarReordenacao(ativas.map((f) => f.id), faseIds)) throw new ErroDeRegra("ORDEM_INVALIDA");
  for (const [ordem, id] of faseIds.entries()) {
    await tx.fase.update({ where: { id }, data: { ordem } });
  }
}

/** Persiste `ordem` 0..n-1 na sequência dada (precisa ser permutação das ativas). */
export async function reordenarFases(pipelineId: string, faseIds: string[]): Promise<Resultado> {
  try {
    await db.$transaction((tx) => aplicarOrdem(tx, pipelineId, faseIds));
  } catch (e) {
    if (e instanceof ErroDeRegra) return { ok: false, erro: e.erro };
    throw e;
  }
  invalidarCachePipelines();
  return { ok: true };
}

/** Botões subir/descer: troca com a vizinha; nas pontas é no-op. */
export async function moverFase(faseId: string, direcao: "SUBIR" | "DESCER"): Promise<Resultado> {
  try {
    await db.$transaction(async (tx) => {
      const fase = await tx.fase.findUnique({ where: { id: faseId }, select: { pipelineId: true, arquivadaEm: true } });
      if (!fase) throw new ErroDeRegra("FASE_NAO_ENCONTRADA");
      if (fase.arquivadaEm) throw new ErroDeRegra("FASE_ARQUIVADA");
      const ativas = await tx.fase.findMany({
        where: { pipelineId: fase.pipelineId, arquivadaEm: null },
        select: { id: true },
        orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }],
      });
      const ids = ativas.map((f) => f.id);
      const i = ids.indexOf(faseId);
      const j = direcao === "SUBIR" ? i - 1 : i + 1;
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      await aplicarOrdem(tx, fase.pipelineId, ids);
    });
  } catch (e) {
    if (e instanceof ErroDeRegra) return { ok: false, erro: e.erro };
    throw e;
  }
  invalidarCachePipelines();
  return { ok: true };
}

/**
 * Remove uma fase. Com cards, exige `destinoFaseId`: os cards migram
 * (`fase_desde = now`) com TransicaoFase origem SISTEMA, e a fase é arquivada.
 * Sem cards e sem histórico, apaga de verdade. Ver `validarRemocao`.
 */
export async function removerFase(
  faseId: string,
  opts: { destinoFaseId?: string | null },
  por: { id: string },
): Promise<Resultado<{ acao: AcaoRemocao }>> {
  try {
    const acao = await db.$transaction(async (tx) => {
      const fase = await tx.fase.findUnique({ where: { id: faseId }, include: { pipeline: { select: { chave: true } } } });
      if (!fase) throw new ErroDeRegra("FASE_NAO_ENCONTRADA");
      if (fase.arquivadaEm) throw new ErroDeRegra("FASE_ARQUIVADA");

      const ativas = await tx.fase.findMany({ where: { pipelineId: fase.pipelineId, arquivadaEm: null }, select: { id: true, tipoTerminal: true } });
      const erroTerminal = validarTerminais(fase.pipeline.chave, ativas.filter((f) => f.id !== faseId));
      if (erroTerminal) throw new ErroDeRegra(erroTerminal);

      const [qtdCards, qtdTransicoes, destino] = await Promise.all([
        tx.oportunidade.count({ where: { faseId } }),
        tx.transicaoFase.count({ where: { OR: [{ deFaseId: faseId }, { paraFaseId: faseId }] } }),
        opts.destinoFaseId
          ? tx.fase.findUnique({ where: { id: opts.destinoFaseId }, select: { id: true, pipelineId: true, arquivadaEm: true } })
          : null,
      ]);
      const decisao = validarRemocao({ fase, qtdCards, qtdTransicoes, destino: destino ?? null });
      if (!decisao.ok) throw new ErroDeRegra(decisao.erro);

      if (qtdCards > 0 && destino) {
        const agora = new Date();
        const cards = await tx.oportunidade.findMany({ where: { faseId }, select: { id: true } });
        await tx.transicaoFase.createMany({
          data: cards.map((c) => ({ oportunidadeId: c.id, deFaseId: faseId, paraFaseId: destino.id, origem: "SISTEMA" as const, usuarioId: por.id, em: agora })),
        });
        await tx.oportunidade.updateMany({ where: { faseId }, data: { faseId: destino.id, faseDesde: agora } });
      }

      if (decisao.acao === "EXCLUIR") {
        await tx.fase.delete({ where: { id: faseId } });
      } else {
        await tx.fase.update({ where: { id: faseId }, data: { arquivadaEm: new Date() } });
      }
      return decisao.acao;
    });
    invalidarCachePipelines();
    return { ok: true, acao };
  } catch (e) {
    if (e instanceof ErroDeRegra) return { ok: false, erro: e.erro };
    // FK (P2003): alguém criou card/transição entre a contagem e o DELETE.
    if ((e as { code?: string })?.code === "P2003") return { ok: false, erro: "FASE_EM_USO" };
    throw e;
  }
}

/** Reativa uma fase arquivada, no fim do quadro. */
export async function desarquivarFase(faseId: string): Promise<Resultado> {
  try {
    await db.$transaction(async (tx) => {
      const fase = await tx.fase.findUnique({ where: { id: faseId }, select: { pipelineId: true, arquivadaEm: true } });
      if (!fase) throw new ErroDeRegra("FASE_NAO_ENCONTRADA");
      if (!fase.arquivadaEm) return;
      const max = await tx.fase.aggregate({ where: { pipelineId: fase.pipelineId, arquivadaEm: null }, _max: { ordem: true } });
      await tx.fase.update({ where: { id: faseId }, data: { arquivadaEm: null, ordem: (max._max.ordem ?? -1) + 1 } });
    });
  } catch (e) {
    if (e instanceof ErroDeRegra) return { ok: false, erro: e.erro };
    throw e;
  }
  invalidarCachePipelines();
  return { ok: true };
}

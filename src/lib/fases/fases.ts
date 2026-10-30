/**
 * Serviço de pipelines/fases (GAB-27). Leitura passa pelo cache em memória;
 * toda escrita invalida. Permissão (GESTOR+) é do chamador (`exigirPapel`).
 *
 * Concorrência: toda transação de escrita começa com `travarPipeline` — um
 * `SELECT … FOR UPDATE` na linha do pipeline — para que checagem de terminais,
 * cálculo de `ordem`, reordenação (read-modify-write) e migração de cards
 * sejam serializadas por quadro.
 */
import type { Fase, Prisma, TipoTerminal } from "@prisma/client";
import { db } from "@/lib/db";
import { cachePipelines, invalidarCachePipelines } from "./cache";
import {
  chaveDeNome,
  inserirComChaveUnica,
  validarCor,
  validarRemocao,
  validarReordenacao,
  validarMudancaTerminal,
  validarTerminais,
  type AcaoRemocao,
  type ErroFase,
} from "./regras";
import { ordemDeMarcosValida } from "./marcos";
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

/**
 * Lock por quadro. Segura até o fim da transação; quem chega depois espera.
 *
 * GAB-29 (criar/mover card): tome ESTE mesmo lock na transação e, dentro dela,
 * releia a fase destino e recuse se `arquivadaEm != null` ou se
 * `fase.pipelineId != projeto.pipelineId`. Sem isso, um card pode cair
 * numa fase que acabou de ser arquivada aqui (a contagem pós-migração abaixo
 * só pega o caso, não o evita). Ordene fases por (ordem, criadoEm); nunca
 * assuma `ordem == índice`.
 */
export async function travarPipeline(tx: Tx, pipelineId: string): Promise<boolean> {
  const linhas = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM pipeline WHERE id = ${pipelineId} FOR UPDATE`;
  return linhas.length > 0;
}

/**
 * Trava VÁRIOS pipelines na mesma transação, sempre em ordem crescente de id
 * (e cada um uma vez). Ordem fixa = duas operações que cruzam quadros
 * (ex.: ganho em vendas criando card em projetos × algo que pegue projetos e
 * vendas) nunca se travam mutuamente. Quem precisa de mais de um quadro usa
 * SÓ isto, tudo de uma vez, no início da transação — nunca `travarPipeline`
 * avulso depois. `false` se algum id não existe.
 */
export async function travarPipelines(tx: Tx, pipelineIds: Iterable<string>): Promise<boolean> {
  const ids = [...new Set(pipelineIds)].sort();
  let todos = true;
  for (const id of ids) {
    if (!(await travarPipeline(tx, id))) todos = false;
  }
  return todos;
}

async function carregarPipelines(): Promise<PipelineComFases[]> {
  return db.pipeline.findMany({
    orderBy: { ordem: "asc" },
    include: { fases: { orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }] } },
  });
}

/**
 * Pipelines com fases ativas (ordenadas). `incluirArquivadas` só para Gestão.
 * Devolve CÓPIAS: quem chama pode mexer à vontade sem contaminar o cache.
 */
export async function listarPipelines(opts: { incluirArquivadas?: boolean } = {}): Promise<PipelineComFases[]> {
  const lista = structuredClone(await cachePipelines.obter(carregarPipelines));
  if (opts.incluirArquivadas) return lista;
  return lista.map((p) => ({ ...p, fases: p.fases.filter((f) => f.arquivadaEm === null) }));
}

export type FaseComUso = Fase & { uso: { cards: number; transicoes: number } };
export type PipelineParaGestao = Omit<PipelineComFases, "fases"> & { fases: FaseComUso[] };

/**
 * Para a tela de Gestão: tudo (inclusive arquivadas) + uso real, que NÃO é
 * cacheado. `cards` conta só cards vivos (`deletadoEm = null`).
 */
export async function listarPipelinesParaGestao(): Promise<PipelineParaGestao[]> {
  const [lista, cards, de, para] = await Promise.all([
    listarPipelines({ incluirArquivadas: true }),
    db.projeto.groupBy({ by: ["faseId"], where: { deletadoEm: null }, _count: { _all: true } }),
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

async function faseParaLock(tx: Tx, faseId: string): Promise<string> {
  const f = await tx.fase.findUnique({ where: { id: faseId }, select: { pipelineId: true } });
  if (!f) throw new ErroDeRegra("FASE_NAO_ENCONTRADA");
  await travarPipeline(tx, f.pipelineId); // pipelineId de uma fase nunca muda: ler antes do lock é seguro
  return f.pipelineId;
}

function traduzir<T>(e: unknown): Resultado<T> {
  if (e instanceof ErroDeRegra) return { ok: false, erro: e.erro };
  throw e;
}

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

  // Chaves lidas fora do lock: uma corrida com escritor externo vira P2002, e
  // `inserirComChaveUnica` tenta de novo (nova transação) com o próximo sufixo.
  const pipeline = await db.pipeline.findUnique({ where: { id: pipelineId }, include: { fases: { select: { chave: true } } } });
  if (!pipeline) return { ok: false, erro: "PIPELINE_NAO_ENCONTRADO" };

  try {
    const f = await inserirComChaveUnica(chaveDeNome(nome), pipeline.fases.map((f) => f.chave), (chave) =>
      db.$transaction(async (tx) => {
        if (!(await travarPipeline(tx, pipelineId))) throw new ErroDeRegra("PIPELINE_NAO_ENCONTRADO");
        // Com o lock, max+1 é seguro contra criações concorrentes no mesmo quadro.
        const max = await tx.fase.aggregate({ where: { pipelineId }, _max: { ordem: true } });
        return tx.fase.create({
          data: { pipelineId, chave, nome, ordem: (max._max.ordem ?? -1) + 1, cor, limiteDiasAlerta: limite, ...terminal(dados.tipoTerminal ?? null) },
          select: { id: true },
        });
      }),
    );
    invalidarCachePipelines();
    return { ok: true, faseId: f.id };
  } catch (e) {
    return traduzir(e);
  }
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
      await faseParaLock(tx, faseId);
      const fase = await tx.fase.findUniqueOrThrow({ where: { id: faseId }, include: { pipeline: { select: { chave: true } } } });
      if (fase.arquivadaEm) throw new ErroDeRegra("FASE_ARQUIVADA");
      if (dados.tipoTerminal !== undefined && dados.tipoTerminal !== fase.tipoTerminal) {
        if (fase.marco) throw new ErroDeRegra("MARCO_FIXO");
        // Contado sob o lock do quadro: criar/mover card toma o mesmo lock.
        const qtdCards = await tx.projeto.count({ where: { faseId, deletadoEm: null } });
        const erroCards = validarMudancaTerminal({ de: fase.tipoTerminal, para: dados.tipoTerminal, qtdCards });
        if (erroCards) throw new ErroDeRegra(erroCards);
        const ativas = await tx.fase.findMany({ where: { pipelineId: fase.pipelineId, arquivadaEm: null }, select: { id: true, tipoTerminal: true } });
        const simuladas = ativas.map((f) => (f.id === faseId ? { tipoTerminal: dados.tipoTerminal! } : f));
        const erro = validarTerminais(fase.pipeline.chave, simuladas);
        if (erro) throw new ErroDeRegra(erro);
        Object.assign(patch, terminal(dados.tipoTerminal));
      }
      await tx.fase.update({ where: { id: faseId }, data: patch });
    });
  } catch (e) {
    return traduzir(e);
  }
  invalidarCachePipelines();
  return { ok: true };
}

/** Pressupõe o lock do pipeline já tomado na transação. */
async function aplicarOrdem(tx: Tx, pipelineId: string, faseIds: string[]) {
  const ativas = await tx.fase.findMany({ where: { pipelineId, arquivadaEm: null }, select: { id: true, marco: true }, orderBy: { ordem: "asc" } });
  if (!validarReordenacao(ativas.map((f) => f.id), faseIds)) throw new ErroDeRegra("ORDEM_INVALIDA");
  const marcoDe = new Map(ativas.map((f) => [f.id, f.marco]));
  if (!ordemDeMarcosValida(faseIds.map((id) => ({ marco: marcoDe.get(id) ?? null })))) throw new ErroDeRegra("ORDEM_MARCOS");
  for (const [ordem, id] of faseIds.entries()) {
    await tx.fase.update({ where: { id }, data: { ordem } });
  }
}

/** Persiste `ordem` 0..n-1 na sequência dada (precisa ser permutação das ativas). */
export async function reordenarFases(pipelineId: string, faseIds: string[]): Promise<Resultado> {
  try {
    await db.$transaction(async (tx) => {
      if (!(await travarPipeline(tx, pipelineId))) throw new ErroDeRegra("PIPELINE_NAO_ENCONTRADO");
      await aplicarOrdem(tx, pipelineId, faseIds);
    });
  } catch (e) {
    return traduzir(e);
  }
  invalidarCachePipelines();
  return { ok: true };
}

/** Botões subir/descer: troca com a vizinha; nas pontas é no-op. */
export async function moverFase(faseId: string, direcao: "SUBIR" | "DESCER"): Promise<Resultado> {
  try {
    await db.$transaction(async (tx) => {
      const pipelineId = await faseParaLock(tx, faseId);
      const ativas = await tx.fase.findMany({
        where: { pipelineId, arquivadaEm: null },
        select: { id: true },
        orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }],
      });
      const ids = ativas.map((f) => f.id);
      const i = ids.indexOf(faseId);
      if (i < 0) throw new ErroDeRegra("FASE_ARQUIVADA");
      const j = direcao === "SUBIR" ? i - 1 : i + 1;
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      await aplicarOrdem(tx, pipelineId, ids);
    });
  } catch (e) {
    return traduzir(e);
  }
  invalidarCachePipelines();
  return { ok: true };
}

/**
 * Remove uma fase. Com cards vivos, exige `destinoFaseId`: os cards migram
 * (`fase_desde = now`) com TransicaoFase origem SISTEMA + Timeline MOVIMENTACAO,
 * e a fase é arquivada. Sem cards e sem histórico, apaga de verdade. Cards
 * soft-deletados ficam onde estão (ver `validarRemocao`).
 */
export async function removerFase(
  faseId: string,
  opts: { destinoFaseId?: string | null },
  por: { id: string },
): Promise<Resultado<{ acao: AcaoRemocao }>> {
  try {
    const acao = await db.$transaction(async (tx) => {
      await faseParaLock(tx, faseId);
      const fase = await tx.fase.findUniqueOrThrow({ where: { id: faseId }, include: { pipeline: { select: { chave: true } } } });
      if (fase.arquivadaEm) throw new ErroDeRegra("FASE_ARQUIVADA");
      if (fase.marco) throw new ErroDeRegra("MARCO_FIXO");

      const ativas = await tx.fase.findMany({ where: { pipelineId: fase.pipelineId, arquivadaEm: null }, select: { id: true, tipoTerminal: true } });
      const erroTerminal = validarTerminais(fase.pipeline.chave, ativas.filter((f) => f.id !== faseId));
      if (erroTerminal) throw new ErroDeRegra(erroTerminal);

      // Tudo lido DEPOIS do lock, inclusive o destino (pode ter sido arquivado).
      const [qtdCards, qtdCardsDeletados, qtdTransicoes, destino] = await Promise.all([
        tx.projeto.count({ where: { faseId, deletadoEm: null } }),
        tx.projeto.count({ where: { faseId, deletadoEm: { not: null } } }),
        tx.transicaoFase.count({ where: { OR: [{ deFaseId: faseId }, { paraFaseId: faseId }] } }),
        opts.destinoFaseId
          ? tx.fase.findUnique({ where: { id: opts.destinoFaseId }, select: { id: true, pipelineId: true, arquivadaEm: true, tipoTerminal: true } })
          : null,
      ]);
      const decisao = validarRemocao({ fase, qtdCards, qtdCardsDeletados, qtdTransicoes, destino: destino ?? null });
      if (!decisao.ok) throw new ErroDeRegra(decisao.erro);

      if (qtdCards > 0 && destino) {
        const agora = new Date();
        const cards = await tx.projeto.findMany({ where: { faseId, deletadoEm: null }, select: { id: true } });
        const motivo = decisao.acao === "EXCLUIR" ? "fase_removida" : "fase_arquivada";
        await tx.transicaoFase.createMany({
          data: cards.map((c) => ({ projetoId: c.id, deFaseId: faseId, paraFaseId: destino.id, origem: "SISTEMA" as const, usuarioId: por.id, em: agora })),
        });
        await tx.timeline.createMany({
          data: cards.map((c) => ({
            projetoId: c.id,
            tipo: "MOVIMENTACAO" as const,
            payload: { deFaseId: faseId, paraFaseId: destino.id, motivo },
            usuarioId: por.id,
            em: agora,
          })),
        });
        await tx.projeto.updateMany({ where: { faseId, deletadoEm: null }, data: { faseId: destino.id, faseDesde: agora } });
        // Escritor que não tomou o lock pode ter criado card no meio: não arquiva com card vivo dentro.
        if ((await tx.projeto.count({ where: { faseId, deletadoEm: null } })) > 0) throw new ErroDeRegra("FASE_EM_USO");
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

/**
 * Reativa uma fase arquivada, no fim do quadro. A chave não muda (continuou
 * reservada enquanto arquivada), então não há P2002 possível aqui.
 */
export async function desarquivarFase(faseId: string): Promise<Resultado> {
  try {
    await db.$transaction(async (tx) => {
      const pipelineId = await faseParaLock(tx, faseId);
      const fase = await tx.fase.findUniqueOrThrow({ where: { id: faseId }, select: { arquivadaEm: true } });
      if (!fase.arquivadaEm) return;
      const max = await tx.fase.aggregate({ where: { pipelineId, arquivadaEm: null }, _max: { ordem: true } });
      await tx.fase.update({ where: { id: faseId }, data: { arquivadaEm: null, ordem: (max._max.ordem ?? -1) + 1 } });
    });
  } catch (e) {
    return traduzir(e);
  }
  invalidarCachePipelines();
  return { ok: true };
}

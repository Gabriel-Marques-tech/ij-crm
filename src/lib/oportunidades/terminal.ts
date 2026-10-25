/**
 * Ganchos de fase terminal (GANHO/PERDIDO), GAB-32. Cards NÃO nascem em fase
 * terminal (`criarCard` recusa com FASE_TERMINAL): toda entrada e saída de
 * terminal passa por `moverCard`, que chama estes ganchos DENTRO da própria
 * transação (TransicaoFase + Timeline MOVIMENTACAO já gravadas). Lançar
 * `ErroDeRegra` aqui desfaz o movimento inteiro.
 *
 * Entrar:
 * - PERDIDO (qualquer quadro) → `motivo_perda` obrigatório (lista curta).
 * - GANHO em `vendas` → `data_ganho` = agora, `valor_fechado` opcional e o card
 *   de projeto (§4.2): fase `em_execucao` (pela chave), mesmo título,
 *   responsável, empresa/contato, `origem_oportunidade_id` = a venda. No
 *   máximo UM por venda, para sempre: `origem_oportunidade_id` é único no
 *   banco; re-ganho (ou ganho com projeto soft-deletado) só registra o vínculo.
 * - GANHO em outro quadro (ex.: "Finalizado" em projetos) → nada além do movimento.
 * Sair (reabrir, ou ganho ↔ perdido): limpa os campos do terminal de origem
 * (`data_ganho`/`valor_fechado` ou `motivo_perda`), que descrevem o estado
 * ATUAL; o valor antigo fica na Timeline (`CAMPO_ALTERADO`). O projeto criado
 * por um ganho anterior continua existindo.
 *
 * LOCKS: quando o gancho roda, `moverCard` já travou (via `travarPipelines`,
 * ordem crescente de id) o quadro do card + todos os quadros devolvidos por
 * `pipelinesExtrasDoTerminal`. O gancho NÃO pode tomar nenhum outro lock de
 * pipeline (nem `travarPipeline`/`travarPipelines` de novo): se precisar
 * escrever em outro quadro, inclua a chave dele em `pipelinesExtrasDoTerminal`.
 * Lock tomado fora dessa ordem abre caminho para deadlock entre operações
 * que cruzam quadros. Sair de terminal não escreve em outro quadro.
 */
import type { Fase, Prisma, TipoTerminal } from "@prisma/client";
import { ErroDeRegra } from "./erros";
import { FASE_INICIAL_PROJETOS, PIPELINE_PROJETOS, PIPELINE_VENDAS, interpretarGanho, interpretarPerda } from "./terminal-regras";

type Tx = Prisma.TransactionClient;

type Base = {
  tx: Tx;
  oportunidadeId: string;
  pipelineChave: string;
  porUsuarioId: string;
  /** Instante do movimento (fase_desde, TransicaoFase). */
  em: Date;
  /** Próximo `em` da Timeline, estritamente crescente depois da MOVIMENTACAO. */
  instante: () => Date;
};

export type ContextoTerminal = Base & {
  deFaseId: string;
  destino: Fase;
  /** Dados do diálogo (strings cruas); validados aqui, não confiar no cliente. */
  dados?: unknown;
};

export type ContextoSaidaTerminal = Base & { origem: Fase };

/**
 * Chaves dos quadros (além do próprio) que o gancho escreve ao entrar num
 * terminal do tipo dado. `moverCard` trava todos antes de começar.
 * Ganho em vendas → projetos (cria o card de projeto lá).
 */
export function pipelinesExtrasDoTerminal(pipelineChave: string, tipo: TipoTerminal | null): string[] {
  if (pipelineChave === PIPELINE_VENDAS && tipo === "GANHO") return [PIPELINE_PROJETOS];
  return [];
}

/**
 * P2002 no índice único `origem_oportunidade_id`: alguém ligou um projeto à
 * venda no meio do ganho. `moverCard` refaz o movimento (idempotente).
 */
export function ehConflitoDeProjetoDaVenda(e: unknown): boolean {
  const err = e as { code?: string; meta?: { target?: unknown } };
  if (err?.code !== "P2002") return false;
  const alvo = err.meta?.target;
  const nomes = Array.isArray(alvo) ? alvo.map(String) : typeof alvo === "string" ? [alvo] : [];
  return nomes.some((n) => n.includes("origem_oportunidade_id") || n.includes("origemOportunidadeId"));
}

type CampoTerminal = "valorFechado" | "dataGanho" | "motivoPerda";
type Valor = string | null;

function serializar(v: { toFixed(n: number): string } | Date | string | null): Valor {
  if (v === null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return v;
  return v.toFixed(2);
}

/** Grava os campos que mudaram, cada um com `CAMPO_ALTERADO { campo, antes, depois }`, na ordem dada. */
async function gravarCampos(ctx: Base, novos: [CampoTerminal, string | Date | null][]) {
  const atual = await ctx.tx.oportunidade.findUniqueOrThrow({
    where: { id: ctx.oportunidadeId },
    select: { valorFechado: true, dataGanho: true, motivoPerda: true },
  });
  const mudancas = novos
    .map(([campo, valor]) => ({ campo, valor, antes: serializar(atual[campo]), depois: serializar(valor) }))
    .filter((m) => m.antes !== m.depois);
  if (mudancas.length === 0) return;
  await ctx.tx.oportunidade.update({
    where: { id: ctx.oportunidadeId },
    data: Object.fromEntries(mudancas.map((m) => [m.campo, m.valor])),
  });
  for (const m of mudancas) {
    await ctx.tx.timeline.create({
      data: {
        oportunidadeId: ctx.oportunidadeId,
        tipo: "CAMPO_ALTERADO",
        payload: { campo: m.campo, antes: m.antes, depois: m.depois },
        usuarioId: ctx.porUsuarioId,
        em: ctx.instante(),
      },
    });
  }
}

export async function aoSairDeTerminal(ctx: ContextoSaidaTerminal): Promise<void> {
  if (ctx.origem.tipoTerminal === "GANHO") {
    await gravarCampos(ctx, [
      ["valorFechado", null],
      ["dataGanho", null],
    ]);
  } else if (ctx.origem.tipoTerminal === "PERDIDO") {
    await gravarCampos(ctx, [["motivoPerda", null]]);
  }
}

export async function aoEntrarEmTerminal(ctx: ContextoTerminal): Promise<void> {
  if (ctx.destino.tipoTerminal === "PERDIDO") {
    const r = interpretarPerda(ctx.dados);
    if (!r.ok) throw new ErroDeRegra(r.erro);
    await gravarCampos(ctx, [["motivoPerda", r.motivoPerda]]);
    return;
  }
  if (ctx.destino.tipoTerminal === "GANHO" && ctx.pipelineChave === PIPELINE_VENDAS) {
    const r = interpretarGanho(ctx.dados);
    if (!r.ok) throw new ErroDeRegra(r.erro);
    await gravarCampos(ctx, [
      ["valorFechado", r.valorFechado],
      ["dataGanho", ctx.em],
    ]);
    await garantirProjeto(ctx);
  }
}

/** Cria o card de projeto da venda, ou só registra o vínculo se ele já existe. */
async function garantirProjeto(ctx: ContextoTerminal) {
  const { tx } = ctx;
  const vendaId = ctx.oportunidadeId;
  // Inclui soft-deletado: a unicidade no banco também inclui.
  const existente = await tx.oportunidade.findUnique({ where: { origemOportunidadeId: vendaId }, select: { id: true } });
  if (existente) {
    await tx.timeline.create({
      data: { oportunidadeId: vendaId, tipo: "VINCULO_PROJETO", payload: { projetoId: existente.id, criado: false }, usuarioId: ctx.porUsuarioId, em: ctx.instante() },
    });
    await tx.timeline.create({
      data: { oportunidadeId: existente.id, tipo: "VINCULO_PROJETO", payload: { vendaId, criado: false }, usuarioId: ctx.porUsuarioId, em: ctx.em },
    });
    return;
  }

  // Projetos já está travado por `moverCard` (pipelinesExtrasDoTerminal): ler a fase aqui é seguro.
  const pipeline = await tx.pipeline.findUnique({ where: { chave: PIPELINE_PROJETOS }, select: { id: true } });
  const inicial = pipeline
    ? await tx.fase.findUnique({ where: { pipelineId_chave: { pipelineId: pipeline.id, chave: FASE_INICIAL_PROJETOS } } })
    : null;
  if (!inicial || inicial.arquivadaEm || inicial.isTerminal) throw new ErroDeRegra("FASE_INICIAL_PROJETOS_INDISPONIVEL");

  const venda = await tx.oportunidade.findUniqueOrThrow({
    where: { id: vendaId },
    select: { titulo: true, responsavelId: true, empresaId: true, contatoId: true, cidade: true, estado: true },
  });
  const projeto = await tx.oportunidade.create({
    data: {
      ...venda,
      pipelineId: inicial.pipelineId,
      faseId: inicial.id,
      // O enum CriadoVia não tem SISTEMA (§4.2): nasceu de uma ação na UI; a
      // origem automática fica em `origem_oportunidade_id` e na TransicaoFase.
      criadoVia: "UI",
      origemOportunidadeId: vendaId,
      faseDesde: ctx.em,
      criadoEm: ctx.em,
    },
    select: { id: true },
  });
  await tx.transicaoFase.create({
    data: { oportunidadeId: projeto.id, deFaseId: null, paraFaseId: inicial.id, usuarioId: ctx.porUsuarioId, origem: "SISTEMA", em: ctx.em },
  });
  await tx.timeline.create({
    data: {
      oportunidadeId: projeto.id,
      tipo: "CRIACAO",
      payload: { faseId: inicial.id, via: "GANHO", origemOportunidadeId: vendaId },
      usuarioId: ctx.porUsuarioId,
      em: ctx.em,
    },
  });
  await tx.timeline.create({
    data: { oportunidadeId: vendaId, tipo: "VINCULO_PROJETO", payload: { projetoId: projeto.id, criado: true }, usuarioId: ctx.porUsuarioId, em: ctx.instante() },
  });
}

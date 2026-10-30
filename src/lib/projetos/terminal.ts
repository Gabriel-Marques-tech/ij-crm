/**
 * Ganchos de fase terminal (GANHO/PERDIDO), GAB-32 + ciclo único (GAB-81).
 * Cards NÃO nascem em fase terminal (`criarCard` recusa com FASE_TERMINAL):
 * toda entrada em terminal passa por `registrarMovimento` (moverCard, WhatsApp,
 * import), que chama `aoEntrarEmTerminal` DENTRO da própria transação
 * (TransicaoFase + Timeline MOVIMENTACAO já gravadas). Lançar `ErroDeRegra`
 * aqui desfaz o movimento inteiro.
 *
 * Entrar:
 * - PERDIDO (qualquer quadro) → `motivo_perda` obrigatório (lista curta).
 * - GANHO em `vendas` (= contrato assinado) → `data_ganho` = agora,
 *   `valor_fechado` opcional e o MESMO card segue para o marco Handoff, 1ª
 *   coluna do quadro Projetos (spec fase 2 §4.2/§4.8): pipeline/fase/fase_desde
 *   mudam, com TransicaoFase Ganho → Handoff (origem SISTEMA) e MOVIMENTACAO
 *   `motivo: "ganho_handoff"`. Não existe mais segundo card (era o
 *   `garantirCardProjetos` da v1). Assim o card fica em exatamente um quadro e o
 *   Ganho de Vendas é só a porta de saída (coluna normalmente vazia; só cards
 *   migrados cujo projeto foi apagado na v1 ficam parados nela).
 * - GANHO em outro quadro (ex.: "Finalizado" em projetos) → nada além do movimento.
 * Sair (reabrir, ou ganho ↔ perdido): MANTÉM `data_ganho`/`valor_fechado` e
 * `motivo_perda` (último fechamento; re-ganho sobrescreve a data, o diálogo
 * vem pré-preenchido).
 *
 * LOCKS: quando o gancho roda, o chamador já travou (via `travarPipelines`,
 * ordem crescente de id) o quadro do card + todos os quadros devolvidos por
 * `pipelinesExtrasDoTerminal`. O gancho NÃO pode tomar nenhum outro lock de
 * pipeline (nem `travarPipeline`/`travarPipelines` de novo): se precisar
 * escrever em outro quadro, inclua a chave dele em `pipelinesExtrasDoTerminal`.
 * Lock tomado fora dessa ordem abre caminho para deadlock entre operações
 * que cruzam quadros.
 */
import type { Fase, Prisma, TipoTerminal } from "@prisma/client";
import { ErroDeRegra } from "./erros";
import { PIPELINE_PROJETOS, PIPELINE_VENDAS, interpretarGanho, interpretarPerda } from "./terminal-regras";

type Tx = Prisma.TransactionClient;

type Base = {
  tx: Tx;
  projetoId: string;
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

/**
 * Chaves dos quadros (além do próprio) que o gancho escreve ao entrar num
 * terminal do tipo dado. `moverCard` trava todos antes de começar.
 * Ganho em vendas → projetos (o card segue para o Handoff de lá).
 */
export function pipelinesExtrasDoTerminal(pipelineChave: string, tipo: TipoTerminal | null): string[] {
  if (pipelineChave === PIPELINE_VENDAS && tipo === "GANHO") return [PIPELINE_PROJETOS];
  return [];
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
  const atual = await ctx.tx.projeto.findUniqueOrThrow({
    where: { id: ctx.projetoId },
    select: { valorFechado: true, dataGanho: true, motivoPerda: true },
  });
  const mudancas = novos
    .map(([campo, valor]) => ({ campo, valor, antes: serializar(atual[campo]), depois: serializar(valor) }))
    .filter((m) => m.antes !== m.depois);
  if (mudancas.length === 0) return;
  await ctx.tx.projeto.update({
    where: { id: ctx.projetoId },
    data: Object.fromEntries(mudancas.map((m) => [m.campo, m.valor])),
  });
  for (const m of mudancas) {
    await ctx.tx.timeline.create({
      data: {
        projetoId: ctx.projetoId,
        tipo: "CAMPO_ALTERADO",
        payload: { campo: m.campo, antes: m.antes, depois: m.depois },
        usuarioId: ctx.porUsuarioId,
        em: ctx.instante(),
      },
    });
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
    await seguirParaHandoff(ctx);
  }
}

/** Ganho em Vendas: o mesmo card vai para o marco Handoff (quadro Projetos, já travado pelo chamador). */
async function seguirParaHandoff(ctx: ContextoTerminal) {
  const { tx } = ctx;
  const handoff = await tx.fase.findUnique({ where: { marco: "HANDOFF" } });
  if (!handoff || handoff.arquivadaEm || handoff.isTerminal) throw new ErroDeRegra("FASE_HANDOFF_INDISPONIVEL");
  const em = ctx.instante();
  await tx.projeto.update({ where: { id: ctx.projetoId }, data: { pipelineId: handoff.pipelineId, faseId: handoff.id, faseDesde: em } });
  await tx.transicaoFase.create({
    data: { projetoId: ctx.projetoId, deFaseId: ctx.destino.id, paraFaseId: handoff.id, usuarioId: ctx.porUsuarioId, origem: "SISTEMA", em },
  });
  await tx.timeline.create({
    data: {
      projetoId: ctx.projetoId,
      tipo: "MOVIMENTACAO",
      payload: { deFaseId: ctx.destino.id, paraFaseId: handoff.id, motivo: "ganho_handoff" },
      usuarioId: ctx.porUsuarioId,
      em,
    },
  });
}

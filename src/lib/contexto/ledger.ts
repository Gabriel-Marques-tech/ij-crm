/**
 * Ledger de 12 h do remetente (GAB-49): as mensagens de VENDA que ele mandou
 * numa janela (`janela.ts`). Não há tabela nova — é derivado de
 * `mensagem_bruta` (remetente + `recebida_em` na janela, índice
 * `[remetente_usuario_id, recebida_em]`). O que entra:
 * - com `#crm`: sempre (o vendedor marcou como venda), com a situação quando
 *   não foi processada ("pendente de revisão", "falhou", "em processamento");
 * - sem tag: SÓ `PROCESSADA` (o classificador achou relevante E a extração
 *   aplicou). Sem tag `RECEBIDA`/`PROCESSANDO`/`PENDENTE_REVISAO`/`FALHA` e
 *   `CLASSIFICADA_IRRELEVANTE` ficam fora; conversa que o classificador
 *   descartou nunca vira linha, e sem tag que a extração disse IGNORAR é
 *   apagada — linha apagada não existe para o ledger.
 * - o texto segue a retenção da `mensagem_bruta` (GAB-41: o texto `#crm` fica,
 *   o JSON da LLM some em 90 dias, sem tag não confirmada some em 30) — nada é
 *   duplicado;
 * - o card de cada mensagem vem da Timeline `MENSAGEM_WHATSAPP` que ela gerou
 *   (só card vivo em vendas).
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { EntradaHistorico, SituacaoHistorico } from "@/lib/llm/prompts/extracao.v2";
import { PIPELINE_VENDAS } from "@/lib/oportunidades/terminal-regras";
import type { Janela } from "./janela";

type Cliente = Prisma.TransactionClient | typeof db;

/** Teto de linhas lidas por janela (o prompt ainda corta por caracteres). */
export const MAX_LEDGER = 60;
/** Cards da janela que entram como candidatas (`via: ledger`). */
export const MAX_CARDS_LEDGER = 5;

export type EntradaLedger = EntradaHistorico & { id: string };

type Recorte = { usuarioId: string; janela: Janela; ate?: Date; excluirId?: string };

/** Mensagens do ledger: `ate` (inclusivo) + `excluirId` = o ledger "antes" de uma mensagem. */
function filtroLedger(e: Recorte): Prisma.MensagemBrutaWhereInput {
  return {
    remetenteUsuarioId: e.usuarioId,
    recebidaEm: e.ate ? { gte: e.janela.inicio, lte: e.ate } : { gte: e.janela.inicio, lt: e.janela.fim },
    OR: [{ semTag: false, status: { not: "CLASSIFICADA_IRRELEVANTE" } }, { semTag: true, status: "PROCESSADA" }],
    ...(e.excluirId ? { id: { not: e.excluirId } } : {}),
  };
}

const CARD_VIVO_EM_VENDAS = { deletadoEm: null, pipeline: { chave: PIPELINE_VENDAS } } as const;

const SITUACAO: Partial<Record<string, SituacaoHistorico>> = {
  RECEBIDA: "em processamento",
  PROCESSANDO: "em processamento",
  PENDENTE_REVISAO: "pendente de revisão",
  FALHA: "falhou",
};

/** Mensagens de venda do remetente na janela, da mais recente para a mais antiga (até `MAX_LEDGER`). */
export async function ledgerDaJanela(e: Recorte, cliente: Cliente = db): Promise<EntradaLedger[]> {
  const linhas = await cliente.mensagemBruta.findMany({
    where: filtroLedger(e),
    orderBy: [{ recebidaEm: "desc" }, { id: "desc" }],
    take: MAX_LEDGER,
    select: {
      id: true,
      texto: true,
      recebidaEm: true,
      status: true,
      timeline: {
        where: { tipo: "MENSAGEM_WHATSAPP", oportunidade: CARD_VIVO_EM_VENDAS },
        orderBy: { em: "desc" },
        take: 1,
        select: { oportunidade: { select: { id: true, titulo: true } } },
      },
    },
  });
  return linhas.map((l) => ({ id: l.id, em: l.recebidaEm, texto: l.texto, card: l.timeline[0]?.oportunidade ?? null, situacao: SITUACAO[l.status] ?? null }));
}

/**
 * Cards distintos que as mensagens do ledger mexeram na janela, do mais
 * recente — consulta PRÓPRIA (não o ledger cortado em `MAX_LEDGER`): a regra
 * do ✅ do "único card" depende de saber se houve outro card na janela.
 */
export async function cardsDaJanela(e: Recorte, max = MAX_CARDS_LEDGER, cliente: Cliente = db): Promise<string[]> {
  const toques = await cliente.timeline.findMany({
    where: { tipo: "MENSAGEM_WHATSAPP", oportunidade: CARD_VIVO_EM_VENDAS, mensagemBruta: filtroLedger(e) },
    orderBy: [{ em: "desc" }, { id: "desc" }],
    distinct: ["oportunidadeId"],
    take: max,
    select: { oportunidadeId: true },
  });
  return toques.map((t) => t.oportunidadeId);
}

/** Cards distintos mexidos num ledger já lido, do mais recente (para o resumo). */
export function cardsDoLedger(ledger: EntradaLedger[], max = MAX_CARDS_LEDGER): string[] {
  const ids: string[] = [];
  for (const l of ledger) if (l.card && !ids.includes(l.card.id)) ids.push(l.card.id);
  return ids.slice(0, max);
}

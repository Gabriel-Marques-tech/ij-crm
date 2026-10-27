/**
 * Ledger de 12 h do remetente (GAB-49): as mensagens de VENDA que ele mandou
 * numa janela (`janela.ts`). Não há tabela nova — é derivado de
 * `mensagem_bruta` (remetente + `recebida_em` na janela, índice
 * `[remetente_usuario_id, recebida_em]`):
 * - só entra o que já vira `MensagemBruta`: `#crm` e sem tag que o
 *   classificador achou relevante. Conversa descartada nunca é gravada (ou é
 *   apagada, `DESCARTADA`) e `CLASSIFICADA_IRRELEVANTE` é filtrada aqui;
 * - o texto segue a retenção de 90 dias da `mensagem_bruta` (GAB-41) — nada é
 *   duplicado;
 * - o card de cada mensagem vem da Timeline `MENSAGEM_WHATSAPP` que ela gerou
 *   (só card vivo em vendas).
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { EntradaHistorico } from "@/lib/llm/prompts/extracao.v2";
import { PIPELINE_VENDAS } from "@/lib/oportunidades/terminal-regras";
import type { Janela } from "./janela";

type Cliente = Prisma.TransactionClient | typeof db;

/** Teto de linhas lidas por janela (o prompt ainda corta por caracteres). */
export const MAX_LEDGER = 60;
/** Cards do ledger que entram como candidatas (`via: ledger`). */
export const MAX_CARDS_LEDGER = 5;

export type EntradaLedger = EntradaHistorico & { id: string };

/**
 * Mensagens de venda do remetente na janela, da mais recente para a mais
 * antiga. `ate` (inclusivo) + `excluirId`: o ledger "antes" de uma mensagem.
 */
export async function ledgerDaJanela(
  e: { usuarioId: string; janela: Janela; ate?: Date; excluirId?: string },
  cliente: Cliente = db,
): Promise<EntradaLedger[]> {
  const linhas = await cliente.mensagemBruta.findMany({
    where: {
      remetenteUsuarioId: e.usuarioId,
      recebidaEm: e.ate ? { gte: e.janela.inicio, lte: e.ate } : { gte: e.janela.inicio, lt: e.janela.fim },
      status: { not: "CLASSIFICADA_IRRELEVANTE" },
      ...(e.excluirId ? { id: { not: e.excluirId } } : {}),
    },
    orderBy: [{ recebidaEm: "desc" }, { id: "desc" }],
    take: MAX_LEDGER,
    select: {
      id: true,
      texto: true,
      recebidaEm: true,
      timeline: {
        where: { tipo: "MENSAGEM_WHATSAPP", oportunidade: { deletadoEm: null, pipeline: { chave: PIPELINE_VENDAS } } },
        orderBy: { em: "desc" },
        take: 1,
        select: { oportunidade: { select: { id: true, titulo: true } } },
      },
    },
  });
  return linhas.map((l) => ({ id: l.id, em: l.recebidaEm, texto: l.texto, card: l.timeline[0]?.oportunidade ?? null }));
}

/** Cards distintos mexidos no ledger, do mais recente. */
export function cardsDoLedger(ledger: EntradaLedger[], max = MAX_CARDS_LEDGER): string[] {
  const ids: string[] = [];
  for (const l of ledger) if (l.card && !ids.includes(l.card.id)) ids.push(l.card.id);
  return ids.slice(0, max);
}

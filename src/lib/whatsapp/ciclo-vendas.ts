/**
 * GAB-81 (ciclo único): o que o pipeline do WhatsApp enxerga do Projeto — só a
 * PARTE DE VENDAS do ciclo, equivalente ao que via na v1.
 *
 * Na v1 a venda ganha ficava parada em "Contrato assinado" (terminal) no quadro
 * Vendas e continuava candidata (fechada) para o contexto da LLM e para
 * reabertura. Agora o mesmo card segue para o quadro Projetos (Handoff); para o
 * WhatsApp ele continua sendo uma venda FECHADA no Ganho: aparece com o nome do
 * marco Ganho e `terminal: true`, nunca é atualizado/movido pelo grupo (mensagem
 * nova sobre ele reabre um card novo em Vendas, `reaberta_de_id`, como antes).
 * Cards de Projetos que nunca passaram por Vendas (sem `data_ganho`) ficam de
 * fora, como na v1.
 *
 * Proposta (marco novo do ciclo) fica FORA da lista de fases do WhatsApp: entra-se
 * nela pelo fluxo da proposta (spec §4.3/§4.4); a lista que vai no contexto da
 * LLM continua a mesma da v1.
 */
import type { Prisma } from "@prisma/client";
import { PIPELINE_PROJETOS, PIPELINE_VENDAS } from "@/lib/projetos/terminal-regras";

/** Card vivo na parte de vendas do ciclo: em Vendas, ou ganho e seguido para Projetos. */
export const CARD_VIVO_NO_CICLO_DE_VENDAS = {
  deletadoEm: null,
  OR: [{ pipeline: { chave: PIPELINE_VENDAS } }, { pipeline: { chave: PIPELINE_PROJETOS }, dataGanho: { not: null } }],
} as const satisfies Prisma.ProjetoWhereInput;

/** Só os FECHADOS da parte de vendas: terminal em Vendas, ou já em Projetos (ganho). */
export const CARD_FECHADO_NO_CICLO_DE_VENDAS = {
  deletadoEm: null,
  OR: [
    { pipeline: { chave: PIPELINE_VENDAS }, fase: { isTerminal: true } },
    { pipeline: { chave: PIPELINE_PROJETOS }, dataGanho: { not: null } },
  ],
} as const satisfies Prisma.ProjetoWhereInput;

/** Fases de Vendas que o WhatsApp usa (lista da LLM, criar, mover): todas menos o marco Proposta. */
// Explícito com `marco: null`: subfases não têm marco (comparação com NULL não pode sumir com elas).
export const FASES_DO_WHATSAPP = {
  AND: [{ OR: [{ marco: null }, { marco: { not: "PROPOSTA" } }] }],
} as const satisfies Prisma.FaseWhereInput;

/** Como o WhatsApp vê a fase de um card: em Projetos = fechado no Ganho. */
export function faseVistaPeloWhatsapp(
  card: { pipeline: { chave: string }; fase: { nome: string; isTerminal: boolean } },
  nomeGanho: string,
): { nome: string; terminal: boolean } {
  if (card.pipeline.chave === PIPELINE_VENDAS) return { nome: card.fase.nome, terminal: card.fase.isTerminal };
  return { nome: nomeGanho, terminal: true };
}

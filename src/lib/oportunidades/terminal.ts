/**
 * Gancho de entrada em fase terminal (GANHO/PERDIDO). Hoje é no-op: o Kanban
 * só pede confirmação e move.
 *
 * GAB-32 preenche aqui, DENTRO da transação do movimento (lock do pipeline já
 * tomado, TransicaoFase + Timeline já gravadas):
 * - GANHO em `vendas` → criar a Oportunidade em `projetos` com
 *   `origem_oportunidade_id`, mesma empresa/contato (design §4.2);
 * - GANHO → `data_ganho` / `valor_fechado`; PERDIDO → `motivo_perda`.
 * Para coletar `valor_fechado`/`motivo_perda` na UI, estenda `dados` e o
 * diálogo de confirmação em `quadro-kanban.tsx` (`ConfirmarTerminal`).
 * Lançar aqui aborta o movimento inteiro (rollback).
 */
import type { Fase, Prisma } from "@prisma/client";

export type ContextoTerminal = {
  tx: Prisma.TransactionClient;
  oportunidadeId: string;
  pipelineChave: string;
  deFaseId: string;
  destino: Fase;
  porUsuarioId: string;
  em: Date;
  dados?: Record<string, unknown>;
};

export async function aoEntrarEmTerminal(ctx: ContextoTerminal): Promise<void> {
  void ctx;
}

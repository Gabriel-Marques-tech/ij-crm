/**
 * Gancho de entrada em fase terminal (GANHO/PERDIDO). Hoje é no-op: o Kanban
 * só pede confirmação e move. Cards NÃO nascem em fase terminal
 * (`criarCard` recusa com FASE_TERMINAL): toda entrada em terminal passa por aqui.
 *
 * GAB-32 preenche aqui, DENTRO da transação do movimento (TransicaoFase +
 * Timeline já gravadas):
 * - GANHO em `vendas` → criar a Oportunidade em `projetos` com
 *   `origem_oportunidade_id`, mesma empresa/contato (design §4.2);
 * - GANHO → `data_ganho` / `valor_fechado`; PERDIDO → `motivo_perda`.
 * Para coletar `valor_fechado`/`motivo_perda` na UI, estenda `dados` e o
 * diálogo `ConfirmarTerminal` (src/components/kanban/confirmar-terminal.tsx).
 * Lançar aqui aborta o movimento inteiro (rollback).
 *
 * LOCKS: quando o gancho roda, `moverCard` já travou (via `travarPipelines`,
 * ordem crescente de id) o quadro do card + todos os quadros devolvidos por
 * `pipelinesExtrasDoTerminal`. O gancho NÃO pode tomar nenhum outro lock de
 * pipeline (nem `travarPipeline`/`travarPipelines` de novo): se precisar
 * escrever em outro quadro, inclua a chave dele em `pipelinesExtrasDoTerminal`.
 * Lock tomado fora dessa ordem abre caminho para deadlock entre operações
 * que cruzam quadros.
 */
import type { Fase, Prisma, TipoTerminal } from "@prisma/client";

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

/**
 * Chaves dos quadros (além do próprio) que o gancho escreve ao entrar num
 * terminal do tipo dado. `moverCard` trava todos antes de começar.
 * Ganho em vendas → projetos (o GAB-32 cria o card de projeto lá).
 */
export function pipelinesExtrasDoTerminal(pipelineChave: string, tipo: TipoTerminal | null): string[] {
  if (pipelineChave === "vendas" && tipo === "GANHO") return ["projetos"];
  return [];
}

export async function aoEntrarEmTerminal(ctx: ContextoTerminal): Promise<void> {
  void ctx;
}

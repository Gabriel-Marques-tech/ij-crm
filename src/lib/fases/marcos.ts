/**
 * Marcos do ciclo único do Projeto (GAB-81, spec fase 2 §4.2). Regras puras,
 * sem banco e sem import de valor do Prisma: roda no cliente também.
 *
 * Um Projeto vive num ciclo só: subfases livres (Gestão) entre marcos FIXOS.
 * O ciclo é mostrado em dois quadros, e o quadro de um card é o `pipeline`
 * dele — por isso ele aparece em exatamente um quadro:
 * - Vendas: [subfases] Proposta, Montando contrato, [subfases] Ganho, Perdido.
 * - Projetos: Handoff (1ª coluna), Execução, [subfases] Finalizado.
 * Entrar em Ganho leva o MESMO card para Handoff (`projetos/terminal.ts`).
 *
 * Marco: não é apagado nem arquivado, não muda de tipo terminal e não sai da
 * ordem canônica (subfases podem ir para qualquer lugar entre eles). Nome, cor
 * e limite de dias continuam editáveis; a chave nunca muda (vale para toda fase).
 */
import type { Marco, TipoTerminal } from "@prisma/client";

/** Ordem canônica do ciclo (os de Vendas, depois os de Projetos). */
export const ORDEM_MARCOS = ["PROPOSTA", "MONTANDO_CONTRATO", "GANHO", "PERDIDO", "HANDOFF", "EXECUCAO", "FINALIZADO"] as const satisfies readonly Marco[];

export const QUADRO_DO_MARCO: Record<Marco, "vendas" | "projetos"> = {
  PROPOSTA: "vendas",
  MONTANDO_CONTRATO: "vendas",
  GANHO: "vendas",
  PERDIDO: "vendas",
  HANDOFF: "projetos",
  EXECUCAO: "projetos",
  FINALIZADO: "projetos",
};

export const TIPO_DO_MARCO: Record<Marco, TipoTerminal | null> = {
  PROPOSTA: null,
  MONTANDO_CONTRATO: null,
  GANHO: "GANHO",
  PERDIDO: "PERDIDO",
  HANDOFF: null,
  EXECUCAO: null,
  FINALIZADO: "GANHO",
};

export const ROTULO_MARCO: Record<Marco, string> = {
  PROPOSTA: "Proposta",
  MONTANDO_CONTRATO: "Montando contrato",
  GANHO: "Ganho",
  PERDIDO: "Perdido",
  HANDOFF: "Handoff",
  EXECUCAO: "Execução",
  FINALIZADO: "Finalizado",
};

/**
 * A sequência de fases ATIVAS (na ordem nova) respeita os marcos? Os marcos
 * presentes têm de aparecer na ordem canônica, e Handoff, se está no quadro,
 * é a primeira coluna.
 */
export function ordemDeMarcosValida(fases: readonly { marco: Marco | null }[]): boolean {
  const indices = fases.flatMap((f) => (f.marco ? [ORDEM_MARCOS.indexOf(f.marco)] : []));
  for (let i = 1; i < indices.length; i++) if (indices[i] <= indices[i - 1]) return false;
  const iHandoff = fases.findIndex((f) => f.marco === "HANDOFF");
  return iHandoff <= 0;
}

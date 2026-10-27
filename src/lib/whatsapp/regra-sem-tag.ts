/**
 * O que fazer com a extração de uma mensagem que veio SEM `#crm` (GAB-39;
 * design doc §4.3): o classificador já disse "relevante", mas para AGIR sem
 * tag a régua é mais alta.
 *
 * - intenção IGNORAR → `DESCARTAR`: apaga a `MensagemBruta` e soma no
 *   contador do dia (design doc: "sem tag e intenção IGNORAR → descartada");
 * - confiança da extração < `LLM_LIMIAR_SEM_TAG` → `INCERTO`:
 *   `PENDENTE_REVISAO` em vez de criar/atualizar card;
 * - senão `null`: segue o fluxo normal (`aplicarExtracao`).
 */
import { limiarSemTag } from "@/lib/config/env";
import type { Extracao } from "@/lib/llm/prompts/extracao.v1";

export type RegraSemTag = "DESCARTAR" | "INCERTO" | null;

export function regraSemTag(semTag: boolean, ex: Pick<Extracao, "intencao" | "confianca">, limiar = limiarSemTag()): RegraSemTag {
  if (!semTag) return null;
  if (ex.intencao === "IGNORAR") return "DESCARTAR";
  return ex.confianca < limiar ? "INCERTO" : null;
}

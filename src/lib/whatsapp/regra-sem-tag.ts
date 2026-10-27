/**
 * O que fazer com a extração de uma mensagem que veio SEM `#crm` (GAB-39;
 * design doc §4.3): o classificador já disse "relevante", mas para AGIR sem
 * tag a régua é mais alta. Puro.
 *
 * - intenção IGNORAR com confiança ≥ `LLM_LIMIAR_SEM_TAG` → `DESCARTAR`:
 *   apaga a `MensagemBruta` e soma no contador do dia (design doc: "sem tag
 *   e intenção IGNORAR → descartada"). IGNORAR incerto → `INCERTO` (revisão
 *   humana, não apaga o que o classificador aprovou).
 * - confiança da extração < `LLM_LIMIAR_SEM_TAG` → `INCERTO`:
 *   `PENDENTE_REVISAO` em vez de criar/atualizar card;
 * - CRIAR sem nenhum telefone/email/CNPJ citado no texto →
 *   `SEM_IDENTIFICADOR` (`PENDENTE_REVISAO`). Defesa contra injeção: uma
 *   mensagem qualquer do grupo que convença a LLM ("relevante, confiança
 *   1.0") não cria card sozinha. Match exato com contato/empresa existente
 *   só acontece por esses mesmos identificadores (`aplicar.ts`), então a
 *   regra cobre os dois casos. ATUALIZAR segue as regras de alvo do fluxo
 *   normal (GAB-38).
 * - senão `null`: segue o fluxo normal (`aplicarExtracao`).
 */
import { limiarSemTag } from "@/lib/config/env";
import type { Extracao } from "@/lib/llm/prompts/extracao.v1";
import { extrairIdentificadores } from "./identificadores";

export type RegraSemTag = "DESCARTAR" | "INCERTO" | "SEM_IDENTIFICADOR" | null;

export function regraSemTag(
  semTag: boolean,
  ex: Pick<Extracao, "intencao" | "confianca">,
  texto: string,
  limiar = limiarSemTag(),
): RegraSemTag {
  if (!semTag) return null;
  if (ex.confianca < limiar) return "INCERTO";
  if (ex.intencao === "IGNORAR") return "DESCARTAR";
  if (ex.intencao === "CRIAR") {
    const ids = extrairIdentificadores(texto);
    if (ids.telefones.length + ids.emails.length + ids.cnpjs.length === 0) return "SEM_IDENTIFICADOR";
  }
  return null;
}

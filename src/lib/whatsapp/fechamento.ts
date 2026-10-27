/**
 * Ganho/perdido pedido pelo WhatsApp (GAB-38). Puro. Mesmas regras do
 * diálogo do Kanban (GAB-32): ganho em vendas grava valor fechado, perdido
 * exige motivo. Diferença: pelo WhatsApp o dado tem de VIR na mensagem — sem
 * ele o card NÃO vai para o terminal (fica `revisar`), nunca se inventa
 * valor nem motivo.
 *
 * E o dado tem de estar ANCORADO no texto da mensagem (a LLM não decide dado
 * terminal sozinha): o valor do ganho precisa ser igual a um valor em
 * dinheiro lido do próprio texto (mesmo parser, `lerValorInformal`); a perda
 * precisa de um sinal de perda no texto ("perdemos", "desistiu", "não
 * fechou"… ou o próprio motivo escrito).
 */
import type { TipoTerminal } from "@prisma/client";
import { lerValorInformal } from "@/lib/llm/valores";
import { DETALHE_PERDA_MAX, MOTIVOS_PERDA, valorParaCampo, type DadosTerminal } from "@/lib/oportunidades/terminal-regras";

export const MOTIVO_GANHO_SEM_VALOR = "venda ganha sem valor fechado na mensagem: mova pelo CRM";
export const MOTIVO_PERDA_SEM_MOTIVO = "venda perdida sem motivo na mensagem: mova pelo CRM";
export const MOTIVO_VALOR_NAO_CONFERE = "valor fechado não confere com a mensagem: mova pelo CRM";
export const MOTIVO_PERDA_NAO_CONFIRMADA = "perda não confirmada pela mensagem: mova pelo CRM";

/** Trechos com cara de dinheiro ("18k", "R$ 18.000", "1,5 milhão"); cada um passa pelo mesmo parser da LLM. */
const TRECHO_DINHEIRO = /(?:r\$\s*)?\d+(?:[.,]\d+)*(?:\s*(?:k|mil|milhao|milhoes|mi|m)(?![a-z]))?/g;
const SINAL_PERDA = /\b(?:perd(?:emos|eu|eram|i|ido|a)|nao (?:fech(?:ou|amos|aram|a|ar)|vai fechar|rolou)|desist(?:iu|iram|imos|encia)|recusou|cancelou)\b/;

/** Valores em dinheiro escritos no texto, já convertidos ("18000.00"). */
export function valoresNoTexto(texto: string): Set<string> {
  const t = comparavel(texto);
  const valores = new Set<string>();
  const todo = lerValorInformal(t);
  if (todo) valores.add(todo);
  for (const m of t.matchAll(TRECHO_DINHEIRO)) {
    const v = lerValorInformal(m[0]);
    if (v) valores.add(v);
  }
  return valores;
}

/** Corta em `max` unidades UTF-16 (a mesma unidade de `interpretarPerda`), sem partir caractere. */
function cortar(s: string, max: number): string {
  let saida = "";
  for (const ch of s) {
    if (saida.length + ch.length > max) break;
    saida += ch;
  }
  return saida.trim();
}

function comparavel(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[\s_]+/g, " ").trim();
}

export function dadosDoFechamento(
  fase: { tipoTerminal: TipoTerminal | null },
  campos: { valor_fechado: string | null; motivo_perda: string | null },
  textoMensagem: string,
): { ok: true; dados: DadosTerminal } | { ok: false; motivo: string } {
  if (fase.tipoTerminal === "GANHO") {
    const v = campos.valor_fechado ? lerValorInformal(campos.valor_fechado) : null;
    if (!v) return { ok: false, motivo: MOTIVO_GANHO_SEM_VALOR };
    if (!valoresNoTexto(textoMensagem).has(v)) return { ok: false, motivo: MOTIVO_VALOR_NAO_CONFERE };
    return { ok: true, dados: { valorFechado: valorParaCampo(v) } };
  }
  if (fase.tipoTerminal === "PERDIDO") {
    const texto = (campos.motivo_perda ?? "").replace(/\s+/g, " ").trim();
    if (!texto) return { ok: false, motivo: MOTIVO_PERDA_SEM_MOTIVO };
    const alvo = comparavel(texto);
    const mensagem = comparavel(textoMensagem);
    if (!SINAL_PERDA.test(mensagem) && !mensagem.includes(alvo)) return { ok: false, motivo: MOTIVO_PERDA_NAO_CONFIRMADA };
    const daLista = MOTIVOS_PERDA.find((m) => m.chave !== "outro" && (comparavel(m.rotulo) === alvo || comparavel(m.chave) === alvo));
    if (daLista) return { ok: true, dados: { motivo: daLista.chave } };
    return { ok: true, dados: { motivo: "outro", detalhe: cortar(texto, DETALHE_PERDA_MAX) } };
  }
  return { ok: true, dados: {} };
}

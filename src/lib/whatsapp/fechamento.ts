/**
 * Ganho/perdido pedido pelo WhatsApp (GAB-38). Puro. Mesmas regras do
 * diálogo do Kanban (GAB-32): ganho em vendas grava valor fechado, perdido
 * exige motivo. Diferença: pelo WhatsApp o dado tem de VIR na mensagem — sem
 * ele o card NÃO vai para o terminal (fica `revisar`), nunca se inventa
 * valor nem motivo.
 */
import type { TipoTerminal } from "@prisma/client";
import { lerValorInformal } from "@/lib/llm/valores";
import { DETALHE_PERDA_MAX, MOTIVOS_PERDA, valorParaCampo, type DadosTerminal } from "@/lib/oportunidades/terminal-regras";

export const MOTIVO_GANHO_SEM_VALOR = "venda ganha sem valor fechado na mensagem: mova pelo CRM";
export const MOTIVO_PERDA_SEM_MOTIVO = "venda perdida sem motivo na mensagem: mova pelo CRM";

function comparavel(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[\s_]+/g, " ").trim();
}

export function dadosDoFechamento(
  fase: { tipoTerminal: TipoTerminal | null },
  campos: { valor_fechado: string | null; motivo_perda: string | null },
): { ok: true; dados: DadosTerminal } | { ok: false; motivo: string } {
  if (fase.tipoTerminal === "GANHO") {
    const v = campos.valor_fechado ? lerValorInformal(campos.valor_fechado) : null;
    return v ? { ok: true, dados: { valorFechado: valorParaCampo(v) } } : { ok: false, motivo: MOTIVO_GANHO_SEM_VALOR };
  }
  if (fase.tipoTerminal === "PERDIDO") {
    const texto = (campos.motivo_perda ?? "").replace(/\s+/g, " ").trim();
    if (!texto) return { ok: false, motivo: MOTIVO_PERDA_SEM_MOTIVO };
    const alvo = comparavel(texto);
    const daLista = MOTIVOS_PERDA.find((m) => m.chave !== "outro" && (comparavel(m.rotulo) === alvo || comparavel(m.chave) === alvo));
    if (daLista) return { ok: true, dados: { motivo: daLista.chave } };
    return { ok: true, dados: { motivo: "outro", detalhe: [...texto].slice(0, DETALHE_PERDA_MAX).join("").trim() } };
  }
  return { ok: true, dados: {} };
}

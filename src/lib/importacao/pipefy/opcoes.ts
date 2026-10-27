/**
 * Escolhas do gestor na prévia além do mapeamento de fases (GAB-37). Entram
 * no hash da prévia: confirmar aplica exatamente o que foi visto.
 *
 * `motivoPerdaPadrao`: o import NUNCA inventa motivo de perda. Card do
 * Pipefy em fase PERDIDO sem "Motivo da perda" é pulado com erro, a menos que
 * o gestor escolha aqui um motivo para "perdidos sem motivo" — aí ele é
 * gravado com o detalhe "Motivo definido na importação por <gestor>".
 */
import { MOTIVOS_PERDA, type ChaveMotivoPerda } from "@/lib/oportunidades/terminal-regras";

export type OpcoesImport = { motivoPerdaPadrao?: ChaveMotivoPerda | null };

export function validarOpcoes(bruto: unknown): { ok: true; opcoes: OpcoesImport } | { ok: false; erro: string } {
  if (bruto === undefined || bruto === null) return { ok: true, opcoes: {} };
  if (typeof bruto !== "object" || Array.isArray(bruto)) return { ok: false, erro: "Opções do import inválidas." };
  const o = bruto as Record<string, unknown>;
  for (const k of Object.keys(o)) if (k !== "motivoPerdaPadrao") return { ok: false, erro: `Opção desconhecida: ${k}.` };
  const m = o.motivoPerdaPadrao;
  if (m === undefined || m === null || m === "") return { ok: true, opcoes: {} };
  const achado = MOTIVOS_PERDA.find((x) => x.chave === m);
  if (!achado) return { ok: false, erro: "Motivo de perda padrão inválido." };
  return { ok: true, opcoes: { motivoPerdaPadrao: achado.chave } };
}

/** Forma canônica (hash): só o que tem valor, chaves ordenadas. */
export function opcoesCanonicas(o: OpcoesImport): string {
  return JSON.stringify(o.motivoPerdaPadrao ? [["motivoPerdaPadrao", o.motivoPerdaPadrao]] : []);
}

export function detalhePerdaPadrao(gestor: string): string {
  return `Motivo definido na importação por ${gestor}`;
}

/**
 * Regras puras dos avisos (GAB-88, spec fase 2 §4.11). Sem banco: rodam no
 * cliente (sino) e no servidor (emissão).
 */
import type { TipoAviso } from "@prisma/client";

/** Só "é sua vez" e "proposta aceita / handoff" saem também no WhatsApp privado. */
const TIPOS_WHATSAPP: ReadonlySet<TipoAviso> = new Set<TipoAviso>(["SUA_VEZ", "PROPOSTA_ACEITA", "HANDOFF"]);

export function vaiPorWhatsapp(tipo: TipoAviso): boolean {
  return TIPOS_WHATSAPP.has(tipo);
}

/** Para onde o aviso leva (caminho interno). Proposta → aba da proposta; handoff, check-in e troca de GP → o projeto; tarefa → o kanban interno. */
export function hrefAviso(a: { tipo: TipoAviso; projetoId: string | null }): string | null {
  if (a.tipo === "LEMBRETE_GG") return "/gg/agenda";
  if (!a.projetoId) return null;
  if (a.tipo === "HANDOFF" || a.tipo === "CHECKIN_ATRASADO" || a.tipo === "GP_TROCADO") return `/projetos/${a.projetoId}`;
  if (a.tipo === "TAREFA_ATRIBUIDA") return `/projetos/${a.projetoId}/tarefas`;
  if (a.tipo === "EQUIPE_PROJETO") return `/projetos/${a.projetoId}/equipe`;
  return `/projetos/${a.projetoId}/proposta`;
}

/** `+5511999998888` (formato de `usuario.telefone_whatsapp`) → JID da conversa privada. */
export function jidPrivado(telefone: string): string {
  return `${telefone.replace(/\D/g, "")}@s.whatsapp.net`;
}

export function textoWhatsapp(titulo: string, url: string | null): string {
  return url ? `🖊️ CRM IJ: ${titulo}\n${url}` : `🖊️ CRM IJ: ${titulo}`;
}

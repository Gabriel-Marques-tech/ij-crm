/**
 * Como exibir uma referência a Empresa/Contato que pode ter morrido depois de
 * vinculada (soft-delete ou merge). Nunca aparece como ativa nem vira link
 * para 404: excluída → texto; mesclada → texto + link para o destino vivo.
 */
import { resolverContatos, resolverEmpresas } from "@/lib/contatos/match";

export type RefBruta = { id: string; nome: string; deletadoEm: Date | null; mergedIntoId: string | null };

export type Vinculo =
  | { estado: "ATIVO"; id: string; nome: string }
  | { estado: "EXCLUIDO"; id: string; nome: string }
  | { estado: "MESCLADO"; id: string; nome: string; destino: { id: string; nome: string } | null };

export const SELECAO_REF = { id: true, nome: true, deletadoEm: true, mergedIntoId: true } as const;

/** Resolve várias referências de uma vez (uma query por salto de merge). */
export async function descreverVinculos(tipo: "empresa" | "contato", refs: (RefBruta | null | undefined)[]): Promise<Map<string, Vinculo>> {
  const vivas = refs.filter((r): r is RefBruta => !!r);
  const mescladas = vivas.filter((r) => !r.deletadoEm && r.mergedIntoId).map((r) => r.id);
  const destinos = mescladas.length ? await (tipo === "empresa" ? resolverEmpresas : resolverContatos)(mescladas) : new Map();
  const saida = new Map<string, Vinculo>();
  for (const r of vivas) {
    if (r.deletadoEm) saida.set(r.id, { estado: "EXCLUIDO", id: r.id, nome: r.nome });
    else if (r.mergedIntoId) {
      const d = destinos.get(r.id);
      saida.set(r.id, { estado: "MESCLADO", id: r.id, nome: r.nome, destino: d && !d.deletado ? { id: d.id, nome: d.nome } : null });
    } else saida.set(r.id, { estado: "ATIVO", id: r.id, nome: r.nome });
  }
  return saida;
}

export async function descreverVinculo(tipo: "empresa" | "contato", ref: RefBruta | null | undefined): Promise<Vinculo | null> {
  if (!ref) return null;
  return (await descreverVinculos(tipo, [ref])).get(ref.id) ?? null;
}

const SUFIXO = {
  empresa: { EXCLUIDO: "excluída", MESCLADO: "mesclada" },
  contato: { EXCLUIDO: "excluído", MESCLADO: "mesclado" },
} as const;

/** Texto simples (sem link): "Acme", "Acme (excluída)", "Acme (mesclada → Beta)". */
export function textoVinculo(tipo: "empresa" | "contato", v: Vinculo | null | undefined): string | null {
  if (!v) return null;
  if (v.estado === "ATIVO") return v.nome;
  if (v.estado === "EXCLUIDO") return `${v.nome} (${SUFIXO[tipo].EXCLUIDO})`;
  return `${v.nome} (${SUFIXO[tipo].MESCLADO}${v.destino ? ` → ${v.destino.nome}` : ""})`;
}

export function sufixoVinculo(tipo: "empresa" | "contato", estado: "EXCLUIDO" | "MESCLADO"): string {
  return SUFIXO[tipo][estado];
}

/**
 * Nome curto da empresa nas visões de card (Kanban, Minha Semana): mesclada →
 * nome da principal, mas só se ela estiver viva; senão, o próprio nome
 * (principal excluída nunca aparece como ativa). Merge tem 1 nível.
 */
export const SELECAO_NOME_EXIBIDO = { nome: true, mergedInto: { select: { nome: true, deletadoEm: true } } } as const;

export function nomeExibido(r: { nome: string; mergedInto: { nome: string; deletadoEm: Date | null } | null }): string {
  return r.mergedInto && !r.mergedInto.deletadoEm ? r.mergedInto.nome : r.nome;
}

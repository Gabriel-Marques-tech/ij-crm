/**
 * Página Membros (GAB-106): organograma e lista da IJ inteira, fora de Gente & Gestão. Puro:
 * a página, a ficha e os redirecionamentos das rotas antigas (`/gg/membros`, `/gg/organograma`)
 * usam as mesmas funções.
 *
 * Acesso: todo usuário logado lê a página. Quem escreve segue as réguas de antes:
 * - cadastrar pessoa com conta do CRM: gestor e admin (a action exige GESTOR; o papel que cada um
 *   pode dar é `podeAtribuirPapel`, conferido no formulário e no serviço);
 * - "Novo membro" sem conta, ficha, estrutura e posições: editor de G&G (`ehEditorGG`) e admin.
 *
 * Ficha: e-mail, períodos, histórico, projetos, demandas, faltas e a ponte com a conta do CRM ficam
 * para quem edita G&G, gestão (gestor/admin) e a própria pessoa. Os demais (membro, visualizador)
 * veem só nome, área, cargo e status, que é o que o organograma já mostra a todos.
 */
import type { Papel, StatusMembro } from "@prisma/client";
import { temPapelMinimo } from "@/lib/auth/papeis";
import { descendentes, normalizar, STATUS_MEMBRO } from "./modelo";
import { postosDe, type BaseOrg, type MembroB } from "./organizacao";

export type Visao = "organograma" | "lista";
export const VISOES: readonly Visao[] = ["organograma", "lista"];

/** Visão da URL (`?visao=`); qualquer outro valor cai no organograma. */
export function lerVisao(v: string | null | undefined): Visao {
  return VISOES.find((x) => x === v) ?? "organograma";
}

export type FiltrosMembros = { q?: string; area?: string; cargo?: string; status?: string };

/** Status da URL, validado. */
export function lerStatus(v: string | null | undefined): StatusMembro | null {
  return STATUS_MEMBRO.find((s) => s === v) ?? null;
}

/**
 * Lista filtrada. Área inclui as frentes abaixo dela; área e cargo olham as posições vigentes.
 * `buscaEmail`: o e-mail entra na busca só para quem pode vê-lo (senão a busca revelaria e-mails).
 */
export function filtrarMembros(base: BaseOrg, f: FiltrosMembros, { buscaEmail }: { buscaEmail: boolean }): MembroB[] {
  const alcance = f.area ? descendentes(base.areas, f.area) : null;
  const busca = normalizar(f.q ?? "").trim();
  const status = lerStatus(f.status);
  return base.membros.filter((m) => {
    if (status && m.status !== status) return false;
    if (busca && !normalizar(buscaEmail ? `${m.nome} ${m.email ?? ""}` : m.nome).includes(busca)) return false;
    if (!alcance && !f.cargo) return true;
    return postosDe(base, m.id).some((p) => (!alcance || alcance.has(p.areaId)) && (!f.cargo || p.cargoId === f.cargo));
  });
}

/** Vê a ficha inteira: editor de G&G, gestor/admin ou a própria pessoa. */
export function veFichaCompleta(ator: { id: string; papel: Papel }, membro: { usuarioId: string | null }, editorGG: boolean): boolean {
  return editorGG || temPapelMinimo(ator.papel, "GESTOR") || (membro.usuarioId !== null && membro.usuarioId === ator.id);
}

/** Cadastrar pessoa com conta do CRM (formulário único do GAB-105): a régua da Gestão. */
export function podeCadastrarPessoa(papel: Papel): boolean {
  return temPapelMinimo(papel, "GESTOR");
}

export const HREF_MEMBROS = "/membros";

/**
 * `/membros?visao=…&…`, sem os parâmetros vazios, na ordem dada. Exceção: `fechado=` vazio fica,
 * porque no organograma ele diz "nenhum galho recolhido", e a ausência quer dizer "o padrão" (G&G recolhido).
 */
export function hrefMembros(params: { visao: Visao } & Record<string, string | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v || (k === "fechado" && v === "")) q.set(k, v);
  return `${HREF_MEMBROS}?${q}`;
}

/** Parâmetros que as rotas antigas aceitavam e a nova continua lendo. */
const PARAMETROS_ANTIGOS: Record<Visao, readonly string[]> = { lista: ["q", "area", "status"], organograma: ["escopo", "fechado"] };

/** Destino de `/gg/membros` (lista) e `/gg/organograma` (organograma), levando os filtros. */
export function destinoAntigo(visao: Visao, sp: Record<string, string | string[] | undefined>): string {
  const params: Record<string, string | undefined> = {};
  for (const k of PARAMETROS_ANTIGOS[visao]) {
    const v = sp[k];
    params[k] = typeof v === "string" ? v : undefined;
  }
  return hrefMembros({ visao, ...params });
}

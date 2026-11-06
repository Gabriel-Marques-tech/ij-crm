/**
 * Regras puras da área Gente & Gestão (cliente e servidor). A maior parte vem de
 * automacao-GG/src/lib/modelo.ts sem mudança de lógica (vigente, descendentes,
 * temCiclo, validarImportacao); o resto é a ponte com o CRM e a rotina (fase B).
 * Spec: docs/superpowers/specs/2026-11-05-gg-no-crm-design.md
 */
import type { Area, CategoriaCargo, CategoriaEvento, FuncaoProjeto, Papel, StatusMembro, TipoAreaOrg, TipoDemanda } from "@prisma/client";

export const ROTULO_STATUS_MEMBRO: Record<StatusMembro, string> = { NAO_INFORMADO: "Não informado", ATIVO: "Ativo", AFASTADO: "Afastado", INATIVO: "Desligado" };
export const STATUS_MEMBRO = Object.keys(ROTULO_STATUS_MEMBRO) as StatusMembro[];
export const ROTULO_CATEGORIA: Record<CategoriaCargo, string> = { DIRETORIA: "diretoria", LIDERANCA: "liderança", MEMBRO: "membro" };
export const ROTULO_TIPO_AREA: Record<TipoAreaOrg, string> = { AREA: "área", FRENTE: "frente", INSTITUCIONAL: "institucional" };
export const ROTULO_FUNCAO: Record<FuncaoProjeto, string> = { PM: "PM", PO: "PO", SCRUM_MASTER: "Scrum Master", MEMBRO: "Membro" };
export const FUNCOES = Object.keys(ROTULO_FUNCAO) as FuncaoProjeto[];
export const ROTULO_EVENTO: Record<CategoriaEvento, string> = { RG: "RG", REUNIAO: "Reunião", EVENTO: "Evento" };
export const ROTULO_DEMANDA: Record<TipoDemanda, string> = { ROSA: "Rosa", AZUL: "Azul" };
/** Regra do G&G: por membro e semestre, contando as não canceladas. */
export const LIMITE_DEMANDA: Record<TipoDemanda, number> = { ROSA: 2, AZUL: 3 };
export const LOTE_MAX = 500;

export const normalizar = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

/** Período [inicio, fim) em dias `YYYY-MM-DD`; invalidada (retirada por erro) nunca é vigente. Início vazio = sem limite inferior. */
export function vigente(v: { inicio: string | null; fim: string | null; invalidadoEm?: unknown }, dia: string): boolean {
  return !v.invalidadoEm && (!v.inicio || v.inicio <= dia) && (!v.fim || v.fim > dia);
}

/** A área e todas as abaixo dela. */
export function descendentes(areas: { id: string; superiorId: string | null }[], raiz: string): Set<string> {
  const ids = new Set([raiz]);
  let tamanho;
  do {
    tamanho = ids.size;
    for (const a of areas) if (a.superiorId && ids.has(a.superiorId)) ids.add(a.id);
  } while (tamanho !== ids.size);
  return ids;
}

/** Ligar `id` abaixo de `superior` criaria um ciclo? */
export function temCiclo(itens: { id: string; superior: string | null }[], id: string, superior: string | null): boolean {
  const vistos = new Set([id]);
  while (superior) {
    if (vistos.has(superior)) return true;
    vistos.add(superior);
    superior = itens.find((x) => x.id === superior)?.superior ?? null;
  }
  return false;
}

export type LinhaImportacao = { nome: string; email: string | null; status: StatusMembro; area: string | null; cargo: string | null; entrada: string | null };

const STATUS_IMPORTACAO: Record<string, StatusMembro> = { nao_informado: "NAO_INFORMADO", ativo: "ATIVO", afastado: "AFASTADO", inativo: "INATIVO" };

/** Valida o JSON de importação (mesmas mensagens do G&G). Lança `Error` com a linha do problema. */
export function validarImportacao(input: unknown, hoje: string): LinhaImportacao[] {
  if (!Array.isArray(input) || !input.length || input.length > LOTE_MAX) throw new Error(`Informe de 1 a ${LOTE_MAX} membros em uma lista JSON.`);
  const chaves = new Set<string>();
  return input.map((r: Record<string, unknown>, i) => {
    const linha = `Linha ${i + 1}`;
    if (!r || typeof r !== "object" || typeof r.nome !== "string" || !r.nome.trim() || r.nome.length > 200) throw new Error(`${linha}: nome inválido.`);
    if (r.email != null && (typeof r.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email))) throw new Error(`${linha}: e-mail inválido.`);
    if (r.status != null && (typeof r.status !== "string" || !STATUS_IMPORTACAO[r.status])) throw new Error(`${linha}: status inválido.`);
    for (const campo of ["area", "cargo"] as const) if (r[campo] != null && (typeof r[campo] !== "string" || (r[campo] as string).length > 200)) throw new Error(`${linha}: ${campo} inválido.`);
    const entrada = r.entrada;
    if (entrada != null && entrada !== "" && (typeof entrada !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entrada) || Number.isNaN(Date.parse(entrada)) || new Date(entrada).toISOString().slice(0, 10) !== entrada || entrada > hoje))
      throw new Error(`${linha}: data de entrada inválida.`);
    const email = typeof r.email === "string" ? r.email.trim() : null;
    const chave = normalizar(email || (r.nome as string));
    if (chaves.has(chave)) throw new Error(`${linha}: membro repetido na importação.`);
    chaves.add(chave);
    return {
      nome: (r.nome as string).trim(),
      email: email || null,
      status: STATUS_IMPORTACAO[(r.status as string) ?? "nao_informado"] ?? "NAO_INFORMADO",
      area: typeof r.area === "string" && r.area.trim() ? r.area.trim() : null,
      cargo: typeof r.cargo === "string" && r.cargo.trim() ? r.cargo.trim() : null,
      entrada: typeof entrada === "string" && entrada ? entrada : null,
    };
  });
}

// ---------------------------------------------------------------- ponte organograma → CRM

/** O que o organograma diz sobre uma ocupação vigente: lado da área-raiz, categoria e GP do cargo. */
export type PostoDerivavel = { ladoCrm: Area | null; categoria: CategoriaCargo; ehGp: boolean; principal: boolean };

export type Derivado = { area: Area | null; papel: Papel | null; gp: boolean; conflito: Area[] | null };

/**
 * Área, papel e GP que o organograma sugere para a conta do CRM (decisões da spec §3):
 * diretoria → GESTOR; lado da área (Projetos/Vendas) → PROJETOS/VENDEDOR; outra área → VISUALIZADOR;
 * cargo marcado como GP (PM) → GP. Duas áreas: vale a ocupação principal; sem principal entre elas, conflito.
 */
export function derivarDoOrganograma(postos: PostoDerivavel[]): Derivado {
  if (postos.length === 0) return { area: null, papel: null, gp: false, conflito: null };
  const lados = [...new Set(postos.map((p) => p.ladoCrm).filter((l): l is Area => l !== null))];
  let area: Area | null = lados.length === 1 ? lados[0] : null;
  let conflito: Area[] | null = null;
  if (lados.length > 1) {
    const principal = postos.find((p) => p.principal && p.ladoCrm)?.ladoCrm ?? null;
    if (principal) area = principal;
    else conflito = lados;
  }
  const gestor = postos.some((p) => p.categoria === "DIRETORIA");
  const gp = area !== null && postos.some((p) => p.ehGp && p.ladoCrm === area);
  const papel: Papel = gestor ? "GESTOR" : area === "PROJETOS" ? "PROJETOS" : area === "VENDAS" ? "VENDEDOR" : "VISUALIZADOR";
  return { area, papel, gp, conflito };
}

/** A conta difere do que o organograma sugere? (ADMIN nunca é rebaixado pela sugestão.) */
export function contaDifere(conta: { papel: Papel; area: Area | null; gp: boolean }, d: Derivado): boolean {
  if (d.papel === null || d.conflito || conta.papel === "ADMIN") return false;
  return conta.papel !== d.papel || conta.area !== d.area || conta.gp !== d.gp;
}

// ---------------------------------------------------------------- rotina (fase B)

/** Semestre `AAAA.1` (jan–jun) ou `AAAA.2` (jul–dez) do dia. */
export function semestreDe(dia: string): string {
  return `${dia.slice(0, 4)}.${Number(dia.slice(5, 7)) <= 6 ? 1 : 2}`;
}

/** Progresso de um resultado-chave de 0 a 100 (meta igual ao inicial = 100 se atingiu). */
export function progresso(inicial: number, meta: number, atual: number): number {
  if (meta === inicial) return atual >= meta ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round(((atual - inicial) / (meta - inicial)) * 100)));
}

export function naMeta(direcao: "MAIOR" | "MENOR", atual: number, meta: number): boolean {
  return direcao === "MAIOR" ? atual >= meta : atual <= meta;
}

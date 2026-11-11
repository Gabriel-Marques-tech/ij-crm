import type { Area, AreaEntrada, Cargo, Papel } from "@prisma/client";
import { podeEscrever, temPapelMinimo } from "./papeis";

/**
 * Lado (área) e cargos do usuário — GAB-82, spec fase 2 §4.12.
 *
 * Modelo: `usuario.area` (VENDAS | PROJETOS | null = nenhum) guardada, e
 * `usuario.cargos` (array do enum Cargo). Cargo é atributo dentro da área, não
 * papel de permissão: quem escreve/lê continua sendo o `papel`.
 *
 * Cargos por área (`CARGOS_DA_AREA`):
 * - VENDAS: GP — age em nome de vendas na caneta da proposta.
 * - PROJETOS: PM — age em nome de projetos na caneta e designa o GP do projeto;
 *   PO — rótulo (costuma ser o GP do projeto), nenhuma permissão própria;
 *   DIRETOR — só com papel GESTOR/ADMIN: é a gestão com lado Projetos, nomeada.
 * - GP em PROJETOS é legado (contas anteriores aos cargos de Projetos): lido como
 *   sinônimo de PM (`cargosDe`), e o form não o oferece mais para Projetos.
 *
 * Coerência área × papel (aplicada por `resolverAreaCargos` em todo convite e
 * edição, e de novo por `ladoDe`/`cargosDe` na leitura):
 * - VENDEDOR → sempre VENDAS; PROJETOS → sempre PROJETOS (o papel diz o time).
 * - VISUALIZADOR → nenhum lado, nenhum cargo (só lê; não age em nome de lado).
 * - GESTOR/ADMIN → nenhum por padrão; a gestão PODE dar um lado (ex.: diretor
 *   com papel gestor que é o GP de vendas). Gestor sem lado não age na caneta.
 * - Cargo exige lado e tem de ser da área: sem área, cargos ficam vazios.
 *
 * Este é o ÚNICO lugar que responde "de que lado é" e "é GP deste lado"
 * (caneta da proposta, MCP). Puro: roda no cliente e no servidor.
 */

export const AREAS: readonly Area[] = ["VENDAS", "PROJETOS"];
/** Todos os cargos, na ordem em que aparecem (tabela, form, descrição). */
export const CARGOS: readonly Cargo[] = ["GP", "PM", "PO", "DIRETOR"];
/** Cargos válidos em cada área, na ordem de exibição. */
export const CARGOS_DA_AREA: Record<Area, readonly Cargo[]> = { VENDAS: ["GP"], PROJETOS: ["PM", "PO", "DIRETOR"] };
/** Cargo que lidera a proposta pelo lado: pega a caneta, e em Projetos designa o GP do projeto. */
export const CARGO_GP_DO_LADO: Record<Area, Cargo> = { VENDAS: "GP", PROJETOS: "PM" };
/** Cargos que só a gestão (GESTOR/ADMIN) pode ter. */
const CARGOS_DE_GESTAO: readonly Cargo[] = ["DIRETOR"];

export const ROTULO_AREA: Record<Area, string> = { VENDAS: "Vendas", PROJETOS: "Projetos" };
export const ROTULO_CARGO: Record<Cargo, string> = { GP: "GP", PM: "PM", PO: "PO", DIRETOR: "Diretor" };

/** Área imposta pelo papel (VENDEDOR/PROJETOS); `undefined` = papel não fixa área. */
const AREA_DO_PAPEL: Partial<Record<Papel, Area>> = { VENDEDOR: "VENDAS", PROJETOS: "PROJETOS" };

/** Como o papel trata a área: fixa (vem do papel), livre (gestão escolhe) ou nenhuma. */
export function regraDeArea(papel: Papel): { tipo: "fixa"; area: Area } | { tipo: "livre" } | { tipo: "nenhuma" } {
  const fixa = AREA_DO_PAPEL[papel];
  if (fixa) return { tipo: "fixa", area: fixa };
  if (papel === "VISUALIZADOR") return { tipo: "nenhuma" };
  return { tipo: "livre" };
}

/** Cargos que este papel pode ter nesta área (o que o form oferece): Diretor só para a gestão. */
export function cargosDaArea(area: Area, papel: Papel): readonly Cargo[] {
  return CARGOS_DA_AREA[area].filter((c) => !CARGOS_DE_GESTAO.includes(c) || temPapelMinimo(papel, "GESTOR"));
}

/**
 * Normaliza o que a gestão pediu para algo coerente com o papel. Área pedida
 * é ignorada quando o papel a fixa; cargos repetidos ou de outra área somem;
 * DIRETOR sem papel de gestão some; sem área, sem cargo. GP pedido para
 * Projetos vira PM (sinônimo legado), para a conta antiga não perder a caneta
 * ao ser reeditada.
 */
export function resolverAreaCargos(papel: Papel, area: Area | null, cargos: readonly Cargo[]): { area: Area | null; cargos: Cargo[] } {
  const regra = regraDeArea(papel);
  const final = regra.tipo === "fixa" ? regra.area : regra.tipo === "nenhuma" ? null : area;
  if (final === null) return { area: null, cargos: [] };
  const pedidos = final === "PROJETOS" ? cargos.map((c) => (c === "GP" ? "PM" : c)) : cargos;
  return { area: final, cargos: cargosDaArea(final, papel).filter((c) => pedidos.includes(c)) };
}

export const AREAS_ENTRADA: readonly AreaEntrada[] = ["VENDAS", "PROJETOS", "GERAL"];
export const ROTULO_AREA_ENTRADA: Record<AreaEntrada, string> = { VENDAS: "Vendas", PROJETOS: "Projetos", GERAL: "Geral (Painel)" };

/**
 * A área de entrada vem da coluna própria só para quem não tem uma área que a
 * defina: ADMIN (mesmo com lado), GESTOR sem área e VISUALIZADOR. `area` = a efetiva.
 */
export function usaAreaDeEntrada(papel: Papel, area: Area | null): boolean {
  return papel === "ADMIN" || papel === "VISUALIZADOR" || (papel === "GESTOR" && area === null);
}

/** Área de entrada coerente com papel e área: quem entra pela própria área não guarda valor. */
export function resolverAreaEntrada(papel: Papel, area: Area | null, pedida: AreaEntrada | null): AreaEntrada | null {
  return usaAreaDeEntrada(papel, area) ? pedida : null;
}

/** Sem valor vale Geral: `null` e `GERAL` são a mesma entrada, e passar de um ao outro não é mudança. */
export function mesmaAreaEntrada(a: AreaEntrada | null, b: AreaEntrada | null): boolean {
  return (a ?? "GERAL") === (b ?? "GERAL");
}

export type PessoaComLado = { papel: Papel; area: Area | null; cargos: readonly Cargo[] };

/** De que lado é este usuário (null = nenhum). Defensivo: o papel prevalece sobre a coluna. */
export function ladoDe(u: PessoaComLado): Area | null {
  const regra = regraDeArea(u.papel);
  if (regra.tipo === "fixa") return regra.area;
  if (regra.tipo === "nenhuma") return null;
  return u.area;
}

/**
 * Cargos EFETIVOS da pessoa: os da coluna, lidos pela mesma regra do convite
 * (lado efetivo, cargo da área, Diretor só na gestão, GP em Projetos = PM).
 * Visualizador e quem não escreve não têm cargo que valha.
 */
export function cargosDe(u: PessoaComLado): Cargo[] {
  if (!podeEscrever(u.papel)) return [];
  return resolverAreaCargos(u.papel, u.area, u.cargos).cargos;
}

export function temCargo(u: PessoaComLado, cargo: Cargo): boolean {
  return ladoDe(u) !== null && cargosDe(u).includes(cargo);
}

/**
 * É "o GP deste lado": está no lado, pode escrever e tem o cargo que lidera a
 * proposta por ele (GP em Vendas, PM em Projetos — GP legado em Projetos conta).
 * Quem pega a caneta, marca inviável (projetos) e designa o GP do projeto.
 */
export function ehGpDoLado(u: PessoaComLado, lado: Area): boolean {
  return ladoDe(u) === lado && temCargo(u, CARGO_GP_DO_LADO[lado]);
}

/** Lidera a proposta pelo próprio lado (GP de vendas ou PM de projetos), seja ele qual for. */
export function ehGpDoProprioLado(u: PessoaComLado): boolean {
  const lado = ladoDe(u);
  return lado !== null && ehGpDoLado(u, lado);
}

/** "GP de vendas", "PM, PO de projetos", "Projetos", "—"… para tabela/perfil. */
export function descreverLado(u: PessoaComLado): string {
  const lado = ladoDe(u);
  if (!lado) return "—";
  const cargos = cargosDe(u);
  return cargos.length ? `${cargos.map((c) => ROTULO_CARGO[c]).join(", ")} de ${ROTULO_AREA[lado].toLowerCase()}` : ROTULO_AREA[lado];
}

/**
 * Kanban interno do projeto (tarefas do time): pessoa da área de Projetos, diretoria
 * (gestor de Projetos ou sem área, que conta nas duas áreas, como no hub §4.7) ou admin.
 * Vendedor, gestor de vendas e visualizador: nada. É o portão geral; por projeto vale
 * `podeVerTarefasDoProjeto`.
 */
export function podeVerTarefas(u: PessoaComLado): boolean {
  return u.papel === "ADMIN" || ladoDe(u) === "PROJETOS" || (u.papel === "GESTOR" && ladoDe(u) === null);
}

/** Quem está escalado num projeto: equipe aberta, responsável do card e GP do handoff. */
export type EscalaProjeto = { equipe: readonly string[]; responsavelId: string; gpId: string | null };

const escalado = (id: string, e: EscalaProjeto) => e.equipe.includes(id) || e.responsavelId === id || e.gpId === id;

/** Diretoria (gestor que vê tarefas) e admin: veem e editam a equipe de qualquer projeto. */
function ehDiretoriaDeProjetos(u: PessoaComLado): boolean {
  return u.papel === "ADMIN" || (u.papel === "GESTOR" && podeVerTarefas(u));
}

/**
 * Tarefas de UM projeto: diretoria e admin sempre; do time de Projetos, quem está
 * escalado. Projeto ainda sem equipe fica aberto ao time inteiro (como era antes da escala).
 */
export function podeVerTarefasDoProjeto(u: PessoaComLado & { id: string }, e: EscalaProjeto): boolean {
  if (!podeVerTarefas(u)) return false;
  return ehDiretoriaDeProjetos(u) || e.equipe.length === 0 || escalado(u.id, e);
}

/** Pode receber tarefa do projeto: passa no portão e, havendo equipe, está escalado. */
export function podeSerResponsavelNoProjeto(u: PessoaComLado & { id: string }, e: EscalaProjeto): boolean {
  return podeVerTarefas(u) && (e.equipe.length === 0 || escalado(u.id, e));
}

/**
 * Monta a equipe: diretoria, admin, o GP do projeto e o responsável do card, sempre do
 * time de projetos (mesmo portão da aba): o vendedor que ainda é responsável no handoff
 * ou o ex-GP que mudou de lado não decidem quem vê as tarefas.
 */
export function podeEditarEquipe(u: PessoaComLado & { id: string }, e: EscalaProjeto): boolean {
  return podeEscrever(u.papel) && podeVerTarefas(u) && (ehDiretoriaDeProjetos(u) || e.gpId === u.id || e.responsavelId === u.id);
}

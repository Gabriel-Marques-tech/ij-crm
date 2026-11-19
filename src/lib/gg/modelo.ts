/**
 * Regras puras da área Gente & Gestão (cliente e servidor). A maior parte vem de
 * automacao-GG/src/lib/modelo.ts sem mudança de lógica (vigente, descendentes,
 * temCiclo, validarImportacao); o resto é a ponte com o CRM e a rotina (fase B).
 * Spec: docs/superpowers/specs/2026-11-05-gg-no-crm-design.md
 */
import type { Area, AreaEntrada, Cargo, CategoriaCargo, CategoriaEvento, FuncaoProjeto, Papel, StatusMembro, TipoAreaOrg, TipoDemanda } from "@prisma/client";
import { CARGO_GP_DO_LADO, CARGOS, resolverAreaCargos, resolverAreaEntrada, ROTULO_AREA, ROTULO_CARGO } from "@/lib/auth/areas";

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

/**
 * Cúpula do organograma (só exibição; a hierarquia guardada não muda): a partir de uma raiz
 * institucional com exatamente UM filho institucional, esse filho sobe para a mesma linha
 * (Presidência e Vice-Presidência lado a lado). No máximo 2 na linha: um 3º institucional fica abaixo. Os filhos da linha são os do
 * último nó puxado, depois dos filhos não institucionais dos anteriores (nada some do desenho).
 */
export function cupula(itens: { id: string; superiorId: string | null; institucional: boolean }[], raiz: string): { ids: string[]; filhos: string[] } {
  const ids = [raiz];
  const sobras: string[] = [];
  let atual = itens.find((x) => x.id === raiz);
  while (ids.length < 2 && atual?.institucional) {
    const filhos = itens.filter((x) => x.superiorId === atual!.id && !ids.includes(x.id));
    const inst = filhos.filter((x) => x.institucional);
    if (inst.length !== 1) break;
    sobras.push(...filhos.filter((x) => x !== inst[0]).map((x) => x.id));
    ids.push(inst[0].id);
    atual = inst[0];
  }
  const ultimo = ids[ids.length - 1];
  const finais = itens.filter((x) => x.superiorId === ultimo && !ids.includes(x.id)).map((x) => x.id);
  return { ids, filhos: [...sobras, ...finais] };
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

/**
 * O que o organograma diz sobre uma ocupação vigente: lado da área-raiz, se a área DA PRÓPRIA
 * posição é institucional (Presidência, Vice; uma subárea abaixo delas não é), categoria e marcas
 * do cargo (GP = PM/GP; PO).
 */
export type PostoDerivavel = { ladoCrm: Area | null; institucional: boolean; categoria: CategoriaCargo; ehGp: boolean; ehPo: boolean; principal: boolean };

export type Derivado = { area: Area | null; papel: Papel | null; cargos: Cargo[]; conflito: Area[] | null };

/** Ordem do catálogo (`CARGOS`), sem repetição: o que a comparação e o form esperam. */
const ordenarCargos = (cs: Iterable<Cargo>): Cargo[] => CARGOS.filter((c) => [...cs].includes(c));

/**
 * Área, papel e cargos que o organograma sugere para a conta do CRM (decisões da spec §3
 * e cargos de Projetos). Regra (GAB-107): a diretoria vê e edita tudo da ÁREA DELA, então
 * - diretoria em área institucional (Presidência, Vice) → GESTOR sem área (gestor das DUAS áreas),
 *   o que quer que a pessoa ocupe além disso (sem lado, sem cargo, sem conflito);
 * - diretoria do lado da conta (Vendas/Projetos) → GESTOR desse lado (em Projetos, com cargo DIRETOR);
 * - diretoria de área sem lado no CRM (G&G, Marketing, ADM-FIN) não dá gestão: segue a regra de
 *   membro (a caneta do G&G vem de `ehGG`, não do papel), e diretoria do outro lado (não principal)
 *   também não dá gestão do lado da conta;
 * lado da área (Projetos/Vendas) → PROJETOS/VENDEDOR; outra área → VISUALIZADOR;
 * cargo marcado como GP → o GP do lado (PM em Projetos, GP em Vendas); cargo PO em Projetos → PO.
 * Só contam cargos de postos no lado escolhido. Duas áreas: vale a ocupação principal; sem
 * principal entre elas, conflito (e nenhum cargo).
 */
export function derivarDoOrganograma(postos: PostoDerivavel[]): Derivado {
  if (postos.length === 0) return { area: null, papel: null, cargos: [], conflito: null };
  if (postos.some((p) => p.categoria === "DIRETORIA" && p.institucional)) return { area: null, papel: "GESTOR", cargos: [], conflito: null };
  const lados = [...new Set(postos.map((p) => p.ladoCrm).filter((l): l is Area => l !== null))];
  let area: Area | null = lados.length === 1 ? lados[0] : null;
  let conflito: Area[] | null = null;
  if (lados.length > 1) {
    const principal = postos.find((p) => p.principal && p.ladoCrm)?.ladoCrm ?? null;
    if (principal) area = principal;
    else conflito = lados;
  }
  const gestor = area !== null && postos.some((p) => p.categoria === "DIRETORIA" && p.ladoCrm === area);
  const papel: Papel = gestor ? "GESTOR" : area === "PROJETOS" ? "PROJETOS" : area === "VENDAS" ? "VENDEDOR" : "VISUALIZADOR";
  const cargos = new Set<Cargo>();
  if (area !== null) {
    const noLado = postos.filter((p) => p.ladoCrm === area);
    if (noLado.some((p) => p.ehGp)) cargos.add(CARGO_GP_DO_LADO[area]);
    if (area === "PROJETOS" && noLado.some((p) => p.ehPo)) cargos.add("PO");
    if (area === "PROJETOS" && noLado.some((p) => p.categoria === "DIRETORIA")) cargos.add("DIRETOR");
  }
  // A mesma régua do convite: o que a conta não pode ter (ex.: Diretor sem gestão) não é sugerido.
  return { area, papel, cargos: ordenarCargos(resolverAreaCargos(papel, area, [...cargos]).cargos), conflito };
}

/**
 * A conta difere do que o organograma sugere? (ADMIN nunca é rebaixado pela sugestão.)
 * Os cargos da conta são lidos pela régua do convite (GP legado em Projetos = PM, sujeira
 * fora da área não conta), para uma conta válida nunca ficar "difere" sem ter o que aplicar.
 */
export function contaDifere(conta: { papel: Papel; area: Area | null; cargos: readonly Cargo[] }, d: Derivado): boolean {
  if (d.papel === null || d.conflito || conta.papel === "ADMIN") return false;
  const daConta = ordenarCargos(resolverAreaCargos(conta.papel, conta.area, conta.cargos).cargos);
  return conta.papel !== d.papel || conta.area !== d.area || daConta.join() !== d.cargos.join();
}

/** A conta do CRM que o cadastro grava (GAB-107): tudo vem da posição; `areaEntrada` já normalizada. */
export type ContaDerivada = { papel: Papel; area: Area | null; cargos: Cargo[]; areaEntrada: AreaEntrada | null };

/**
 * Conta que o cadastro grava a partir do organograma (GAB-107): papel, lado e cargos de
 * `derivarDoOrganograma` (sem posição ou só em área sem lado = VISUALIZADOR; presidência e
 * diretorias = GESTOR). `administrador` (só o admin marca, conferido no servidor) troca o papel por
 * ADMIN e mantém o lado. Área de entrada não é perguntada: a área derivada, senão Geral (e quem
 * entra pela própria área não guarda valor, `resolverAreaEntrada`). Conflito (dois lados sem
 * principal): null, quem chama recusa.
 */
export function contaDaDerivacao(d: Derivado, { administrador = false }: { administrador?: boolean } = {}): ContaDerivada | null {
  if (d.conflito) return null;
  const papel: Papel = administrador ? "ADMIN" : (d.papel ?? "VISUALIZADOR");
  const lado = resolverAreaCargos(papel, d.area, d.cargos);
  return { papel, area: lado.area, cargos: ordenarCargos(lado.cargos), areaEntrada: resolverAreaEntrada(papel, lado.area, lado.area ?? "GERAL") };
}

/** Uma linha para a prévia do cadastro: "Gestor de Vendas", "Membro de Projetos · PM", "Visualizador (só leitura)". */
export function descreverConta(c: { papel: Papel; area: Area | null; cargos: readonly Cargo[] }): string {
  const cargos = c.cargos.length ? ` · ${c.cargos.map((x) => ROTULO_CARGO[x]).join(", ")}` : "";
  const lado = c.area ? ROTULO_AREA[c.area] : null;
  switch (c.papel) {
    case "ADMIN":
      return `Administrador${lado ? ` · ${lado}` : ""}${cargos}`;
    case "GESTOR":
      return `Gestor de ${lado ?? "Vendas e Projetos"}${cargos}`;
    case "VENDEDOR":
    case "PROJETOS":
      return `Membro de ${lado ?? ROTULO_AREA[c.papel === "VENDEDOR" ? "VENDAS" : "PROJETOS"]}${cargos}`;
    default:
      return "Visualizador (só leitura)";
  }
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

/**
 * O nome parece da área Gente & Gestão? Só para AVISAR quando nenhuma área está marcada `ehGG`
 * (aí quem ocupa a posição não vira editor de G&G); permissão nunca sai daqui.
 */
export function pareceAreaGG(texto: string): boolean {
  return /gente|\bg ?& ?g\b|\bgg\b|gestao de pessoas/.test(normalizar(texto));
}

import type { Area, AreaEntrada } from "@prisma/client";
import type { PaginaInicial } from "@/lib/preferencias/preferencias";
import { AREAS, ehGpDoLado, ehGpDoProprioLado, ladoDe, usaAreaDeEntrada, type PessoaComLado } from "./areas";
import { podeEscrever, temPapelMinimo } from "./papeis";

/**
 * Quem vê o quê em cada área (spec áreas §4.2, §4.4 a §4.7). Puro: menu, páginas,
 * actions e MCP usam as mesmas funções. Fala em itens, não em rotas: `href` e ícone
 * ficam em `components/shell/nav-config`.
 *
 * `podeVerItem` só responde "pode ver o item". As regras do conteúdo (card, proposta
 * e agenda) ficam no fim do arquivo; quem lê o banco para aplicá-las é
 * `lib/projetos/acesso-card`, `lib/propostas/acesso` e `lib/calendario/calendario`.
 */

export type ItemDeArea = "semana" | "kanban" | "propostas" | "tabela" | "ranking" | "contatos" | "empresas" | "calendario";
export type ItemGeral = "painel" | "gestao" | "perfil";

const ITENS_PROPRIOS: Record<Area, readonly ItemDeArea[]> = {
  VENDAS: ["semana", "kanban", "propostas", "tabela", "ranking"],
  PROJETOS: ["semana", "kanban", "propostas"],
};
const ITENS_COMPARTILHADOS: readonly ItemDeArea[] = ["contatos", "empresas", "calendario"];

/** Quem é de fora da área. Propostas e Calendário aparecem, mas filtrados pela pessoa (§4.5 e §4.6). */
const ABERTOS_A_VISITANTES: ReadonlySet<ItemDeArea> = new Set(["kanban", "propostas", "contatos", "empresas", "calendario"]);
/** VISUALIZADOR é visitante em todas as áreas, e sem Propostas e Calendário (§4.7). */
const ABERTOS_AO_VISUALIZADOR: ReadonlySet<ItemDeArea> = new Set(["kanban", "contatos", "empresas"]);

/** É da área: o próprio lado, ou ADMIN e GESTOR sem área, que contam nas duas (§4.7). */
export function ehDaArea(p: PessoaComLado, area: Area): boolean {
  if (p.papel === "ADMIN") return true;
  const lado = ladoDe(p);
  return p.papel === "GESTOR" && lado === null ? true : lado === area;
}

/** A pessoa pode ver este item nesta área? Item que a área não tem = não. */
export function podeVerItem(p: PessoaComLado, area: Area, item: ItemDeArea): boolean {
  if (!ITENS_PROPRIOS[area].includes(item) && !ITENS_COMPARTILHADOS.includes(item)) return false;
  if (p.papel === "VISUALIZADOR") return ABERTOS_AO_VISUALIZADOR.has(item);
  return ehDaArea(p, area) || ABERTOS_A_VISITANTES.has(item);
}

/** Itens da área que a pessoa vê, na ordem do menu. */
export function itensDaArea(p: PessoaComLado, area: Area): ItemDeArea[] {
  return [...ITENS_PROPRIOS[area], ...ITENS_COMPARTILHADOS].filter((item) => podeVerItem(p, area, item));
}

/** Para rotas que não dependem da área aberta (ex.: `/tabela`, `/semana`): vê em ao menos uma? */
export function podeVerItemEmAlgumaArea(p: PessoaComLado, item: ItemDeArea): boolean {
  return AREAS.some((area) => podeVerItem(p, area, item));
}

/** Bloco Geral da gaveta. */
export function itensGerais(p: Pick<PessoaComLado, "papel">): ItemGeral[] {
  return temPapelMinimo(p.papel, "GESTOR") ? ["painel", "gestao", "perfil"] : ["painel", "perfil"];
}

export type PessoaComEntrada = PessoaComLado & { areaEntrada: AreaEntrada | null };

/** Onde a pessoa entra (§4.3): a própria área ou, para quem a escolha cabe à gestão, a coluna (sem valor = Geral). */
export function areaDeEntrada(p: PessoaComEntrada): AreaEntrada {
  const lado = ladoDe(p);
  if (lado !== null && !usaAreaDeEntrada(p.papel, lado)) return lado;
  return p.areaEntrada ?? "GERAL";
}

/** Área do menu quando ainda não há nenhuma aberta: a de entrada; em Geral, o lado ou Vendas. */
export function areaPadrao(p: PessoaComEntrada): Area {
  const entrada = areaDeEntrada(p);
  return entrada === "GERAL" ? (ladoDe(p) ?? "VENDAS") : entrada;
}

export type DestinoDeArea = "/semana" | "/kanban" | "/kanban?quadro=projetos";

export function kanbanDaArea(area: Area): "/kanban" | "/kanban?quadro=projetos" {
  return area === "PROJETOS" ? "/kanban?quadro=projetos" : "/kanban";
}

/** Página inicial de uma área: a preferência da pessoa, se ela vê essa página lá; senão, o Kanban da área. */
export function destinoDaArea(p: PessoaComLado, area: Area, inicio: PaginaInicial): DestinoDeArea {
  return inicio === "semana" && podeVerItem(p, area, "semana") ? "/semana" : kanbanDaArea(area);
}

/** Parâmetro com que `/` diz a área à Minha Semana, rota que não a define para quem é das duas áreas. */
export const PARAMETRO_AREA = "area";

/**
 * Destino de `/` e do pós-login (sempre de uma lista fixa). A entrada vence a última
 * área aberta (§4.7): quem é das duas áreas vai à Minha Semana com a área indicada,
 * e o menu e o cookie a seguem. Quem é de uma área só já tem a Semana definida por ela.
 */
export function destinoDeEntrada(p: PessoaComEntrada, inicio: PaginaInicial): DestinoDeArea | "/painel" | `/semana?${typeof PARAMETRO_AREA}=${Area}` {
  const entrada = areaDeEntrada(p);
  if (entrada === "GERAL") return "/painel";
  const destino = destinoDaArea(p, entrada, inicio);
  return destino === "/semana" && usaAreaDeEntrada(p.papel, ladoDe(p)) ? `/semana?${PARAMETRO_AREA}=${entrada}` : destino;
}

/** Última área aberta (§4.7). Gravado pelo cliente; só escolhe o menu, nunca dá acesso. */
export const COOKIE_AREA = "ij_area";

/** Valida a área vinda de fora (cookie ou `?area=`). Também só escolhe o menu. */
export function lerArea(valor: string | null | undefined): Area | null {
  return AREAS.find((a) => a === valor) ?? null;
}

// ---------------------------------------------------------------- GAB-98: card, proposta e agenda (§4.4 a §4.7)

export type PessoaComId = PessoaComLado & { id: string };

/** Área dona do card: a do quadro em que ele está (`pipeline.chave`, §4.7). Quadro sem área = null. */
export function areaDoQuadro(chave: string): Area | null {
  return AREAS.find((a) => a.toLowerCase() === chave) ?? null;
}

/** É da área dona do quadro. Quadro sem área: só quem conta nas duas áreas (ADMIN e GESTOR sem área). */
function ehDaAreaDoQuadro(p: PessoaComLado, chave: string): boolean {
  const area = areaDoQuadro(chave);
  return area ? ehDaArea(p, area) : AREAS.every((a) => ehDaArea(p, a));
}

/** Card novo: quem escreve e é da área do quadro. Fora dela o Kanban é só leitura (§4.4). */
export function podeCriarCardNoQuadro(p: PessoaComLado, chave: string): boolean {
  return podeEscrever(p.papel) && ehDaAreaDoQuadro(p, chave);
}

/**
 * Mover de fase e editar dados: a área dona ou o responsável do card, que continua
 * respondendo por ele depois do Ganho (§4.7). Comentar, criar prazo e anexar não
 * passam por aqui: valem para todo mundo que escreve (`podeEscrever`).
 */
export function podeEditarCard(p: PessoaComId, card: { responsavelId: string; quadro: string }): boolean {
  if (!podeEscrever(p.papel)) return false;
  return card.responsavelId === p.id || ehDaAreaDoQuadro(p, card.quadro);
}

/**
 * Checklist e PDF do contrato enquanto o card está em Handoff: etapa conjunta de Projetos + Vendas
 * (§2 e §4.7). Quem edita o card, e quem é de Vendas e escreve. Fora de Handoff o serviço recusa;
 * Mover para Execução continua em `podeEditarCard`.
 */
export function podeEditarChecklistHandoff(p: PessoaComId, card: { responsavelId: string; quadro: string }): boolean {
  return podeEditarCard(p, card) || (podeEscrever(p.papel) && ehDaArea(p, "VENDAS"));
}

/**
 * Trocar o responsável (dá acesso à proposta, então é mais estrito que editar): o responsável
 * atual, o GP do lado dono, gestor da área dona ou sem área, e admin. A automação fica de fora.
 */
export function podeTrocarResponsavel(p: PessoaComId, card: { responsavelId: string; quadro: string }): boolean {
  if (!podeEscrever(p.papel)) return false;
  if (card.responsavelId === p.id || p.papel === "ADMIN") return true;
  if (p.papel === "GESTOR") return ehDaAreaDoQuadro(p, card.quadro);
  const area = areaDoQuadro(card.quadro);
  return area !== null && ehGpDoLado(p, area);
}

/** Quadro de quem não disse qual: o da própria área; sem lado, vendas. */
export function quadroPadrao(p: PessoaComLado): string {
  return (ladoDe(p) ?? "VENDAS").toLowerCase();
}

/** Vê todas as propostas: GESTOR com ou sem área, ADMIN e o GP do lado (GP de vendas, PM de projetos) (§4.7). */
export function veTodasAsPropostas(p: PessoaComLado): boolean {
  return temPapelMinimo(p.papel, "GESTOR") || ehGpDoProprioLado(p);
}

/** `escalado` = responsável do card, dono atual ou ex-dono da caneta, ou quem criou a proposta. VISUALIZADOR: nenhuma. */
export function podeVerProposta(p: PessoaComLado, escalado: boolean): boolean {
  return veTodasAsPropostas(p) || (escalado && podeEscrever(p.papel));
}

export type VisaoDaCaneta = "nenhuma" | "todas" | "escaladas" | "so_minhas";

/**
 * Tempo com a caneta no painel de projetos (GAB-96): vem das propostas, então segue `podeVerProposta`, e não
 * `podeVerPainelCompleto`, que abre tudo ao VISUALIZADOR. É uma comparação entre pessoas: com o ranking oculto,
 * quem não vê todas as propostas fica só com as próprias linhas. `rankingAberto` = `podeVerPainelCompleto`.
 */
export function visaoDaCanetaNoPainel(p: PessoaComLado, rankingAberto: boolean): VisaoDaCaneta {
  if (veTodasAsPropostas(p)) return "todas";
  if (!podeEscrever(p.papel)) return "nenhuma";
  return rankingAberto ? "escaladas" : "so_minhas";
}

export type AlcanceDaAgenda = "nenhum" | "proprio" | "area" | "todos";

/** De quem a pessoa vê agenda (§4.6): vale para o Calendário e para `/semana?vendedor=`. */
export function alcanceDaAgenda(p: PessoaComLado): AlcanceDaAgenda {
  if (!podeEscrever(p.papel)) return "nenhum";
  if (!temPapelMinimo(p.papel, "GESTOR")) return "proprio";
  return p.papel === "ADMIN" || ladoDe(p) === null ? "todos" : "area";
}

export function veOutrasAgendas(p: PessoaComLado): boolean {
  const alcance = alcanceDaAgenda(p);
  return alcance === "area" || alcance === "todos";
}

/** Gestor com área: pessoas com o mesmo `ladoDe`. ADMIN e GESTOR sem área: todos. Membro: só a própria. */
export function podeVerAgendaDe(ator: PessoaComId, alvo: PessoaComId): boolean {
  const alcance = alcanceDaAgenda(ator);
  if (alcance === "nenhum") return false;
  if (alvo.id === ator.id || alcance === "todos") return true;
  return alcance === "area" && ladoDe(alvo) === ladoDe(ator);
}

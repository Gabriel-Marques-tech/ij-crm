/**
 * Guardas das ferramentas MCP (GAB-98): a mesma regra de área e de proposta da tela,
 * declarada em cada ferramenta (`guarda`) e aplicada numa porta só (`executarFerramenta`).
 * `string` = o texto da recusa, em português; `null` = pode.
 */
import { recusaDeEdicaoNoCard, recusaDoChecklistHandoff } from "@/lib/projetos/acesso-card";
import { visaoDaCanetaNoPainel } from "@/lib/auth/visibilidade";
import { recusaDaProposta } from "@/lib/propostas/acesso";
import type { UsuarioMcp } from "./oauth";

/** Mover e editar dados: área dona ou responsável. O id do card vem em `id`. */
export const cardEditavel = (a: { id: string }, eu: UsuarioMcp) => recusaDeEdicaoNoCard(a.id, eu);

/** Copiar o cronograma da proposta (GAB-95): quem edita o card e vê a proposta. O GP, o serviço confere. */
export const copiaDaPropostaVisivel = async (a: { id: string }, eu: UsuarioMcp) => (await recusaDeEdicaoNoCard(a.id, eu)) ?? recusaDaProposta(a.id, eu);

/** Itens e PDF do contrato no Handoff: etapa conjunta de Projetos + Vendas. */
export const checklistHandoffEditavel = (a: { id: string }, eu: UsuarioMcp) => recusaDoChecklistHandoff(a.id, eu);

/** Como `cardEditavel`, com as regras próprias de `responsavelId` e `propostaUrl`. */
export const camposEditaveis = (a: { id: string; campos: Record<string, string | undefined> }, eu: UsuarioMcp) =>
  recusaDeEdicaoNoCard(a.id, eu, { campos: Object.keys(a.campos).filter((c) => a.campos[c] !== undefined) });

/** Tempo com a caneta no painel (GAB-96): vem das propostas. O recorte de cada um é do serviço (`carregarCanetaPara`). */
export const canetaDoPainelVisivel = async (_a: unknown, eu: UsuarioMcp) =>
  visaoDaCanetaNoPainel(eu, true) === "nenhuma" ? "Você não tem acesso às propostas: o tempo com a caneta vem delas." : null;

/** Proposta do projeto `projeto_id`: quem está escalado, o GP do lado (GP de vendas, PM de projetos) e a gestão. */
export const propostaVisivel = (a: { projeto_id: string }, eu: UsuarioMcp) => recusaDaProposta(a.projeto_id, eu);

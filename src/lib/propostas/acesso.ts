/**
 * Quem vê qual proposta (GAB-98, spec áreas §4.5 e §4.7). A regra é a pura de
 * `auth/visibilidade`; aqui mora o que precisa do banco: saber se a pessoa está
 * ESCALADA. Escalado = responsável do card, dono atual ou ex-dono da caneta
 * (`PropostaCaneta`), quem criou a proposta (os avisos do sino vão para quem
 * criou, e o link do aviso precisa abrir) ou o GP designado do projeto (GAB-95: ele
 * executa o que foi vendido, e pode ter deixado de ser o responsável). Passar a caneta
 * grava o período, então quem recebe passa a ter acesso na mesma transação.
 *
 * Sem import de `./propostas`: o serviço usa este módulo para listar.
 */
import type { Prisma } from "@prisma/client";
import { podeVerProposta, veTodasAsPropostas, type PessoaComId } from "@/lib/auth/visibilidade";
import { podeEscrever } from "@/lib/auth/papeis";
import { db } from "@/lib/db";

export const MENSAGEM_SEM_ACESSO_PROPOSTA = "Você não tem acesso a esta proposta: ela é visível a quem está escalado (responsável do card, quem teve a caneta ou o GP do projeto), ao GP do lado (GP de vendas, PM de projetos) e à gestão.";

/** Filtro das propostas em que a pessoa está escalada. */
function ondeEscalado(usuarioId: string): Prisma.PropostaWhereInput {
  return { OR: [{ projeto: { responsavelId: usuarioId } }, { projeto: { handoff: { gpProjetoId: usuarioId } } }, { canetaComId: usuarioId }, { criadoPorId: usuarioId }, { periodosCaneta: { some: { usuarioId } } }] };
}

/** `where` de `proposta` para uma lista: quem vê todas não filtra; VISUALIZADOR não acha nenhuma. */
export function filtroPropostasVisiveis(p: PessoaComId): Prisma.PropostaWhereInput {
  if (veTodasAsPropostas(p)) return {};
  return podeEscrever(p.papel) ? ondeEscalado(p.id) : { id: { in: [] } };
}

/**
 * A pessoa abre a proposta deste projeto? Sem proposta ainda, vale o responsável:
 * é quem a cria. Quem vê todas passa sem consulta (projeto inexistente é o 404 de quem chamou).
 */
export async function podeVerPropostaDoProjeto(p: PessoaComId, projetoId: string): Promise<boolean> {
  if (veTodasAsPropostas(p)) return true;
  if (!podeEscrever(p.papel)) return false;
  const achado = await db.projeto.findFirst({
    where: { id: projetoId, deletadoEm: null, OR: [{ responsavelId: p.id }, { proposta: { is: ondeEscalado(p.id) } }] },
    select: { id: true },
  });
  return podeVerProposta(p, achado !== null);
}

/** Projetos com proposta que a pessoa vê, entre os dados: para o badge do Kanban (uma consulta só). */
async function projetosComPropostaVisivel(p: PessoaComId, projetoIds: string[]): Promise<Set<string>> {
  if (projetoIds.length === 0) return new Set();
  const linhas = await db.proposta.findMany({ where: { projetoId: { in: projetoIds }, ...filtroPropostasVisiveis(p) }, select: { projetoId: true } });
  return new Set(linhas.map((l) => l.projetoId));
}

/**
 * Antes o motivo de inviável ia para o card ("Outro: Proposta inviável: <motivo>"). Hoje o card
 * grava só "Outro: Proposta inviável" e o motivo fica em `proposta.motivoInviavel`. As linhas
 * antigas continuam no banco: para quem não vê a proposta, o motivo some na leitura.
 */
export function mascararMotivoInviavel(texto: string | null): string | null {
  return texto?.replace(/^(Outro: Proposta inviável): [\s\S]*$/, "$1") ?? null;
}

/** Tira do quadro o que é da proposta, para quem não a vê: status e motivo de inviável. */
export async function ocultarPropostasDoQuadro<C extends { id: string; proposta: unknown; motivoPerda: string | null }, Q extends { cards: C[] }>(quadro: Q, p: PessoaComId): Promise<Q> {
  if (veTodasAsPropostas(p)) return quadro;
  const comProposta = quadro.cards.filter((c) => c.proposta !== null).map((c) => c.id);
  const visiveis = await projetosComPropostaVisivel(p, comProposta);
  return { ...quadro, cards: quadro.cards.map((c) => (visiveis.has(c.id) ? c : { ...c, proposta: null, motivoPerda: mascararMotivoInviavel(c.motivoPerda) })) };
}

type EntradaDaTimeline = { tipo: string; payload: unknown };

/** Entrada da Timeline do card que conta da proposta: eventos dela e o campo "Proposta (link)". */
function entradaDaProposta(t: EntradaDaTimeline): boolean {
  if (t.tipo === "PROPOSTA") return true;
  if (t.tipo !== "CAMPO_ALTERADO" || !t.payload || typeof t.payload !== "object") return false;
  return (t.payload as { campo?: unknown }).campo === "propostaUrl";
}

/** Timeline do card para quem não vê a proposta: sem os eventos dela, e `motivoPerda` antigo mascarado. */
export function timelineSemProposta<T extends EntradaDaTimeline>(timeline: T[]): T[] {
  return timeline
    .filter((t) => !entradaDaProposta(t))
    .map((t) => {
      // GAB-95: a cópia do cronograma fica; a versão da proposta, não.
      if (t.tipo === "EXECUCAO" && (t.payload as { evento?: unknown } | null)?.evento === "cronograma_copiado") {
        const semVersao: Record<string, unknown> = { ...(t.payload as object) };
        delete semVersao.versao;
        return { ...t, payload: semVersao };
      }
      const payload = t.payload as { campo?: unknown; antes?: unknown; depois?: unknown } | null;
      if (t.tipo !== "CAMPO_ALTERADO" || payload?.campo !== "motivoPerda") return t;
      const texto = (v: unknown) => (typeof v === "string" ? mascararMotivoInviavel(v) : v);
      return { ...t, payload: { ...payload, antes: texto(payload.antes), depois: texto(payload.depois) } };
    });
}

/** `string` = recusa, para a action e o MCP; `null` = a pessoa vê a proposta. */
export async function recusaDaProposta(projetoId: string, p: PessoaComId): Promise<string | null> {
  return (await podeVerPropostaDoProjeto(p, projetoId)) ? null : MENSAGEM_SEM_ACESSO_PROPOSTA;
}

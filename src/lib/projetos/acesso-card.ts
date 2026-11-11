/**
 * Área dona do card no servidor (GAB-98, spec áreas §4.4): o ponto único que as
 * actions, as rotas e o MCP chamam antes de mover ou editar um card. Fica FORA de
 * `moverCard`/`editarCard`/`aplicarPatch` de propósito: a automação do WhatsApp
 * (#crm) usa esses núcleos e não é restringida por área neste passo (§4.7).
 *
 * Card que não existe não é recusa: quem chamou segue e o serviço responde
 * CARD_NAO_ENCONTRADO, com a mensagem de sempre.
 */
import { podeCriarCardNoQuadro, podeEditarCard, podeEditarChecklistHandoff, podeTrocarResponsavel, type PessoaComId } from "@/lib/auth/visibilidade";
import type { PessoaComLado } from "@/lib/auth/areas";
import { db } from "@/lib/db";
import { MENSAGEM_SEM_ACESSO_PROPOSTA, podeVerPropostaDoProjeto } from "@/lib/propostas/acesso";
import { MENSAGEM_ERRO_PROJETO } from "./erros";

const MENSAGEM_CRIAR = "Este quadro é de outra área: aqui você acompanha, mas só quem é da área cria card.";
const MENSAGEM_RESPONSAVEL = "Trocar o responsável é com o responsável atual, o GP da área dona (GP de vendas, PM de projetos) ou a gestão da área.";

type OpcoesEdicao = {
  /** Campos que vão mudar: `responsavelId` e `propostaUrl` têm regra própria, além da área. */
  campos?: readonly string[];
  /** Card na lixeira (restaurar): a regra é a mesma, mas ele não está vivo. */
  naLixeira?: boolean;
};

/** `string` = o texto da recusa (o mesmo na tela e no MCP); `null` = pode. */
export async function recusaDeEdicaoNoCard(cardId: string, p: PessoaComId, opts: OpcoesEdicao = {}): Promise<string | null> {
  const achado = await db.projeto.findFirst({
    where: { id: cardId, deletadoEm: opts.naLixeira ? { not: null } : null },
    select: { responsavelId: true, pipeline: { select: { chave: true } } },
  });
  if (!achado) return null;
  const card = { responsavelId: achado.responsavelId, quadro: achado.pipeline.chave };
  if (!podeEditarCard(p, card)) return MENSAGEM_ERRO_PROJETO.FORA_DA_AREA;
  if (opts.campos?.includes("responsavelId") && !podeTrocarResponsavel(p, card)) return MENSAGEM_RESPONSAVEL;
  if (opts.campos?.includes("propostaUrl") && !(await podeVerPropostaDoProjeto(p, cardId))) return MENSAGEM_SEM_ACESSO_PROPOSTA;
  return null;
}

/** Itens e PDF do contrato no Handoff: etapa conjunta, com Vendas (`podeEditarChecklistHandoff`). */
export async function recusaDoChecklistHandoff(cardId: string, p: PessoaComId): Promise<string | null> {
  const achado = await db.projeto.findFirst({ where: { id: cardId, deletadoEm: null }, select: { responsavelId: true, pipeline: { select: { chave: true } } } });
  if (!achado || podeEditarChecklistHandoff(p, { responsavelId: achado.responsavelId, quadro: achado.pipeline.chave })) return null;
  return MENSAGEM_ERRO_PROJETO.FORA_DA_AREA;
}

/** Tirar anexo do card: quem o anexou (de fora também) ou quem edita o card. */
export async function recusaDeExcluirAnexo(anexoId: string, p: PessoaComId): Promise<string | null> {
  const anexo = await db.anexo.findFirst({ where: { id: anexoId, deletadoEm: null }, select: { autorId: true, projetoId: true } });
  if (!anexo || anexo.autorId === p.id) return null;
  return recusaDeEdicaoNoCard(anexo.projetoId, p);
}

/** Card novo no quadro, pelo id do pipeline (tela) ou já pela chave (MCP). */
export async function recusaDeCriarNoQuadro(quadro: { pipelineId: string } | { chave: string }, p: PessoaComLado): Promise<string | null> {
  const chave = "chave" in quadro ? quadro.chave : (await db.pipeline.findUnique({ where: { id: quadro.pipelineId }, select: { chave: true } }))?.chave;
  return !chave || podeCriarCardNoQuadro(p, chave) ? null : MENSAGEM_CRIAR;
}

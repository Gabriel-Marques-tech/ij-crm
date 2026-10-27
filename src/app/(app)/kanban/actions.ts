"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirUsuario } from "@/lib/auth/atual";
import { comTratamento, type Inesperado } from "@/lib/erros/registrar";
import { descricaoSchema, ehCampoEditavel, interpretarCampo } from "@/lib/oportunidades/campos";
import { adicionarNota, criarCard, editarCard, moverCard, type ErroOportunidade } from "@/lib/oportunidades/oportunidades";
import { DETALHE_PERDA_MAX, type DadosTerminal } from "@/lib/oportunidades/terminal-regras";
import { salvarVisualizacaoKanban } from "@/lib/preferencias/servico";

const MENSAGEM: Record<ErroOportunidade, string> = {
  CARD_NAO_ENCONTRADO: "Card não encontrado (pode ter sido excluído). Recarregue a página.",
  PIPELINE_NAO_ENCONTRADO: "Quadro não encontrado.",
  FASE_NAO_ENCONTRADA: "Fase não encontrada. Recarregue a página.",
  FASE_ARQUIVADA: "Essa fase foi arquivada. Recarregue a página.",
  FASE_DE_OUTRO_PIPELINE: "Essa fase é de outro quadro.",
  FASE_TERMINAL: "Não dá para criar card direto numa fase de ganho/perdido. Crie numa fase aberta e mova.",
  CONFLITO_CONCORRENTE: "A fase mudou enquanto você movia. Tente de novo.",
  TITULO_INVALIDO: "Informe um título (até 200 caracteres).",
  RESPONSAVEL_INVALIDO: "Responsável inválido ou inativo.",
  NOTA_INVALIDA: "A nota precisa ter entre 1 e 5000 caracteres.",
  FASE_INICIAL_PROJETOS_INDISPONIVEL:
    "O quadro Projetos está sem a fase “Em execução” (chave em_execucao) ativa, onde nasce o card do projeto. Peça à gestão para restaurá-la.",
  DADOS_TERMINAL_OBRIGATORIOS: "Faltam os dados do fechamento (valor ou motivo). Mova o card de novo para abrir o diálogo.",
  VALOR_FECHADO_INVALIDO: "Valor fechado inválido. Ex.: 12.500,00",
  MOTIVO_PERDA_OBRIGATORIO: "Escolha o motivo da perda.",
  MOTIVO_PERDA_INVALIDO: "Motivo da perda inválido.",
  MOTIVO_PERDA_DETALHE_OBRIGATORIO: "Em “Outro”, descreva o motivo da perda.",
  MOTIVO_PERDA_DETALHE_LONGO: `O detalhe do motivo pode ter até ${DETALHE_PERDA_MAX} caracteres.`,
};

/**
 * `erro` de regra = texto pronto em português. Exceção inesperada vira
 * `{ ok: false, erro: "INESPERADO", ref }` (logada com a ref; ver `registrarErro`).
 */
export type EstadoKanban = { erro?: string; ok?: true; /** id do card criado. */ id?: string } | Inesperado;

const id = z.string().min(1).max(64);

function revalidar(cardId?: string) {
  revalidatePath("/kanban");
  if (cardId) revalidatePath(`/kanban/${cardId}`);
}

/** `descricao`: opcional (formulário do + no Kanban). */
export async function criarCardAction(pipelineId: string, faseId: string, titulo: string, descricao?: string): Promise<EstadoKanban> {
  return comTratamento("kanban.criarCard", async (): Promise<EstadoKanban> => {
    const ator = await exigirUsuario();
    const p = z.object({ pipelineId: id, faseId: id, titulo: z.string().max(1000) }).safeParse({ pipelineId, faseId, titulo });
    if (!p.success) return { erro: "Dados inválidos." };
    const d = descricaoSchema.safeParse(descricao);
    if (!d.success) return { erro: d.error.issues[0].message };
    const r = await criarCard({ ...p.data, descricao: d.data }, ator);
    if (!r.ok) return { erro: MENSAGEM[r.erro] };
    revalidar();
    return { ok: true, id: r.id };
  });
}

// Só a forma (strings curtas); o conteúdo é validado no gancho, dentro da transação.
const dadosTerminal = z
  .object({ valorFechado: z.string().max(50), motivo: z.string().max(50), detalhe: z.string().max(2000) })
  .partial()
  .strict();

/** `dados`: o que o diálogo de ganho/perdido coletou (ver `terminal-regras.ts`). */
export async function moverCardAction(cardId: string, paraFaseId: string, dados?: DadosTerminal): Promise<EstadoKanban> {
  return comTratamento("kanban.moverCard", async (): Promise<EstadoKanban> => {
    const ator = await exigirUsuario();
    if (!id.safeParse(cardId).success || !id.safeParse(paraFaseId).success) return { erro: "Dados inválidos." };
    const d = dadosTerminal.optional().safeParse(dados);
    if (!d.success) return { erro: "Dados inválidos." };
    const r = await moverCard(cardId, paraFaseId, ator, { dadosTerminal: d.data });
    if (!r.ok) return { erro: MENSAGEM[r.erro] };
    revalidar(cardId);
    return { ok: true };
  });
}

export async function editarCampoAction(cardId: string, campo: string, bruto: string): Promise<EstadoKanban> {
  return comTratamento("kanban.editarCampo", async (): Promise<EstadoKanban> => {
    const ator = await exigirUsuario();
    if (!id.safeParse(cardId).success || !ehCampoEditavel(campo) || typeof bruto !== "string" || bruto.length > 10_000) {
      return { erro: "Dados inválidos." };
    }
    const v = interpretarCampo(campo, bruto);
    if (!v.ok) return { erro: v.erro };
    const r = await editarCard(cardId, { [campo]: v.valor }, ator);
    if (!r.ok) return { erro: MENSAGEM[r.erro] };
    revalidar(cardId);
    return { ok: true };
  });
}

export async function adicionarNotaAction(cardId: string, texto: string): Promise<EstadoKanban> {
  return comTratamento("kanban.adicionarNota", async (): Promise<EstadoKanban> => {
    const ator = await exigirUsuario();
    if (!id.safeParse(cardId).success || typeof texto !== "string") return { erro: "Dados inválidos." };
    const r = await adicionarNota(cardId, texto, ator);
    if (!r.ok) return { erro: MENSAGEM[r.erro] };
    revalidar(cardId);
    return { ok: true };
  });
}

/**
 * Visualização do quadro (mostrar vazias, colunas abertas à mão) do usuário
 * DA SESSÃO: não recebe id de usuário, então ninguém grava a de outro. Sem
 * revalidate: a UI já aplicou otimista e o próximo render lê do banco.
 */
export async function salvarVisualizacaoKanbanAction(pipelineChave: string, visualizacao: { mostrarVazias: boolean; abertas: string[] }): Promise<EstadoKanban> {
  return comTratamento("kanban.salvarVisualizacao", async (): Promise<EstadoKanban> => {
    const ator = await exigirUsuario();
    if (!id.safeParse(pipelineChave).success) return { erro: "Dados inválidos." };
    const r = await salvarVisualizacaoKanban(ator.id, pipelineChave, visualizacao);
    if (!r.ok) return { erro: r.erro === "QUADRO_INEXISTENTE" ? "Quadro não encontrado." : "Dados inválidos." };
    return { ok: true };
  });
}

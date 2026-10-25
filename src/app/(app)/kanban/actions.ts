"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirUsuario } from "@/lib/auth/atual";
import { comTratamento, type Inesperado } from "@/lib/erros/registrar";
import { ehCampoEditavel, interpretarCampo } from "@/lib/oportunidades/campos";
import { adicionarNota, criarCard, editarCard, moverCard, type ErroOportunidade } from "@/lib/oportunidades/oportunidades";

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

export async function criarCardAction(pipelineId: string, faseId: string, titulo: string): Promise<EstadoKanban> {
  return comTratamento("kanban.criarCard", async (): Promise<EstadoKanban> => {
    const ator = await exigirUsuario();
    const p = z.object({ pipelineId: id, faseId: id, titulo: z.string().max(1000) }).safeParse({ pipelineId, faseId, titulo });
    if (!p.success) return { erro: "Dados inválidos." };
    const r = await criarCard(p.data, ator);
    if (!r.ok) return { erro: MENSAGEM[r.erro] };
    revalidar();
    return { ok: true, id: r.id };
  });
}

export async function moverCardAction(cardId: string, paraFaseId: string): Promise<EstadoKanban> {
  return comTratamento("kanban.moverCard", async (): Promise<EstadoKanban> => {
    const ator = await exigirUsuario();
    if (!id.safeParse(cardId).success || !id.safeParse(paraFaseId).success) return { erro: "Dados inválidos." };
    const r = await moverCard(cardId, paraFaseId, ator);
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

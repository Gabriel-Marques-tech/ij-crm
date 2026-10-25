"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirUsuario } from "@/lib/auth/atual";
import { comTratamento, type Inesperado } from "@/lib/erros/registrar";
import { marcarAcaoFeita, type ErroFeita } from "@/lib/oportunidades/feita";
import { editarCard } from "@/lib/oportunidades/oportunidades";
import { validarProximaEscolha } from "@/lib/semana/agrupar";

export type EstadoSemana = { erro?: string; ok?: true } | Inesperado;

const MENSAGEM: Record<ErroFeita, string> = {
  CARD_NAO_ENCONTRADO: "Card não encontrado (pode ter sido excluído). Recarregue a página.",
  SEM_PROXIMA_ACAO: "Esse card não tem próxima ação para marcar como feita.",
  ACAO_MUDOU: "A próxima ação desse card mudou enquanto você olhava. Recarregue a página e confira.",
};

const id = z.string().min(1).max(64);
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const esperadoSchema = z.object({ proximaAcao: z.string().max(500).nullable(), dia });
const escolhaSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("nova"), proximaAcao: z.string().max(1000), dia: z.string().max(20) }),
  z.object({ tipo: z.literal("nenhuma") }),
]);

export type Esperado = z.infer<typeof esperadoSchema>;
export type Escolha = z.infer<typeof escolhaSchema>;

function revalidar(cardId: string) {
  revalidatePath("/");
  revalidatePath("/kanban");
  revalidatePath(`/kanban/${cardId}`);
}

/**
 * Marca a próxima ação como feita (NOTA na Timeline) e, na mesma transação,
 * grava a próxima — ou registra que ficou sem, se o usuário escolheu isso.
 */
export async function marcarFeitaAction(cardId: string, esperado: Esperado, escolha: Escolha): Promise<EstadoSemana> {
  return comTratamento("semana.marcarFeita", async (): Promise<EstadoSemana> => {
    const ator = await exigirUsuario();
    const e = esperadoSchema.safeParse(esperado);
    const c = escolhaSchema.safeParse(escolha);
    if (!id.safeParse(cardId).success || !e.success || !c.success) return { erro: "Dados inválidos." };

    let decisao: Parameters<typeof marcarAcaoFeita>[2] = { tipo: "nenhuma" };
    if (c.data.tipo === "nova") {
      const v = validarProximaEscolha(c.data.proximaAcao, c.data.dia, new Date());
      if (!v.ok) return { erro: v.erro };
      decisao = { tipo: "nova", proximaAcao: v.proximaAcao, proximaAcaoEm: v.proximaAcaoEm };
    }
    const r = await marcarAcaoFeita(cardId, e.data, decisao, ator);
    if (!r.ok) return { erro: MENSAGEM[r.erro] };
    revalidar(cardId);
    return { ok: true };
  });
}

/** Card sem próxima ação: define ação + data juntas (um patch, uma transação). */
export async function definirProximaAction(cardId: string, proximaAcao: string, diaBruto: string): Promise<EstadoSemana> {
  return comTratamento("semana.definirProxima", async (): Promise<EstadoSemana> => {
    const ator = await exigirUsuario();
    if (!id.safeParse(cardId).success || typeof proximaAcao !== "string" || typeof diaBruto !== "string" || proximaAcao.length > 1000 || diaBruto.length > 20) {
      return { erro: "Dados inválidos." };
    }
    const v = validarProximaEscolha(proximaAcao, diaBruto, new Date());
    if (!v.ok) return { erro: v.erro };
    const r = await editarCard(cardId, { proximaAcao: v.proximaAcao, proximaAcaoEm: v.proximaAcaoEm }, ator);
    if (!r.ok) return { erro: r.erro === "CARD_NAO_ENCONTRADO" ? MENSAGEM.CARD_NAO_ENCONTRADO : "Não foi possível salvar." };
    revalidar(cardId);
    return { ok: true };
  });
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirEscrita } from "@/lib/auth/atual";
import { comTratamento, type Inesperado } from "@/lib/erros/registrar";
import { criarPrazo, editarPrazo, excluirPrazo, marcarPrazoFeito, type ErroPrazo, type ResultadoPrazo } from "@/lib/prazos/prazos";

export type EstadoPrazoAcao = { erro?: string; ok?: true } | Inesperado;

const MENSAGEM: Record<Exclude<ErroPrazo, "INVALIDO">, string> = {
  PRAZO_NAO_ENCONTRADO: "Prazo não encontrado (pode ter sido excluído). Recarregue a página.",
  SEM_PERMISSAO: "Só o responsável pelo prazo ou a gestão podem mexer nele.",
  RESPONSAVEL_INVALIDO: "Responsável inválido ou inativo.",
  CARD_NAO_ENCONTRADO: "Card não encontrado (pode ter sido excluído). Recarregue a página.",
};

const id = z.string().min(1).max(64);
const dados = z.object({ titulo: z.string().max(1000), dia: z.string().max(20), responsavelId: id });

function responder(r: ResultadoPrazo): EstadoPrazoAcao {
  if (r.ok) {
    revalidatePath("/calendario");
    revalidatePath("/semana");
    revalidatePath("/kanban/[id]", "page");
    return { ok: true };
  }
  return { erro: r.erro === "INVALIDO" ? (r.mensagem ?? "Dados inválidos.") : MENSAGEM[r.erro] };
}

export async function criarPrazoAction(entrada: { titulo: string; dia: string; responsavelId: string; oportunidadeId?: string | null }): Promise<EstadoPrazoAcao> {
  return comTratamento("calendario.criarPrazo", async (): Promise<EstadoPrazoAcao> => {
    const ator = await exigirEscrita();
    const p = dados.extend({ oportunidadeId: id.nullable().optional() }).safeParse(entrada);
    if (!p.success) return { erro: "Dados inválidos." };
    return responder(await criarPrazo(ator, p.data));
  });
}

export async function editarPrazoAction(prazoId: string, entrada: { titulo: string; dia: string; responsavelId: string }): Promise<EstadoPrazoAcao> {
  return comTratamento("calendario.editarPrazo", async (): Promise<EstadoPrazoAcao> => {
    const ator = await exigirEscrita();
    const p = dados.safeParse(entrada);
    if (!id.safeParse(prazoId).success || !p.success) return { erro: "Dados inválidos." };
    return responder(await editarPrazo(ator, prazoId, p.data));
  });
}

export async function concluirPrazoAction(prazoId: string, feito: boolean): Promise<EstadoPrazoAcao> {
  return comTratamento("calendario.concluirPrazo", async (): Promise<EstadoPrazoAcao> => {
    const ator = await exigirEscrita();
    if (!id.safeParse(prazoId).success || typeof feito !== "boolean") return { erro: "Dados inválidos." };
    return responder(await marcarPrazoFeito(ator, prazoId, feito));
  });
}

export async function excluirPrazoAction(prazoId: string): Promise<EstadoPrazoAcao> {
  return comTratamento("calendario.excluirPrazo", async (): Promise<EstadoPrazoAcao> => {
    const ator = await exigirEscrita();
    if (!id.safeParse(prazoId).success) return { erro: "Dados inválidos." };
    return responder(await excluirPrazo(ator, prazoId));
  });
}

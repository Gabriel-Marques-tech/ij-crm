"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { FuncaoProjeto } from "@prisma/client";
import { exigirEscrita } from "@/lib/auth/atual";
import { comTratamento, type Inesperado } from "@/lib/erros/registrar";
import { FUNCOES } from "@/lib/gg/modelo";
import { adicionarAEquipe, MENSAGEM_ERRO_EQUIPE, mudarFuncao, tirarDaEquipe } from "@/lib/projetos/equipe";

export type EstadoEquipe = { ok: true } | { erro: string } | Inesperado;

const id = z.string().min(1).max(64);
const funcao = z.enum(FUNCOES as [FuncaoProjeto, ...FuncaoProjeto[]]);
const INVALIDO: EstadoEquipe = { erro: MENSAGEM_ERRO_EQUIPE.DADOS_INVALIDOS };

function concluir(projetoId: string, r: { ok: true } | { ok: false; erro: keyof typeof MENSAGEM_ERRO_EQUIPE }): EstadoEquipe {
  if (!r.ok) return { erro: MENSAGEM_ERRO_EQUIPE[r.erro] };
  revalidatePath(`/projetos/${projetoId}`, "layout");
  return { ok: true };
}

export async function adicionarAEquipeAction(projetoId: string, usuarioId: string, f: string): Promise<EstadoEquipe> {
  return comTratamento("equipe.adicionar", async (): Promise<EstadoEquipe> => {
    const ator = await exigirEscrita();
    const p = z.tuple([id, id, funcao]).safeParse([projetoId, usuarioId, f]);
    if (!p.success) return INVALIDO;
    return concluir(projetoId, await adicionarAEquipe(projetoId, usuarioId, p.data[2], ator));
  });
}

export async function mudarFuncaoAction(projetoId: string, membroEquipeId: string, f: string): Promise<EstadoEquipe> {
  return comTratamento("equipe.funcao", async (): Promise<EstadoEquipe> => {
    const ator = await exigirEscrita();
    const p = z.tuple([id, id, funcao]).safeParse([projetoId, membroEquipeId, f]);
    if (!p.success) return INVALIDO;
    return concluir(projetoId, await mudarFuncao(projetoId, membroEquipeId, p.data[2], ator));
  });
}

export async function tirarDaEquipeAction(projetoId: string, membroEquipeId: string): Promise<EstadoEquipe> {
  return comTratamento("equipe.tirar", async (): Promise<EstadoEquipe> => {
    const ator = await exigirEscrita();
    if (!id.safeParse(projetoId).success || !id.safeParse(membroEquipeId).success) return INVALIDO;
    return concluir(projetoId, await tirarDaEquipe(projetoId, membroEquipeId, ator));
  });
}

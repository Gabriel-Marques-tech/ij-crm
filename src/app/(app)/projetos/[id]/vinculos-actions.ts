"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirEscrita } from "@/lib/auth/atual";
import { comTratamento } from "@/lib/erros/registrar";
import { criarContato } from "@/lib/contatos/contatos";
import { criarEmpresa } from "@/lib/empresas/empresas";
import { MENSAGEM_VINCULO, mensagemFalhaContato, mensagemFalhaEmpresa, type EstadoEntidade } from "@/lib/entidades/mensagens";
import { db } from "@/lib/db";
import { ehCampoVinculo, vincularAoCard } from "@/lib/projetos/vinculos";

const id = z.string().min(1).max(64);

function revalidar(cardId: string) {
  revalidatePath(`/projetos/${cardId}`);
  revalidatePath("/kanban");
  revalidatePath("/empresas", "layout");
  revalidatePath("/contatos", "layout");
}

/** Vincula (`alvoId`) ou desvincula (`null`) empresa/contato do card. */
export async function vincularAction(cardId: string, campo: string, alvoId: string | null): Promise<EstadoEntidade> {
  return comTratamento("kanban.vincular", async (): Promise<EstadoEntidade> => {
    const ator = await exigirEscrita();
    if (!id.safeParse(cardId).success || !ehCampoVinculo(campo) || (alvoId !== null && !id.safeParse(alvoId).success)) return { erro: "Dados inválidos." };
    const r = await vincularAoCard(cardId, campo, alvoId, ator);
    if (!r.ok) return { erro: MENSAGEM_VINCULO[r.erro] };
    revalidar(cardId);
    return { ok: true };
  });
}

/** "Criar empresa X" no autocomplete do card: cria só com o nome e vincula. */
export async function criarEVincularEmpresaAction(cardId: string, nome: string): Promise<EstadoEntidade> {
  return comTratamento("kanban.criarEmpresa", async (): Promise<EstadoEntidade> => {
    const ator = await exigirEscrita();
    if (!id.safeParse(cardId).success || typeof nome !== "string" || nome.length > 1000) return { erro: "Dados inválidos." };
    const card = await db.projeto.findFirst({ where: { id: cardId, deletadoEm: null }, select: { id: true } });
    if (!card) return { erro: MENSAGEM_VINCULO.CARD_NAO_ENCONTRADO };
    const e = await criarEmpresa({ nome });
    if (!e.ok) return mensagemFalhaEmpresa(e);
    const r = await vincularAoCard(cardId, "empresa", e.id, ator);
    if (!r.ok) return { erro: MENSAGEM_VINCULO[r.erro] };
    revalidar(cardId);
    return { ok: true, id: e.id };
  });
}

const NovoContato = z.object({
  nome: z.string().max(1000),
  telefone: z.string().max(200).optional(),
  email: z.string().max(200).optional(),
  /** Só a empresa ATUAL do card (checkbox explícito na UI); qualquer outra é recusada. */
  empresaId: id.nullish(),
});

/**
 * Cria contato inline e vincula ao card. O contato só nasce numa empresa se o
 * usuário marcou "Vincular à empresa <nome>" — e só a empresa viva do card.
 * Telefone/email que já são de alguém → nada é criado; a resposta traz
 * `duplicado` para a UI perguntar "vincular <dono>?".
 */
export async function criarEVincularContatoAction(cardId: string, dados: z.input<typeof NovoContato>): Promise<EstadoEntidade> {
  return comTratamento("kanban.criarContato", async (): Promise<EstadoEntidade> => {
    const ator = await exigirEscrita();
    const p = NovoContato.safeParse(dados);
    if (!id.safeParse(cardId).success || !p.success) return { erro: "Dados inválidos." };
    const card = await db.projeto.findFirst({ where: { id: cardId, deletadoEm: null }, select: { empresaId: true } });
    if (!card) return { erro: MENSAGEM_VINCULO.CARD_NAO_ENCONTRADO };
    if (p.data.empresaId && p.data.empresaId !== card.empresaId) return { erro: "A empresa do card mudou. Recarregue a página." };
    const c = await criarContato({ nome: p.data.nome, empresaId: p.data.empresaId ?? null, pontos: [p.data.telefone ?? "", p.data.email ?? ""] });
    if (!c.ok) return mensagemFalhaContato(c);
    const r = await vincularAoCard(cardId, "contato", c.id, ator);
    if (!r.ok) return { erro: MENSAGEM_VINCULO[r.erro] };
    revalidar(cardId);
    return { ok: true, id: c.id };
  });
}

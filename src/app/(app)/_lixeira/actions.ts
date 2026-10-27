"use server";

/**
 * Server actions da lixeira e do merge (GAB-36). Papel conferido aqui
 * (`exigirPapel` → /403) E no serviço (`SEM_PERMISSAO`): vendedor não
 * restaura, não mescla, não apaga — nem chamando a action direto.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { exigirPapel, exigirUsuario } from "@/lib/auth/atual";
import { comTratamento, type Inesperado } from "@/lib/erros/registrar";
import { apagarCardDefinitivo, excluirCard, restaurarCard, type ResultadoLixeira } from "@/lib/lixeira/cards";
import { apagarEntidadeDefinitivo, excluirEntidade, restaurarEntidade } from "@/lib/lixeira/entidades";
import { mensagemLixeira } from "@/lib/lixeira/regras";
import { desfazerMerge, mesclar, previaMerge, type PreviaMerge } from "@/lib/merge/merge";

export type EstadoLixeira = { ok?: true; erro?: string; previa?: PreviaMerge } | Inesperado;

const id = z.string().min(1).max(64);
const tipo = z.enum(["contato", "empresa"]);
const confirmacao = z.string().max(1000);
const LISTA = { contato: "/contatos", empresa: "/empresas" } as const;

function revalidarTudo() {
  // Lixeira/merge mexem em visibilidade em todas as telas: lista, detalhe, Kanban, Minha Semana.
  revalidatePath("/", "layout");
}

function responder(r: ResultadoLixeira<object>): EstadoLixeira {
  if (!r.ok) return { erro: mensagemLixeira(r) };
  revalidarTudo();
  return { ok: true };
}

/** Sucesso → redireciona para o quadro (o detalhe do card deixa de existir para as visões). */
export async function excluirCardAction(cardId: string, quadro: string): Promise<EstadoLixeira> {
  return comTratamento("lixeira.excluirCard", async (): Promise<EstadoLixeira> => {
    const ator = await exigirUsuario();
    if (!id.safeParse(cardId).success || !/^[a-z0-9_]{1,64}$/.test(quadro)) return { erro: "Dados inválidos." };
    const r = responder(await excluirCard(cardId, ator));
    if ("ok" in r && r.ok) redirect(`/kanban?quadro=${quadro}`);
    return r;
  });
}

export async function restaurarCardAction(cardId: string, faseId: string | null): Promise<EstadoLixeira> {
  return comTratamento("lixeira.restaurarCard", async (): Promise<EstadoLixeira> => {
    const ator = await exigirPapel("GESTOR");
    if (!id.safeParse(cardId).success || (faseId !== null && !id.safeParse(faseId).success)) return { erro: "Dados inválidos." };
    return responder(await restaurarCard(cardId, ator, { faseId }));
  });
}

export async function apagarCardAction(cardId: string, texto: string): Promise<EstadoLixeira> {
  return comTratamento("lixeira.apagarCard", async (): Promise<EstadoLixeira> => {
    const ator = await exigirPapel("ADMIN");
    if (!id.safeParse(cardId).success || !confirmacao.safeParse(texto).success) return { erro: "Dados inválidos." };
    return responder(await apagarCardDefinitivo(cardId, ator, texto));
  });
}

export async function excluirEntidadeAction(t: string, entidadeId: string): Promise<EstadoLixeira> {
  return comTratamento("lixeira.excluirEntidade", async (): Promise<EstadoLixeira> => {
    const ator = await exigirPapel("GESTOR");
    const p = z.object({ t: tipo, entidadeId: id }).safeParse({ t, entidadeId });
    if (!p.success) return { erro: "Dados inválidos." };
    const r = responder(await excluirEntidade(p.data.t, p.data.entidadeId, ator));
    if ("ok" in r && r.ok) redirect(LISTA[p.data.t]);
    return r;
  });
}

export async function restaurarEntidadeAction(t: string, entidadeId: string): Promise<EstadoLixeira> {
  return comTratamento("lixeira.restaurarEntidade", async (): Promise<EstadoLixeira> => {
    const ator = await exigirPapel("GESTOR");
    const p = z.object({ t: tipo, entidadeId: id }).safeParse({ t, entidadeId });
    if (!p.success) return { erro: "Dados inválidos." };
    return responder(await restaurarEntidade(p.data.t, p.data.entidadeId, ator));
  });
}

export async function apagarEntidadeAction(t: string, entidadeId: string, texto: string): Promise<EstadoLixeira> {
  return comTratamento("lixeira.apagarEntidade", async (): Promise<EstadoLixeira> => {
    const ator = await exigirPapel("ADMIN");
    const p = z.object({ t: tipo, entidadeId: id, texto: confirmacao }).safeParse({ t, entidadeId, texto });
    if (!p.success) return { erro: "Dados inválidos." };
    return responder(await apagarEntidadeDefinitivo(p.data.t, p.data.entidadeId, ator, p.data.texto));
  });
}

export async function previaMergeAction(t: string, principalId: string, perdedorId: string): Promise<EstadoLixeira> {
  return comTratamento("merge.previa", async (): Promise<EstadoLixeira> => {
    const ator = await exigirPapel("GESTOR");
    const p = z.object({ t: tipo, principalId: id, perdedorId: id }).safeParse({ t, principalId, perdedorId });
    if (!p.success) return { erro: "Dados inválidos." };
    const r = await previaMerge(p.data.t, p.data.principalId, p.data.perdedorId, ator);
    return r.ok ? { ok: true, previa: r.previa } : { erro: mensagemLixeira(r) };
  });
}

export async function mesclarAction(t: string, principalId: string, perdedorId: string): Promise<EstadoLixeira> {
  return comTratamento("merge.mesclar", async (): Promise<EstadoLixeira> => {
    const ator = await exigirPapel("GESTOR");
    const p = z.object({ t: tipo, principalId: id, perdedorId: id }).safeParse({ t, principalId, perdedorId });
    if (!p.success) return { erro: "Dados inválidos." };
    const r = responder(await mesclar(p.data.t, p.data.principalId, p.data.perdedorId, ator));
    // O perdedor deixa de ter página própria: vai para o principal, que agora mostra os dois.
    if ("ok" in r && r.ok) redirect(`${LISTA[p.data.t]}/${p.data.principalId}`);
    return r;
  });
}

export async function desfazerMergeAction(t: string, perdedorId: string): Promise<EstadoLixeira> {
  return comTratamento("merge.desfazer", async (): Promise<EstadoLixeira> => {
    const ator = await exigirPapel("GESTOR");
    const p = z.object({ t: tipo, perdedorId: id }).safeParse({ t, perdedorId });
    if (!p.success) return { erro: "Dados inválidos." };
    return responder(await desfazerMerge(p.data.t, p.data.perdedorId, ator));
  });
}

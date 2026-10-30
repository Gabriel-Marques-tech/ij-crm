"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirEscrita, exigirUsuario } from "@/lib/auth/atual";
import { comTratamento, type Inesperado } from "@/lib/erros/registrar";
import { ehCampoContato } from "@/lib/entidades/campos";
import { mensagemFalhaContato, type EstadoEntidade } from "@/lib/entidades/mensagens";
import {
  adicionarPonto,
  buscarContatosPorNome,
  criarContato,
  definirEmpresaDoContato,
  editarContato,
  removerPonto,
  type OpcaoContato,
} from "@/lib/contatos/contatos";

const id = z.string().min(1).max(64);
const texto = z.string().max(10_000);

function revalidar(contatoId?: string) {
  revalidatePath("/contatos");
  if (contatoId) revalidatePath(`/contatos/${contatoId}`);
  // Detalhe de empresa lista contatos e pontos.
  revalidatePath("/empresas/[id]", "page");
}

const NovoContato = z.object({
  nome: texto,
  empresaId: id.nullish(),
  telefone: z.string().max(200).optional(),
  email: z.string().max(200).optional(),
});

export async function criarContatoAction(dados: z.input<typeof NovoContato>): Promise<EstadoEntidade> {
  return comTratamento("contatos.criar", async (): Promise<EstadoEntidade> => {
    await exigirEscrita();
    const p = NovoContato.safeParse(dados);
    if (!p.success) return { erro: "Dados inválidos." };
    const r = await criarContato({ nome: p.data.nome, empresaId: p.data.empresaId, pontos: [p.data.telefone ?? "", p.data.email ?? ""] });
    if (!r.ok) return mensagemFalhaContato(r);
    revalidar();
    return { ok: true, id: r.id };
  });
}

export async function editarContatoCampoAction(contatoId: string, campo: string, bruto: string): Promise<EstadoEntidade> {
  return comTratamento("contatos.editarCampo", async (): Promise<EstadoEntidade> => {
    await exigirEscrita();
    if (!id.safeParse(contatoId).success || !ehCampoContato(campo) || !texto.safeParse(bruto).success) return { erro: "Dados inválidos." };
    const r = await editarContato(contatoId, campo, bruto);
    if (!r.ok) return mensagemFalhaContato(r);
    revalidar(contatoId);
    revalidatePath("/projetos/[id]", "page");
    return { ok: true };
  });
}

export async function definirEmpresaDoContatoAction(contatoId: string, empresaId: string | null): Promise<EstadoEntidade> {
  return comTratamento("contatos.definirEmpresa", async (): Promise<EstadoEntidade> => {
    await exigirEscrita();
    if (!id.safeParse(contatoId).success || (empresaId !== null && !id.safeParse(empresaId).success)) return { erro: "Dados inválidos." };
    const r = await definirEmpresaDoContato(contatoId, empresaId);
    if (!r.ok) return mensagemFalhaContato(r);
    revalidar(contatoId);
    return { ok: true };
  });
}

export async function adicionarPontoAction(contatoId: string, tipo: string, bruto: string): Promise<EstadoEntidade> {
  return comTratamento("contatos.adicionarPonto", async (): Promise<EstadoEntidade> => {
    await exigirEscrita();
    if (!id.safeParse(contatoId).success || (tipo !== "TELEFONE" && tipo !== "EMAIL") || typeof bruto !== "string" || bruto.length > 200) {
      return { erro: "Dados inválidos." };
    }
    const r = await adicionarPonto(contatoId, bruto, tipo);
    if (!r.ok) return mensagemFalhaContato(r);
    revalidar(contatoId);
    return { ok: true };
  });
}

export async function removerPontoAction(contatoId: string, pontoId: string): Promise<EstadoEntidade> {
  return comTratamento("contatos.removerPonto", async (): Promise<EstadoEntidade> => {
    await exigirEscrita();
    if (!id.safeParse(contatoId).success || !id.safeParse(pontoId).success) return { erro: "Dados inválidos." };
    const r = await removerPonto(contatoId, pontoId);
    if (!r.ok) return mensagemFalhaContato(r);
    revalidar(contatoId);
    return { ok: true };
  });
}

export type RespostaBuscaContatos = { ok: true; opcoes: OpcaoContato[] } | { ok?: false; erro: string } | Inesperado;

/** Autocomplete por nome — só para exibir opções; o vínculo é sempre explícito. */
export async function buscarContatosAction(q: string): Promise<RespostaBuscaContatos> {
  return comTratamento("contatos.buscar", async (): Promise<RespostaBuscaContatos> => {
    await exigirUsuario();
    if (typeof q !== "string" || q.length > 200) return { erro: "Busca inválida." };
    return { ok: true, opcoes: await buscarContatosPorNome(q) };
  });
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirEscrita, exigirUsuario } from "@/lib/auth/atual";
import { comTratamento, type Inesperado } from "@/lib/erros/registrar";
import { ehCampoEmpresa } from "@/lib/entidades/campos";
import { mensagemFalhaEmpresa, type EstadoEntidade } from "@/lib/entidades/mensagens";
import { buscarEmpresasPorNome, criarEmpresa, editarEmpresa, type OpcaoEmpresa } from "@/lib/empresas/empresas";

const id = z.string().min(1).max(64);
const texto = z.string().max(10_000);

function revalidar(empresaId?: string) {
  revalidatePath("/empresas");
  if (empresaId) revalidatePath(`/empresas/${empresaId}`);
}

export async function criarEmpresaAction(dados: { nome: string; cnpj?: string; dominioEmail?: string }): Promise<EstadoEntidade> {
  return comTratamento("empresas.criar", async (): Promise<EstadoEntidade> => {
    await exigirEscrita();
    const p = z.object({ nome: texto, cnpj: texto.optional(), dominioEmail: texto.optional() }).safeParse(dados);
    if (!p.success) return { erro: "Dados inválidos." };
    const r = await criarEmpresa(p.data);
    if (!r.ok) return mensagemFalhaEmpresa(r);
    revalidar();
    return { ok: true, id: r.id };
  });
}

/** Feita para `.bind(null, empresaId, campo)` no servidor: o cliente só manda o valor. */
export async function editarEmpresaCampoAction(empresaId: string, campo: string, bruto: string): Promise<EstadoEntidade> {
  return comTratamento("empresas.editarCampo", async (): Promise<EstadoEntidade> => {
    await exigirEscrita();
    if (!id.safeParse(empresaId).success || !ehCampoEmpresa(campo) || !texto.safeParse(bruto).success) return { erro: "Dados inválidos." };
    const r = await editarEmpresa(empresaId, campo, bruto);
    if (!r.ok) return mensagemFalhaEmpresa(r);
    revalidar(empresaId);
    revalidatePath("/projetos/[id]", "page");
    return { ok: true };
  });
}

export type RespostaBuscaEmpresas = { ok: true; opcoes: OpcaoEmpresa[] } | { ok?: false; erro: string } | Inesperado;

/** Autocomplete por nome — só para exibir opções; o vínculo é sempre explícito. */
export async function buscarEmpresasAction(q: string): Promise<RespostaBuscaEmpresas> {
  return comTratamento("empresas.buscar", async (): Promise<RespostaBuscaEmpresas> => {
    await exigirUsuario();
    if (typeof q !== "string" || q.length > 200) return { erro: "Busca inválida." };
    return { ok: true, opcoes: await buscarEmpresasPorNome(q) };
  });
}

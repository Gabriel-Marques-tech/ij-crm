"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirUsuario, idSessaoAtual } from "@/lib/auth/atual";
import { MENSAGEM_CONTA, trocarEmail, trocarSenha } from "@/lib/auth/conta";
import { encerrarOutrasSessoes, encerrarSessaoDoUsuario } from "@/lib/auth/sessao";
import { atualizarUsuario } from "@/lib/auth/usuarios";
import { comTratamentoForm } from "@/lib/erros/registrar";
import { removerFoto, salvarFoto } from "@/lib/perfil/foto";
import { FOTO_MAX_BYTES, MENSAGEM_ERRO_FOTO } from "@/lib/perfil/imagem";
import { salvarPaginaInicial } from "@/lib/preferencias/servico";

export type EstadoPerfil = { erro?: string; ok?: true } | undefined;

const schema = z.object({
  nome: z.string().trim().min(2, "Nome muito curto."),
  telefone: z.string().trim(),
});

/** Qualquer usuário logado edita o próprio nome e telefone (papel/ativo não passam por aqui). */
export async function editarMeuPerfilAction(_prev: EstadoPerfil, form: FormData): Promise<EstadoPerfil> {
  return comTratamentoForm("perfil.editarMeuPerfil", async (): Promise<EstadoPerfil> => {
    const eu = await exigirUsuario();
    const parsed = schema.safeParse({ nome: form.get("nome"), telefone: form.get("telefone") ?? "" });
    if (!parsed.success) return { erro: parsed.error.issues[0]?.message ?? "Dados inválidos." };
    const r = await atualizarUsuario(eu.id, parsed.data, eu);
    if (!r.ok) {
      return {
        erro:
          r.erro === "TELEFONE_INVALIDO"
            ? "Telefone inválido. Use DDD + número."
            : r.erro === "TELEFONE_EM_USO"
              ? "Esse telefone já está em outro usuário."
              : "Não foi possível salvar.",
      };
    }
    revalidatePath("/perfil");
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

// ---------------------------------------------------------------- conta (GAB-43)
// Tudo aqui age SÓ sobre o usuário da sessão: nenhuma action recebe usuarioId.

export async function trocarSenhaAction(_prev: EstadoPerfil, form: FormData): Promise<EstadoPerfil> {
  return comTratamentoForm("perfil.trocarSenha", async (): Promise<EstadoPerfil> => {
    const eu = await exigirUsuario();
    const r = await trocarSenha(eu.id, await idSessaoAtual(), {
      atual: String(form.get("atual") ?? ""),
      nova: String(form.get("nova") ?? ""),
      confirmacao: String(form.get("confirmacao") ?? ""),
    });
    if (!r.ok) return { erro: MENSAGEM_CONTA[r.erro] };
    revalidatePath("/perfil");
    return { ok: true };
  });
}

export async function trocarEmailAction(_prev: EstadoPerfil, form: FormData): Promise<EstadoPerfil> {
  return comTratamentoForm("perfil.trocarEmail", async (): Promise<EstadoPerfil> => {
    const eu = await exigirUsuario();
    const r = await trocarEmail(eu.id, { senha: String(form.get("senha") ?? ""), email: String(form.get("email") ?? "") });
    if (!r.ok) return { erro: MENSAGEM_CONTA[r.erro] };
    revalidatePath("/perfil");
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

export async function enviarFotoAction(form: FormData): Promise<EstadoPerfil> {
  return comTratamentoForm("perfil.enviarFoto", async (): Promise<EstadoPerfil> => {
    const eu = await exigirUsuario();
    const arquivo = form.get("foto");
    if (!(arquivo instanceof Blob)) return { erro: MENSAGEM_ERRO_FOTO.VAZIA };
    // Tamanho conferido ANTES de ler o corpo inteiro.
    if (arquivo.size > FOTO_MAX_BYTES) return { erro: MENSAGEM_ERRO_FOTO.GRANDE_DEMAIS };
    const r = await salvarFoto(eu.id, new Uint8Array(await arquivo.arrayBuffer()));
    if (!r.ok) return { erro: MENSAGEM_ERRO_FOTO[r.erro] };
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

export async function removerFotoAction(): Promise<EstadoPerfil> {
  return comTratamentoForm("perfil.removerFoto", async (): Promise<EstadoPerfil> => {
    const eu = await exigirUsuario();
    await removerFoto(eu.id);
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

export async function encerrarSessaoAction(sessaoId: string): Promise<EstadoPerfil> {
  return comTratamentoForm("perfil.encerrarSessao", async (): Promise<EstadoPerfil> => {
    const eu = await exigirUsuario();
    if (typeof sessaoId !== "string" || !/^[0-9a-f]{64}$/.test(sessaoId)) return { erro: "Sessão inválida." };
    if (sessaoId === (await idSessaoAtual())) return { erro: "Para sair deste navegador, use o botão Sair." };
    // O where inclui o usuarioId da sessão: id de sessão de outra pessoa não tem efeito.
    await encerrarSessaoDoUsuario(eu.id, sessaoId);
    revalidatePath("/perfil");
    return { ok: true };
  });
}

export async function encerrarOutrasSessoesAction(): Promise<EstadoPerfil> {
  return comTratamentoForm("perfil.encerrarOutrasSessoes", async (): Promise<EstadoPerfil> => {
    const eu = await exigirUsuario();
    const atual = await idSessaoAtual();
    if (!atual) return { erro: "Sessão atual não encontrada. Entre de novo." };
    await encerrarOutrasSessoes(eu.id, atual);
    revalidatePath("/perfil");
    return { ok: true };
  });
}

export async function salvarPaginaInicialAction(_prev: EstadoPerfil, form: FormData): Promise<EstadoPerfil> {
  return comTratamentoForm("perfil.salvarPaginaInicial", async (): Promise<EstadoPerfil> => {
    const eu = await exigirUsuario();
    const r = await salvarPaginaInicial(eu.id, form.get("inicio"));
    if (!r.ok) return { erro: "Escolha uma das opções." };
    revalidatePath("/perfil");
    return { ok: true };
  });
}

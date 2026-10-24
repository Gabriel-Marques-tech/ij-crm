"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirUsuario } from "@/lib/auth/atual";
import { atualizarUsuario } from "@/lib/auth/usuarios";
import { comTratamentoForm } from "@/lib/erros/registrar";

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

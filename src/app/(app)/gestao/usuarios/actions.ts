"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirPapel } from "@/lib/auth/atual";
import { atualizarUsuario, criarConvite, reemitirConvite, type ErroUsuario } from "@/lib/auth/usuarios";
import { MENSAGEM_REDEFINICAO, gerarLinkRedefinicao } from "@/lib/auth/redefinicao";
import { comTratamentoForm } from "@/lib/erros/registrar";

const MENSAGEM: Record<ErroUsuario, string> = {
  PAPEL_NAO_PERMITIDO: "Você não pode atribuir esse papel.",
  EMAIL_INVALIDO: "Email inválido.",
  EMAIL_EM_USO: "Já existe um usuário com esse email.",
  TELEFONE_INVALIDO: "Telefone inválido. Use DDD + número.",
  TELEFONE_EM_USO: "Esse telefone já está em outro usuário.",
  CONVITE_INVALIDO: "Convite inválido.",
  SENHA_FRACA: "Senha fraca.",
  CREDENCIAIS_INVALIDAS: "Credenciais inválidas.",
  NAO_PODE_ALTERAR_A_SI: "Você não pode alterar seu próprio papel ou se desativar.",
  USUARIO_NAO_ENCONTRADO: "Usuário não encontrado.",
};

export type EstadoConvite = { erro?: string; link?: string; expiraEm?: string } | undefined;

const papelSchema = z.enum(["ADMIN", "GESTOR", "VENDEDOR", "PROJETOS", "VISUALIZADOR"]);
// "" = nenhuma área. Coerência com o papel é resolvida no serviço (lib/auth/areas).
const areaSchema = z.enum(["VENDAS", "PROJETOS", ""]).transform((a) => (a === "" ? null : a));
const cargosSchema = z.array(z.enum(["GP"]));

const conviteSchema = z.object({
  nome: z.string().trim().min(2, "Nome muito curto."),
  email: z.string().trim().min(3),
  papel: papelSchema,
  telefone: z.string().trim().optional(),
  area: areaSchema.optional(),
  cargos: cargosSchema,
});

/**
 * Campos de lado do form (CamposLado): `area` + checkboxes `cargos`. O hidden
 * `ladoNoForm` diferencia "nenhum cargo marcado" de "form sem esses campos"
 * (editar a si mesmo não mostra lado/cargo).
 */
function ladoDoForm(form: FormData): { area?: unknown; cargos?: unknown[] } {
  if (form.get("ladoNoForm") !== "1") return {};
  return { area: form.get("area") ?? "", cargos: form.getAll("cargos") };
}

function linkConvite(token: string, caminho: "convite" | "redefinir" = "convite"): string {
  const base = process.env.APP_URL?.replace(/\/+$/, "");
  if (!base) {
    // Fail-closed em produção (§4.6): link errado = convite inutilizável em silêncio.
    if (process.env.NODE_ENV === "production") throw new Error("APP_URL não configurada");
    return `http://localhost:3000/${caminho}/${token}`;
  }
  return `${base}/${caminho}/${token}`;
}

/** Link de redefinição de senha (GAB-43): 1 h, uso único, mostrado uma vez. Gestor não gera para admin. */
export async function gerarLinkRedefinicaoAction(usuarioId: string): Promise<EstadoConvite> {
  return comTratamentoForm("gestao.usuarios.gerarLinkRedefinicao", async (): Promise<EstadoConvite> => {
    const ator = await exigirPapel("GESTOR");
    if (typeof usuarioId !== "string" || !usuarioId) return { erro: MENSAGEM_REDEFINICAO.USUARIO_NAO_ENCONTRADO };
    const r = await gerarLinkRedefinicao(usuarioId, ator);
    if (!r.ok) return { erro: MENSAGEM_REDEFINICAO[r.erro] };
    revalidatePath("/gestao/usuarios");
    return { link: linkConvite(r.token, "redefinir"), expiraEm: r.expiraEm.toISOString() };
  });
}

export async function criarConviteAction(_prev: EstadoConvite, form: FormData): Promise<EstadoConvite> {
  return comTratamentoForm("gestao.usuarios.criarConvite", async (): Promise<EstadoConvite> => {
    const ator = await exigirPapel("GESTOR");
    const parsed = conviteSchema.safeParse({
      nome: form.get("nome"),
      email: form.get("email"),
      papel: form.get("papel"),
      telefone: form.get("telefone") ?? undefined,
      cargos: [],
      ...ladoDoForm(form),
    });
    if (!parsed.success) return { erro: parsed.error.issues[0]?.message ?? "Dados inválidos." };
    const r = await criarConvite(parsed.data, ator);
    if (!r.ok) return { erro: MENSAGEM[r.erro] };
    revalidatePath("/gestao/usuarios");
    return { link: linkConvite(r.token), expiraEm: r.expiraEm.toISOString() };
  });
}

export async function reemitirConviteAction(usuarioId: string): Promise<EstadoConvite> {
  return comTratamentoForm("gestao.usuarios.reemitirConvite", async (): Promise<EstadoConvite> => {
    const ator = await exigirPapel("GESTOR");
    const r = await reemitirConvite(usuarioId, ator);
    if (!r.ok) return { erro: MENSAGEM[r.erro] };
    revalidatePath("/gestao/usuarios");
    return { link: linkConvite(r.token), expiraEm: r.expiraEm.toISOString() };
  });
}

const edicaoSchema = z.object({
  usuarioId: z.string().min(1),
  nome: z.string().trim().min(2).optional(),
  telefone: z.string().trim().optional(),
  papel: papelSchema.optional(),
  area: areaSchema.optional(),
  cargos: cargosSchema.optional(),
});

export type EstadoEdicao = { erro?: string; ok?: true } | undefined;

export async function editarUsuarioAction(_prev: EstadoEdicao, form: FormData): Promise<EstadoEdicao> {
  return comTratamentoForm("gestao.usuarios.editarUsuario", async (): Promise<EstadoEdicao> => {
    const ator = await exigirPapel("GESTOR");
    const parsed = edicaoSchema.safeParse({
      usuarioId: form.get("usuarioId"),
      nome: form.get("nome") ?? undefined,
      telefone: form.get("telefone") ?? undefined,
      papel: form.get("papel") ?? undefined,
      ...ladoDoForm(form),
    });
    if (!parsed.success) return { erro: "Dados inválidos." };
    const { usuarioId, ...dados } = parsed.data;
    const r = await atualizarUsuario(usuarioId, dados, ator);
    if (!r.ok) return { erro: MENSAGEM[r.erro] };
    revalidatePath("/gestao/usuarios");
    return { ok: true };
  });
}

export async function alternarAtivoAction(usuarioId: string, ativo: boolean): Promise<EstadoEdicao> {
  return comTratamentoForm("gestao.usuarios.alternarAtivo", async (): Promise<EstadoEdicao> => {
    const ator = await exigirPapel("GESTOR");
    const r = await atualizarUsuario(usuarioId, { ativo }, ator);
    if (!r.ok) return { erro: MENSAGEM[r.erro] };
    revalidatePath("/gestao/usuarios");
    return { ok: true };
  });
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirPapel } from "@/lib/auth/atual";
import { atualizarUsuario, reemitirConvite, type ErroUsuario } from "@/lib/auth/usuarios";
import { adicionarPosicaoAoUsuario, cadastrarPessoa, encerrarOcupacaoDoUsuario, type ErroCadastro, type FalhaCadastro, type FichaLigada } from "@/lib/auth/cadastro";
import { MENSAGEM_ERRO_ORG } from "@/lib/gg/organizacao";
import { MENSAGEM_REDEFINICAO, gerarLinkRedefinicao } from "@/lib/auth/redefinicao";
import { desligarGoogle, type ErroDesligarGoogle } from "@/lib/auth/google-login";
import { comTratamentoForm } from "@/lib/erros/registrar";
import { normalizarEmail } from "@/lib/normalizacao";

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

/** Cadastro único (GAB-105): conta + membro do G&G + posição. Mensagens do G&G ajustadas ao contexto da Gestão. */
const MENSAGEM_CADASTRO: Record<ErroCadastro, string> = {
  ...MENSAGEM_ERRO_ORG,
  ...MENSAGEM,
  SEM_PERMISSAO: "Você não pode atribuir posição a esta pessoa.",
  NAO_ENCONTRADO: "Posição ou ocupação não encontrada (pode ter sido desativada ou já encerrada). Recarregue a página.",
  JA_OCUPA: "Essa pessoa já ocupa essa posição.",
};

/** Membro sem e-mail e sem conta com o mesmo nome no G&G: a tela pergunta se é a mesma pessoa. */
export type Homonimo = { id: string; nome: string };

export type EstadoConvite = { erro?: string; link?: string; expiraEm?: string; email?: string; homonimo?: Homonimo; fichaLigada?: FichaLigada } | undefined;

function falha(r: FalhaCadastro): { erro: string; homonimo?: Homonimo } {
  if (r.homonimo) return { erro: `Já existe "${r.homonimo.nome}" sem e-mail no G&G. É a mesma pessoa?`, homonimo: r.homonimo };
  return { erro: r.detalhe ?? MENSAGEM_CADASTRO[r.erro] };
}

/** Resposta da tela ao homônimo: `ligarMembroId` (é a mesma pessoa) ou `criarMembroNovo=1` (é outra). */
function confirmacaoDoForm(form: FormData) {
  const ligar = form.get("ligarMembroId");
  return { ligarMembroId: typeof ligar === "string" && ligar && ligar.length <= 64 ? ligar : null, criarMembroNovo: form.get("criarMembroNovo") === "1" };
}

const papelSchema = z.enum(["ADMIN", "GESTOR", "VENDEDOR", "PROJETOS", "VISUALIZADOR"]);
// "" = nenhuma área. Coerência com o papel é resolvida no serviço (lib/auth/areas).
const areaSchema = z.enum(["VENDAS", "PROJETOS", ""]).transform((a) => (a === "" ? null : a));
// Qualquer cargo do enum entra aqui; "é da área" e "Diretor só com gestão" é o serviço que resolve (lib/auth/areas).
const cargosSchema = z.array(z.enum(["GP", "PM", "PO", "DIRETOR"]));
// "" = campo fora do form (papel não usa área de entrada). Coerência no serviço, como a área.
const areaEntradaSchema = z.enum(["VENDAS", "PROJETOS", "GERAL", ""]).transform((a) => (a === "" ? null : a));

const conviteSchema = z.object({
  nome: z.string().trim().min(2, "Nome muito curto."),
  email: z.string().trim().min(3),
  papel: papelSchema,
  telefone: z.string().trim().optional(),
  area: areaSchema.optional(),
  cargos: cargosSchema,
  areaEntrada: areaEntradaSchema.optional(),
  // "" = sem posição (campo opcional).
  posicaoId: z.string().max(64).optional(),
});

/**
 * Campos de lado do form (CamposLado): `area` + checkboxes `cargos` + `areaEntrada`. O hidden
 * `ladoNoForm` diferencia "nenhum cargo marcado" de "form sem esses campos"
 * (editar a si mesmo não mostra lado/cargo).
 */
function ladoDoForm(form: FormData): { area?: unknown; cargos?: unknown[]; areaEntrada?: unknown } {
  if (form.get("ladoNoForm") !== "1") return {};
  return { area: form.get("area") ?? "", cargos: form.getAll("cargos"), areaEntrada: form.get("areaEntrada") ?? "" };
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
      posicaoId: form.get("posicaoId") ?? undefined,
      ...ladoDoForm(form),
    });
    if (!parsed.success) return { erro: parsed.error.issues[0]?.message ?? "Dados inválidos." };
    // Conta (+ membro do G&G e posição, quando há posição), numa transação só.
    const r = await cadastrarPessoa(parsed.data, ator, confirmacaoDoForm(form));
    if (!r.ok) return falha(r);
    revalidatePath("/gestao/usuarios");
    revalidatePath("/gg", "layout");
    // Com o Google configurado a pessoa já entra com este email; o link fica como alternativa.
    return {
      link: linkConvite(r.token),
      expiraEm: r.expiraEm.toISOString(),
      email: normalizarEmail(parsed.data.email) ?? parsed.data.email,
      ...(r.fichaLigada ? { fichaLigada: r.fichaLigada } : {}),
    };
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
  areaEntrada: areaEntradaSchema.optional(),
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

const MENSAGEM_DESLIGAR_GOOGLE: Record<ErroDesligarGoogle, string> = {
  USUARIO_NAO_ENCONTRADO: "Usuário não encontrado.",
  PAPEL_NAO_PERMITIDO: "Você não pode desligar o Google deste usuário (gestor só para papéis abaixo do seu).",
  NAO_PODE_ALTERAR_A_SI: "Você não pode desligar o seu próprio Google aqui.",
  SEM_GOOGLE: "Este usuário não tem conta Google ligada.",
};

/** Desliga a conta Google amarrada (o próximo login com Google amarra de novo). Mesma regra do link de redefinição. */
export async function desligarGoogleAction(usuarioId: string): Promise<EstadoEdicao> {
  return comTratamentoForm("gestao.usuarios.desligarGoogle", async (): Promise<EstadoEdicao> => {
    const ator = await exigirPapel("GESTOR");
    if (typeof usuarioId !== "string" || !usuarioId) return { erro: MENSAGEM_DESLIGAR_GOOGLE.USUARIO_NAO_ENCONTRADO };
    const r = await desligarGoogle(usuarioId, ator);
    if (!r.ok) return { erro: MENSAGEM_DESLIGAR_GOOGLE[r.erro] };
    revalidatePath("/gestao/usuarios");
    return { ok: true };
  });
}

const idSchema = z.string().min(1).max(64);

/** Edição de usuário (GAB-105): atribui uma posição do organograma (início hoje). */
export async function adicionarPosicaoUsuarioAction(
  usuarioId: string,
  posicaoId: string,
  confirmacao: { ligarMembroId?: string | null; criarMembroNovo?: boolean } = {},
): Promise<EstadoEdicao & { homonimo?: Homonimo }> {
  return comTratamentoForm("gestao.usuarios.adicionarPosicao", async (): Promise<EstadoEdicao & { homonimo?: Homonimo }> => {
    const ator = await exigirPapel("GESTOR");
    if (!idSchema.safeParse(usuarioId).success || !idSchema.safeParse(posicaoId).success) return { erro: "Escolha uma posição." };
    const ligar = confirmacao?.ligarMembroId;
    if (ligar != null && !idSchema.safeParse(ligar).success) return { erro: "Dados inválidos." };
    const r = await adicionarPosicaoAoUsuario(usuarioId, posicaoId, ator, { ligarMembroId: ligar ?? null, criarMembroNovo: confirmacao?.criarMembroNovo === true });
    if (!r.ok) return falha(r);
    revalidatePath("/gestao/usuarios");
    revalidatePath("/gg", "layout");
    return { ok: true };
  });
}

/** Edição de usuário (GAB-105): encerra hoje uma ocupação aberta da pessoa. */
export async function encerrarOcupacaoUsuarioAction(usuarioId: string, ocupacaoId: string): Promise<EstadoEdicao> {
  return comTratamentoForm("gestao.usuarios.encerrarOcupacao", async (): Promise<EstadoEdicao> => {
    const ator = await exigirPapel("GESTOR");
    if (!idSchema.safeParse(usuarioId).success || !idSchema.safeParse(ocupacaoId).success) return { erro: "Dados inválidos." };
    const r = await encerrarOcupacaoDoUsuario(usuarioId, ocupacaoId, ator);
    if (!r.ok) return { erro: MENSAGEM_CADASTRO[r.erro] };
    revalidatePath("/gestao/usuarios");
    revalidatePath("/gg", "layout");
    return { ok: true };
  });
}

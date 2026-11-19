"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirPapel } from "@/lib/auth/atual";
import { atualizarUsuario, reemitirConvite, type ErroUsuario } from "@/lib/auth/usuarios";
import { adicionarPosicaoAoUsuario, cadastrarPessoa, definirAdministrador, encerrarOcupacaoDoUsuario, type ContaAConfirmar, type ErroCadastro, type FalhaCadastro, type FichaLigada } from "@/lib/auth/cadastro";
import { descreverConta } from "@/lib/gg/modelo";
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
  CONFLITO_DE_LADO:
    "A pessoa ficaria com posições em Vendas e em Projetos sem uma principal, e o papel no CRM sai da posição principal. Marque uma das posições como principal no G&G (Membros → ficha) e tente de novo.",
  CONFIRMAR_CONTA: "A conta no CRM vai ficar diferente do que a tela mostrava. Confira e confirme.",
};

/** Membro sem e-mail e sem conta com o mesmo nome no G&G: a tela pergunta se é a mesma pessoa. */
export type Homonimo = { id: string; nome: string };

/**
 * `confirmarConta`: a conta resultante não é a da prévia (ficha ligada com outras posições) ou a edição
 * muda o papel; a tela mostra e só segue com confirmação explícita. `conta`: como a conta ficou.
 */
export type EstadoConvite =
  | { erro?: string; link?: string; expiraEm?: string; email?: string; homonimos?: Homonimo[]; fichaLigada?: FichaLigada; confirmarConta?: ContaAConfirmar; conta?: string }
  | undefined;

function falha(r: FalhaCadastro): { erro: string; homonimos?: Homonimo[]; confirmarConta?: ContaAConfirmar } {
  if (r.homonimos?.length)
    return {
      erro: r.homonimos.length === 1 ? `Já existe "${r.homonimos[0].nome}" sem e-mail no G&G. É a mesma pessoa?` : `Há ${r.homonimos.length} membros sem e-mail no G&G com esse nome. É algum deles?`,
      homonimos: r.homonimos,
    };
  if (r.confirmarConta) return { erro: MENSAGEM_CADASTRO.CONFIRMAR_CONTA, confirmarConta: r.confirmarConta };
  return { erro: r.detalhe ?? MENSAGEM_CADASTRO[r.erro] };
}

/**
 * Respostas da tela: homônimo (`ligarMembroId` = é a mesma pessoa, `criarMembroNovo=1` = é outra) e
 * `confirmarConta` = a conta resultante que a tela mostrou e foi confirmada (o serviço confere que é a mesma).
 */
const textoCurto = (v: unknown): string | null => (typeof v === "string" && v && v.length <= 200 ? v : null);

function confirmacaoDoForm(form: FormData) {
  const ligar = form.get("ligarMembroId");
  return {
    ligarMembroId: typeof ligar === "string" && ligar && ligar.length <= 64 ? ligar : null,
    criarMembroNovo: form.get("criarMembroNovo") === "1",
    confirmarConta: textoCurto(form.get("confirmarConta")),
  };
}

// GAB-107: papel, área, cargos e área de entrada NÃO vêm do form do cadastro: saem da posição
// (`cadastrarPessoa`). Só "Administrador" (checkbox), que o serviço recusa se quem cadastra não é admin.
const conviteSchema = z.object({
  nome: z.string().trim().min(2, "Nome muito curto."),
  email: z.string().trim().min(3),
  telefone: z.string().trim().optional(),
  // "" = sem posição (campo opcional).
  posicaoId: z.string().max(64).optional(),
  administrador: z.boolean(),
  // O texto "Conta no CRM: …" que a tela mostrava: se a conta gravada for outra, o serviço pede confirmação.
  previa: z.string().max(200).optional(),
});

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
      telefone: form.get("telefone") ?? undefined,
      posicaoId: form.get("posicaoId") ?? undefined,
      administrador: form.get("administrador") === "1",
      previa: form.get("previaConta") || undefined,
    });
    if (!parsed.success) return { erro: parsed.error.issues[0]?.message ?? "Dados inválidos." };
    // Conta (+ membro do G&G e posição, quando há posição), numa transação só.
    const r = await cadastrarPessoa(parsed.data, ator, confirmacaoDoForm(form));
    if (!r.ok) return falha(r);
    revalidatePath("/gestao/usuarios");
    revalidatePath("/gg", "layout");
    revalidatePath("/membros", "layout");
    // Com o Google configurado a pessoa já entra com este email; o link fica como alternativa.
    return {
      link: linkConvite(r.token),
      expiraEm: r.expiraEm.toISOString(),
      email: normalizarEmail(parsed.data.email) ?? parsed.data.email,
      conta: descreverConta(r.conta),
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

// GAB-107: a edição é nome, telefone e (só para o admin) "Administrador". Papel, área, cargos e área de
// entrada não vêm de form nenhum: saem das posições (atribuir/encerrar recalcula a conta).
const edicaoSchema = z.object({
  usuarioId: z.string().min(1),
  nome: z.string().trim().min(2).optional(),
  telefone: z.string().trim().optional(),
});

/** `confirmarConta`: desmarcar "Administrador" devolve a conta às posições; a tela mostra e confirma. */
export type EstadoEdicao = { erro?: string; ok?: true; confirmarConta?: ContaAConfirmar; conta?: string } | undefined;

export async function editarUsuarioAction(_prev: EstadoEdicao, form: FormData): Promise<EstadoEdicao> {
  return comTratamentoForm("gestao.usuarios.editarUsuario", async (): Promise<EstadoEdicao> => {
    const ator = await exigirPapel("GESTOR");
    const parsed = edicaoSchema.safeParse({ usuarioId: form.get("usuarioId"), nome: form.get("nome") ?? undefined, telefone: form.get("telefone") ?? undefined });
    if (!parsed.success) return { erro: "Dados inválidos." };
    const { usuarioId, ...perfil } = parsed.data;
    // Campos de papel/lado num FormData forjado são ignorados: só nome e telefone vão para a conta.
    const r = await atualizarUsuario(usuarioId, perfil, ator);
    if (!r.ok) return { erro: MENSAGEM[r.erro] };
    let conta: string | undefined;
    // "Administrador" só é lido do admin (o serviço confere de novo); de outro ator, o campo é ignorado.
    if (ator.papel === "ADMIN" && form.get("adminNoForm") === "1") {
      const a = await definirAdministrador(usuarioId, form.get("administrador") === "1", ator, { confirmarConta: textoCurto(form.get("confirmarConta")) });
      if (!a.ok) return falha(a);
      conta = a.conta;
    }
    revalidatePath("/gestao/usuarios");
    revalidatePath("/membros", "layout");
    return { ok: true, ...(conta ? { conta } : {}) };
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

/** Resultado de atribuir/encerrar posição: como a conta ficou, ou o pedido de confirmação (mudança de papel). */
export type EstadoPosicao = EstadoEdicao & { homonimos?: Homonimo[]; confirmarConta?: ContaAConfirmar; conta?: string };

/** Edição de usuário (GAB-105): atribui uma posição do organograma (início hoje). GAB-107: recalcula a conta. */
export async function adicionarPosicaoUsuarioAction(
  usuarioId: string,
  posicaoId: string,
  confirmacao: { ligarMembroId?: string | null; criarMembroNovo?: boolean; confirmarConta?: string | null } = {},
): Promise<EstadoPosicao> {
  return comTratamentoForm("gestao.usuarios.adicionarPosicao", async (): Promise<EstadoPosicao> => {
    const ator = await exigirPapel("GESTOR");
    if (!idSchema.safeParse(usuarioId).success || !idSchema.safeParse(posicaoId).success) return { erro: "Escolha uma posição." };
    const ligar = confirmacao?.ligarMembroId;
    if (ligar != null && !idSchema.safeParse(ligar).success) return { erro: "Dados inválidos." };
    const r = await adicionarPosicaoAoUsuario(usuarioId, posicaoId, ator, {
      ligarMembroId: ligar ?? null,
      criarMembroNovo: confirmacao?.criarMembroNovo === true,
      confirmarConta: textoCurto(confirmacao?.confirmarConta),
    });
    if (!r.ok) return falha(r);
    revalidatePath("/gestao/usuarios");
    revalidatePath("/gg", "layout");
    revalidatePath("/membros", "layout");
    return { ok: true, conta: r.conta };
  });
}

/** Edição de usuário (GAB-105): encerra hoje uma ocupação aberta da pessoa. GAB-107: recalcula a conta. */
export async function encerrarOcupacaoUsuarioAction(usuarioId: string, ocupacaoId: string, confirmarConta: string | null = null): Promise<EstadoPosicao> {
  return comTratamentoForm("gestao.usuarios.encerrarOcupacao", async (): Promise<EstadoPosicao> => {
    const ator = await exigirPapel("GESTOR");
    if (!idSchema.safeParse(usuarioId).success || !idSchema.safeParse(ocupacaoId).success) return { erro: "Dados inválidos." };
    const r = await encerrarOcupacaoDoUsuario(usuarioId, ocupacaoId, ator, { confirmarConta: textoCurto(confirmarConta) });
    if (!r.ok) return falha(r);
    revalidatePath("/gestao/usuarios");
    revalidatePath("/gg", "layout");
    revalidatePath("/membros", "layout");
    return { ok: true, conta: r.conta };
  });
}

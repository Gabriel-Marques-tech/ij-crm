import type { Papel, Usuario } from "@prisma/client";
import { db } from "@/lib/db";
import { normalizarEmail, normalizarTelefoneBr } from "@/lib/normalizacao";
import { conviteEstaValido, gerarConvite, hashToken } from "./convite";
import { podeAtribuirPapel } from "./papeis";
import { gerarHashSenha, senhaAtendeRegras, verificarSenha } from "./senha";

export type ErroUsuario =
  | "PAPEL_NAO_PERMITIDO"
  | "EMAIL_INVALIDO"
  | "EMAIL_EM_USO"
  | "TELEFONE_INVALIDO"
  | "TELEFONE_EM_USO"
  | "CONVITE_INVALIDO"
  | "SENHA_FRACA"
  | "CREDENCIAIS_INVALIDAS"
  | "NAO_PODE_ALTERAR_A_SI"
  | "USUARIO_NAO_ENCONTRADO";

export type Resultado<T = object> = ({ ok: true } & T) | { ok: false; erro: ErroUsuario };

type Ator = Pick<Usuario, "id" | "papel">;

function resolverTelefone(entrada: string | null | undefined): Resultado<{ telefone: string | null }> {
  if (entrada === undefined || entrada === null || entrada.trim() === "") return { ok: true, telefone: null };
  const t = normalizarTelefoneBr(entrada);
  if (!t) return { ok: false, erro: "TELEFONE_INVALIDO" };
  return { ok: true, telefone: t };
}

function ehViolacaoDeUnique(e: unknown, coluna: string): boolean {
  const err = e as { code?: string; meta?: { target?: string[] | string } };
  if (err?.code !== "P2002") return false;
  const alvo = err.meta?.target;
  return Array.isArray(alvo) ? alvo.includes(coluna) : typeof alvo === "string" && alvo.includes(coluna);
}

/**
 * Cria o usuário já com o convite pendente (sem senha) e devolve o token em
 * claro UMA vez — ele não é persistido, só o hash.
 */
export async function criarConvite(
  dados: { nome: string; email: string; papel: Papel; telefone?: string | null },
  por: Ator,
): Promise<Resultado<{ usuarioId: string; token: string; expiraEm: Date }>> {
  if (!podeAtribuirPapel(por.papel, dados.papel)) return { ok: false, erro: "PAPEL_NAO_PERMITIDO" };
  const email = normalizarEmail(dados.email);
  if (!email) return { ok: false, erro: "EMAIL_INVALIDO" };
  const tel = resolverTelefone(dados.telefone);
  if (!tel.ok) return tel;

  const convite = gerarConvite();
  try {
    const u = await db.usuario.create({
      data: {
        nome: dados.nome.trim(),
        email,
        papel: dados.papel,
        telefoneWhatsapp: tel.telefone,
        senhaHash: null,
        conviteTokenHash: convite.hash,
        conviteExpiraEm: convite.expiraEm,
      },
      select: { id: true },
    });
    return { ok: true, usuarioId: u.id, token: convite.token, expiraEm: convite.expiraEm };
  } catch (e) {
    if (ehViolacaoDeUnique(e, "email")) return { ok: false, erro: "EMAIL_EM_USO" };
    if (ehViolacaoDeUnique(e, "telefone_whatsapp")) return { ok: false, erro: "TELEFONE_EM_USO" };
    throw e;
  }
}

/** Reemite o convite de um usuário que ainda não definiu senha (token antigo morre). */
export async function reemitirConvite(usuarioId: string, por: Ator): Promise<Resultado<{ token: string; expiraEm: Date }>> {
  const u = await db.usuario.findUnique({ where: { id: usuarioId }, select: { papel: true, senhaHash: true } });
  if (!u) return { ok: false, erro: "USUARIO_NAO_ENCONTRADO" };
  if (!podeAtribuirPapel(por.papel, u.papel)) return { ok: false, erro: "PAPEL_NAO_PERMITIDO" };
  if (u.senhaHash !== null) return { ok: false, erro: "CONVITE_INVALIDO" };
  const convite = gerarConvite();
  await db.usuario.update({
    where: { id: usuarioId },
    data: { conviteTokenHash: convite.hash, conviteExpiraEm: convite.expiraEm },
  });
  return { ok: true, token: convite.token, expiraEm: convite.expiraEm };
}

export async function buscarConvite(token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const u = await db.usuario.findUnique({
    where: { conviteTokenHash: hashToken(token) },
    select: { id: true, nome: true, email: true, conviteExpiraEm: true, ativo: true },
  });
  if (!u || !u.ativo || !conviteEstaValido(u)) return null;
  return u;
}

export async function aceitarConvite(token: string, senha: string): Promise<Resultado<{ usuarioId: string }>> {
  const u = await buscarConvite(token);
  if (!u) return { ok: false, erro: "CONVITE_INVALIDO" };
  if (!senhaAtendeRegras(senha)) return { ok: false, erro: "SENHA_FRACA" };
  const senhaHash = await gerarHashSenha(senha);
  // updateMany com o hash no where: se dois aceites correrem, só um consome o token.
  const r = await db.usuario.updateMany({
    where: { id: u.id, conviteTokenHash: hashToken(token) },
    data: { senhaHash, conviteTokenHash: null, conviteExpiraEm: null },
  });
  if (r.count === 0) return { ok: false, erro: "CONVITE_INVALIDO" };
  return { ok: true, usuarioId: u.id };
}

export async function autenticar(email: string, senha: string): Promise<Resultado<{ usuarioId: string }>> {
  const e = normalizarEmail(email);
  const u = e ? await db.usuario.findUnique({ where: { email: e }, select: { id: true, senhaHash: true, ativo: true } }) : null;
  // Sempre roda a verificação (mesmo com usuário inexistente) para não vazar
  // existência de email pelo tempo de resposta.
  const confere = await verificarSenha(u?.senhaHash ?? null, senha);
  if (!u || !u.ativo || !confere) return { ok: false, erro: "CREDENCIAIS_INVALIDAS" };
  return { ok: true, usuarioId: u.id };
}

export async function atualizarUsuario(
  usuarioId: string,
  dados: { nome?: string; telefone?: string | null; papel?: Papel; ativo?: boolean },
  por: Ator,
): Promise<Resultado> {
  const alvo = await db.usuario.findUnique({ where: { id: usuarioId }, select: { id: true, papel: true } });
  if (!alvo) return { ok: false, erro: "USUARIO_NAO_ENCONTRADO" };
  // Mexer em alguém exige poder atribuir o papel ATUAL dele (gestor não toca admin)
  // e, se houver mudança de papel, o papel NOVO também.
  if (!podeAtribuirPapel(por.papel, alvo.papel)) return { ok: false, erro: "PAPEL_NAO_PERMITIDO" };
  if (dados.papel !== undefined && !podeAtribuirPapel(por.papel, dados.papel)) return { ok: false, erro: "PAPEL_NAO_PERMITIDO" };
  if (alvo.id === por.id && (dados.ativo === false || (dados.papel !== undefined && dados.papel !== por.papel))) {
    return { ok: false, erro: "NAO_PODE_ALTERAR_A_SI" };
  }

  const tel = dados.telefone !== undefined ? resolverTelefone(dados.telefone) : null;
  if (tel && !tel.ok) return tel;

  try {
    await db.$transaction(async (tx) => {
      await tx.usuario.update({
        where: { id: usuarioId },
        data: {
          ...(dados.nome !== undefined ? { nome: dados.nome.trim() } : {}),
          ...(tel ? { telefoneWhatsapp: tel.telefone } : {}),
          ...(dados.papel !== undefined ? { papel: dados.papel } : {}),
          ...(dados.ativo !== undefined ? { ativo: dados.ativo } : {}),
        },
      });
      if (dados.ativo === false) await tx.sessao.deleteMany({ where: { usuarioId } });
    });
  } catch (e) {
    if (ehViolacaoDeUnique(e, "telefone_whatsapp")) return { ok: false, erro: "TELEFONE_EM_USO" };
    throw e;
  }
  return { ok: true };
}

export async function listarUsuarios() {
  return db.usuario.findMany({
    orderBy: [{ ativo: "desc" }, { nome: "asc" }],
    select: {
      id: true,
      nome: true,
      email: true,
      papel: true,
      telefoneWhatsapp: true,
      ativo: true,
      senhaHash: true,
      conviteExpiraEm: true,
      criadoEm: true,
    },
  }).then((lista) =>
    lista.map(({ senhaHash, ...u }) => ({ ...u, convitePendente: senhaHash === null })),
  );
}

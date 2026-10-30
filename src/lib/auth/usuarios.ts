import type { Area, Cargo, Papel, Usuario } from "@prisma/client";
import { db } from "@/lib/db";
import { normalizarEmail, normalizarTelefoneBr } from "@/lib/normalizacao";
import { resolverAreaCargos } from "./areas";
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

class ErroConcorrencia extends Error {}

function resolverTelefone(entrada: string | null | undefined): Resultado<{ telefone: string | null }> {
  if (entrada === undefined || entrada === null || entrada.trim() === "") return { ok: true, telefone: null };
  const t = normalizarTelefoneBr(entrada);
  if (!t) return { ok: false, erro: "TELEFONE_INVALIDO" };
  return { ok: true, telefone: t };
}

type Lado = { area: Area | null; cargos: readonly Cargo[] };

function formatarLado(l: Lado): string {
  return `${l.area ?? "nenhuma"}[${l.cargos.join(",")}]`;
}

function mesmoLado(a: Lado, b: Lado): boolean {
  return a.area === b.area && a.cargos.length === b.cargos.length && a.cargos.every((c) => b.cargos.includes(c));
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
  dados: { nome: string; email: string; papel: Papel; telefone?: string | null; area?: Area | null; cargos?: readonly Cargo[] },
  por: Ator,
): Promise<Resultado<{ usuarioId: string; token: string; expiraEm: Date }>> {
  if (!podeAtribuirPapel(por.papel, dados.papel)) return { ok: false, erro: "PAPEL_NAO_PERMITIDO" };
  const email = normalizarEmail(dados.email);
  if (!email) return { ok: false, erro: "EMAIL_INVALIDO" };
  const tel = resolverTelefone(dados.telefone);
  if (!tel.ok) return tel;

  // GAB-82: lado coerente com o papel (vendedor → vendas etc.; ver ./areas).
  const lado = resolverAreaCargos(dados.papel, dados.area ?? null, dados.cargos ?? []);

  const convite = gerarConvite();
  try {
    const u = await db.usuario.create({
      data: {
        nome: dados.nome.trim(),
        email,
        papel: dados.papel,
        area: lado.area,
        cargos: lado.cargos,
        telefoneWhatsapp: tel.telefone,
        senhaHash: null,
        conviteTokenHash: convite.hash,
        conviteExpiraEm: convite.expiraEm,
      },
      select: { id: true },
    });
    console.info(`[auditoria] usuario.convidado usuario=${u.id} por=${por.id} papel=${dados.papel} lado=${formatarLado(lado)}`);
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
  // `senhaHash: null` no where: se um aceite correu no meio, não reabre a conta.
  const r = await db.usuario.updateMany({
    where: { id: usuarioId, senhaHash: null },
    data: { conviteTokenHash: convite.hash, conviteExpiraEm: convite.expiraEm },
  });
  if (r.count === 0) return { ok: false, erro: "CONVITE_INVALIDO" };
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
  dados: { nome?: string; telefone?: string | null; papel?: Papel; ativo?: boolean; area?: Area | null; cargos?: readonly Cargo[] },
  por: Ator,
): Promise<Resultado> {
  const alvo = await db.usuario.findUnique({ where: { id: usuarioId }, select: { id: true, papel: true, area: true, cargos: true } });
  if (!alvo) return { ok: false, erro: "USUARIO_NAO_ENCONTRADO" };
  const ehEu = alvo.id === por.id;

  // GAB-82: lado/cargos se recalculam quando papel, área ou cargos vêm no pedido.
  // Área omitida = mantém a atual; cargos omitidos = mantém, a não ser que o lado
  // mude (GP de um lado não vira GP do outro sem a gestão dizer).
  const papelFinal = dados.papel ?? alvo.papel;
  const mexeLado = dados.papel !== undefined || dados.area !== undefined || dados.cargos !== undefined;
  let lado: Lado = { area: alvo.area, cargos: alvo.cargos };
  if (mexeLado) {
    const tentativa = resolverAreaCargos(papelFinal, dados.area !== undefined ? dados.area : alvo.area, dados.cargos ?? alvo.cargos);
    lado = dados.cargos === undefined && tentativa.area !== alvo.area ? { area: tentativa.area, cargos: [] } : tentativa;
  }
  const ladoMudou = !mesmoLado(lado, { area: alvo.area, cargos: alvo.cargos });

  const soPerfil = dados.papel === undefined && dados.ativo === undefined && !ladoMudou;
  // Qualquer um edita o próprio nome/telefone. Fora isso: mexer em alguém exige
  // poder atribuir o papel ATUAL dele (gestor não toca admin) e, se houver
  // mudança de papel, o papel NOVO também; e ninguém se rebaixa/desativa.
  if (!(ehEu && soPerfil)) {
    if (!podeAtribuirPapel(por.papel, alvo.papel)) return { ok: false, erro: "PAPEL_NAO_PERMITIDO" };
    if (dados.papel !== undefined && !podeAtribuirPapel(por.papel, dados.papel)) return { ok: false, erro: "PAPEL_NAO_PERMITIDO" };
    // Cargo dá poder (GP age pelo lado): ninguém mexe no próprio lado/cargo também.
    if (ehEu && (dados.ativo === false || (dados.papel !== undefined && dados.papel !== por.papel) || ladoMudou)) {
      return { ok: false, erro: "NAO_PODE_ALTERAR_A_SI" };
    }
  }

  const tel = dados.telefone !== undefined ? resolverTelefone(dados.telefone) : null;
  if (tel && !tel.ok) return tel;

  try {
    await db.$transaction(async (tx) => {
      // `papel: alvo.papel` no where: se o alvo foi promovido entre a leitura e
      // a escrita, a atualização não acontece (gestor nunca edita admin).
      const r = await tx.usuario.updateMany({
        where: { id: usuarioId, papel: alvo.papel },
        data: {
          ...(dados.nome !== undefined ? { nome: dados.nome.trim() } : {}),
          ...(tel ? { telefoneWhatsapp: tel.telefone } : {}),
          ...(dados.papel !== undefined ? { papel: dados.papel } : {}),
          ...(dados.ativo !== undefined ? { ativo: dados.ativo } : {}),
          ...(ladoMudou ? { area: lado.area, cargos: [...lado.cargos] } : {}),
        },
      });
      if (r.count === 0) throw new ErroConcorrencia();
      if (dados.ativo === false) await tx.sessao.deleteMany({ where: { usuarioId } });
    });
  } catch (e) {
    if (e instanceof ErroConcorrencia) return { ok: false, erro: "PAPEL_NAO_PERMITIDO" };
    if (ehViolacaoDeUnique(e, "telefone_whatsapp")) return { ok: false, erro: "TELEFONE_EM_USO" };
    throw e;
  }
  if (dados.papel !== undefined && dados.papel !== alvo.papel) {
    console.info(`[auditoria] usuario.papel_alterado usuario=${usuarioId} por=${por.id} de=${alvo.papel} para=${dados.papel}`);
  }
  if (ladoMudou) {
    console.info(
      `[auditoria] usuario.lado_alterado usuario=${usuarioId} por=${por.id} de=${formatarLado({ area: alvo.area, cargos: alvo.cargos })} para=${formatarLado(lado)}`,
    );
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
      area: true,
      cargos: true,
      telefoneWhatsapp: true,
      ativo: true,
      senhaHash: true,
      conviteExpiraEm: true,
      criadoEm: true,
      redefinicaoPedidaEm: true,
      redefinicaoExpiraEm: true,
      foto: { select: { atualizadoEm: true } },
    },
  }).then((lista) =>
    lista.map(({ senhaHash, foto, ...u }) => ({
      ...u,
      convitePendente: senhaHash === null,
      redefinicaoLinkAtivo: u.redefinicaoExpiraEm !== null && u.redefinicaoExpiraEm.getTime() > Date.now(),
      fotoEm: foto?.atualizadoEm.getTime() ?? null,
    })),
  );
}

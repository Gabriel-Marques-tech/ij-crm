/**
 * "Esqueci minha senha" sem SMTP (GAB-43, mesmo modelo do convite — design §4.6):
 *
 * 1. Na tela de login a pessoa informa o email → `pedirRedefinicao`. A resposta
 *    é sempre a mesma; o pedido só é gravado se o email for de um usuário ativo
 *    com senha. Nada é enviado: o pedido aparece em Gestão → Usuários.
 * 2. Gestor/admin clica "Gerar link de redefinição" → token aleatório, banco
 *    guarda só o sha256, vale 1 h, mostrado UMA vez. Gestor só gera para
 *    vendedor; admin gera para qualquer um (menos ele mesmo) — `podeGerarRedefinicao`.
 * 3. `/redefinir/[token]` → `redefinirSenha`: consome o token atomicamente
 *    (hash + validade no WHERE do update) e derruba TODAS as sessões do usuário.
 */
import { randomBytes } from "node:crypto";
import type { Papel } from "@prisma/client";
import { db } from "@/lib/db";
import { normalizarEmail } from "@/lib/normalizacao";
import { hashToken } from "./convite";
import { PAPEIS, podeGerarRedefinicao } from "./papeis";
import { gerarHashSenha, senhaAtendeRegras } from "./senha";

export const REDEFINICAO_VALIDADE_MS = 60 * 60 * 1000;

export type ErroRedefinicao =
  | "PAPEL_NAO_PERMITIDO"
  | "SO_ADMIN_REDEFINE"
  | "NAO_PODE_ALTERAR_A_SI"
  | "USUARIO_NAO_ENCONTRADO"
  | "USUARIO_INATIVO"
  | "CONVITE_PENDENTE"
  | "TOKEN_INVALIDO"
  | "SENHA_FRACA"
  | "CONFIRMACAO_DIFERENTE";

export const MENSAGEM_REDEFINICAO: Record<ErroRedefinicao, string> = {
  PAPEL_NAO_PERMITIDO: "Você não pode gerar link de redefinição para esse usuário.",
  SO_ADMIN_REDEFINE: "Só um admin pode gerar link de redefinição para gestor ou admin.",
  NAO_PODE_ALTERAR_A_SI: "Para a sua própria senha, use Meu perfil → Trocar senha.",
  USUARIO_NAO_ENCONTRADO: "Usuário não encontrado.",
  USUARIO_INATIVO: "Usuário desativado: reative antes de gerar o link.",
  CONVITE_PENDENTE: "Este usuário ainda não definiu senha: reemita o convite.",
  TOKEN_INVALIDO: "Link inválido, expirado ou já usado. Peça um novo a um gestor.",
  SENHA_FRACA: "A senha precisa ter pelo menos 8 caracteres.",
  CONFIRMACAO_DIFERENTE: "As senhas não conferem.",
};

type Ator = { id: string; papel: Papel };

const TOKEN_RE = /^[0-9a-f]{64}$/;

/**
 * Registra o pedido se o email for de um usuário ativo com senha; senão não
 * grava nada. Os dois caminhos fazem a mesma consulta + um update (o do email
 * inexistente casa zero linhas), e a action ainda iguala o tempo de resposta.
 */
export async function pedirRedefinicao(email: string, agora: Date = new Date()): Promise<void> {
  const e = normalizarEmail(email);
  const u = e ? await db.usuario.findUnique({ where: { email: e }, select: { id: true, ativo: true, senhaHash: true } }) : null;
  const elegivel = u !== null && u.ativo && u.senhaHash !== null;
  await db.usuario.updateMany({
    where: { id: elegivel ? u.id : "__sem_usuario__", ativo: true, senhaHash: { not: null } },
    data: { redefinicaoPedidaEm: agora },
  });
}

/** Pedidos abertos (para o badge/lista de Gestão → Usuários). */
export async function listarPedidosRedefinicao() {
  return db.usuario.findMany({
    where: { redefinicaoPedidaEm: { not: null }, ativo: true },
    orderBy: { redefinicaoPedidaEm: "asc" },
    select: { id: true, nome: true, email: true, papel: true, redefinicaoPedidaEm: true },
  });
}

export async function gerarLinkRedefinicao(
  usuarioId: string,
  por: Ator,
  agora: Date = new Date(),
): Promise<{ ok: true; token: string; expiraEm: Date } | { ok: false; erro: ErroRedefinicao }> {
  const alvo = await db.usuario.findUnique({ where: { id: usuarioId }, select: { id: true, papel: true, ativo: true, senhaHash: true } });
  if (!alvo) return { ok: false, erro: "USUARIO_NAO_ENCONTRADO" };
  // Tomada de conta: só papel estritamente inferior (gestor → vendedor); admin → qualquer um.
  if (!podeGerarRedefinicao(por.papel, alvo.papel)) {
    return { ok: false, erro: por.papel === "GESTOR" ? "SO_ADMIN_REDEFINE" : "PAPEL_NAO_PERMITIDO" };
  }
  if (alvo.id === por.id) return { ok: false, erro: "NAO_PODE_ALTERAR_A_SI" };
  if (!alvo.ativo) return { ok: false, erro: "USUARIO_INATIVO" };
  if (alvo.senhaHash === null) return { ok: false, erro: "CONVITE_PENDENTE" };

  const token = randomBytes(32).toString("hex");
  const expiraEm = new Date(agora.getTime() + REDEFINICAO_VALIDADE_MS);
  // `papel` no where: só grava se o alvo AINDA tem um papel que o ator pode
  // redefinir (promovido no meio → o gestor não ganha o link).
  const papeisPermitidos = PAPEIS.filter((p) => podeGerarRedefinicao(por.papel, p));
  const r = await db.usuario.updateMany({
    where: { id: alvo.id, papel: { in: [...papeisPermitidos] }, ativo: true, senhaHash: { not: null } },
    data: { redefinicaoTokenHash: hashToken(token), redefinicaoExpiraEm: expiraEm, redefinicaoPedidaEm: null },
  });
  if (r.count === 0) return { ok: false, erro: "PAPEL_NAO_PERMITIDO" };
  console.info(`[auditoria] usuario.redefinicao_link_gerado alvo=${alvo.id} por=${por.id}`);
  return { ok: true, token, expiraEm };
}

export async function buscarRedefinicao(token: string, agora: Date = new Date()) {
  if (!TOKEN_RE.test(token)) return null;
  const u = await db.usuario.findUnique({
    where: { redefinicaoTokenHash: hashToken(token) },
    select: { id: true, nome: true, email: true, ativo: true, redefinicaoExpiraEm: true },
  });
  if (!u || !u.ativo || !u.redefinicaoExpiraEm || u.redefinicaoExpiraEm.getTime() <= agora.getTime()) return null;
  return { id: u.id, nome: u.nome, email: u.email };
}

class TokenConsumido extends Error {}

export async function redefinirSenha(
  token: string,
  senha: string,
  confirmacao: string,
): Promise<{ ok: true; usuarioId: string } | { ok: false; erro: ErroRedefinicao }> {
  const u = await buscarRedefinicao(token);
  if (!u) return { ok: false, erro: "TOKEN_INVALIDO" };
  if (senha !== confirmacao) return { ok: false, erro: "CONFIRMACAO_DIFERENTE" };
  if (!senhaAtendeRegras(senha)) return { ok: false, erro: "SENHA_FRACA" };
  const senhaHash = await gerarHashSenha(senha);
  try {
    await db.$transaction(async (tx) => {
      // Hash + validade + ativo no WHERE: dois usos simultâneos → a linha é
      // travada pelo primeiro, o segundo reavalia o WHERE e casa zero linhas.
      const r = await tx.usuario.updateMany({
        where: { id: u.id, redefinicaoTokenHash: hashToken(token), redefinicaoExpiraEm: { gt: new Date() }, ativo: true },
        data: { senhaHash, redefinicaoTokenHash: null, redefinicaoExpiraEm: null, redefinicaoPedidaEm: null },
      });
      if (r.count === 0) throw new TokenConsumido();
      await tx.sessao.deleteMany({ where: { usuarioId: u.id } });
    });
  } catch (e) {
    if (e instanceof TokenConsumido) return { ok: false, erro: "TOKEN_INVALIDO" };
    throw e;
  }
  console.info(`[auditoria] usuario.senha_redefinida usuario=${u.id}`);
  return { ok: true, usuarioId: u.id };
}

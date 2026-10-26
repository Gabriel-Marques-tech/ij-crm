/**
 * Conta do PRÓPRIO usuário (GAB-43): trocar senha e email. Quem chama passa o
 * id da sessão; nada aqui aceita "id de outro usuário" vindo do cliente.
 */
import { db } from "@/lib/db";
import { normalizarEmail } from "@/lib/normalizacao";
import { Limitador } from "./limitador";
import { gerarHashSenha, senhaAtendeRegras, verificarSenha } from "./senha";

export type ErroConta =
  | "SENHA_ATUAL_INCORRETA"
  | "SENHA_FRACA"
  | "SENHA_IGUAL"
  | "CONFIRMACAO_DIFERENTE"
  | "EMAIL_INVALIDO"
  | "EMAIL_EM_USO"
  | "MUITAS_TENTATIVAS"
  | "USUARIO_NAO_ENCONTRADO";

export const MENSAGEM_CONTA: Record<ErroConta, string> = {
  SENHA_ATUAL_INCORRETA: "Senha atual incorreta.",
  SENHA_FRACA: "A nova senha precisa ter pelo menos 8 caracteres.",
  SENHA_IGUAL: "A nova senha precisa ser diferente da atual.",
  CONFIRMACAO_DIFERENTE: "A confirmação não confere com a nova senha.",
  EMAIL_INVALIDO: "Email inválido.",
  EMAIL_EM_USO: "Já existe um usuário com esse email.",
  MUITAS_TENTATIVAS: "Muitas tentativas com a senha errada. Aguarde 15 minutos.",
  USUARIO_NAO_ENCONTRADO: "Usuário não encontrado.",
};

// Reautenticação (senha atual) por usuário: mesma janela do login. Em memória
// (processo único, ver limitador.ts); reinício zera.
const g = globalThis as unknown as { limitadorReautenticacao?: Limitador };
const limitador = (g.limitadorReautenticacao ??= new Limitador({ maxFalhas: 5, janelaMs: 15 * 60 * 1000 }));

class Concorrencia extends Error {}

/** `ana.nova@ij.com` → `a***@ij.com` (log de auditoria sem o endereço inteiro). */
export function mascararEmail(email: string): string {
  const arroba = email.indexOf("@");
  if (arroba <= 0) return "***";
  return `${email[0]}***${email.slice(arroba)}`;
}

/** Confere a senha atual com limite de tentativas. */
async function reautenticar(usuarioId: string, senha: string): Promise<{ ok: true; hash: string; email: string } | { ok: false; erro: ErroConta }> {
  const chave = `reauth|${usuarioId}`;
  if (limitador.bloqueado(chave)) return { ok: false, erro: "MUITAS_TENTATIVAS" };
  const u = await db.usuario.findUnique({ where: { id: usuarioId }, select: { senhaHash: true, email: true, ativo: true } });
  const confere = await verificarSenha(u?.senhaHash ?? null, senha);
  if (!u || !u.ativo) return { ok: false, erro: "USUARIO_NAO_ENCONTRADO" };
  if (!confere || !u.senhaHash) {
    limitador.registrarFalha(chave);
    return { ok: false, erro: "SENHA_ATUAL_INCORRETA" };
  }
  limitador.registrarSucesso(chave);
  return { ok: true, hash: u.senhaHash, email: u.email };
}

/**
 * Troca a senha: exige a atual, mínimo 8, confirmação e diferente da atual.
 * Na mesma transação encerra TODAS as outras sessões (fica só `idSessaoAtual`)
 * e invalida um link de redefinição pendente.
 */
export async function trocarSenha(
  usuarioId: string,
  idSessaoAtual: string | null,
  dados: { atual: string; nova: string; confirmacao: string },
): Promise<{ ok: true; encerradas: number } | { ok: false; erro: ErroConta }> {
  if (dados.nova !== dados.confirmacao) return { ok: false, erro: "CONFIRMACAO_DIFERENTE" };
  if (!senhaAtendeRegras(dados.nova)) return { ok: false, erro: "SENHA_FRACA" };
  const r = await reautenticar(usuarioId, dados.atual);
  if (!r.ok) return r;
  if (dados.nova === dados.atual) return { ok: false, erro: "SENHA_IGUAL" };
  const senhaHash = await gerarHashSenha(dados.nova);
  try {
    const encerradas = await db.$transaction(async (tx) => {
      // Hash antigo no where: duas trocas simultâneas não se sobrescrevem às cegas.
      const u = await tx.usuario.updateMany({
        where: { id: usuarioId, senhaHash: r.hash },
        data: { senhaHash, redefinicaoTokenHash: null, redefinicaoExpiraEm: null, redefinicaoPedidaEm: null },
      });
      if (u.count === 0) throw new Concorrencia();
      const s = await tx.sessao.deleteMany({ where: { usuarioId, ...(idSessaoAtual ? { id: { not: idSessaoAtual } } : {}) } });
      return s.count;
    });
    console.info(`[auditoria] usuario.senha_alterada usuario=${usuarioId} sessoes_encerradas=${encerradas}`);
    return { ok: true, encerradas };
  } catch (e) {
    if (e instanceof Concorrencia) return { ok: false, erro: "SENHA_ATUAL_INCORRETA" };
    throw e;
  }
}

function ehUniqueDeEmail(e: unknown): boolean {
  const err = e as { code?: string; meta?: { target?: string[] | string } };
  if (err?.code !== "P2002") return false;
  const alvo = err.meta?.target;
  return Array.isArray(alvo) ? alvo.includes("email") : typeof alvo === "string" && alvo.includes("email");
}

/** Troca o email: confirma a senha, normaliza, respeita o único. Linha de auditoria sem segredo. */
export async function trocarEmail(
  usuarioId: string,
  dados: { senha: string; email: string },
): Promise<{ ok: true; email: string } | { ok: false; erro: ErroConta }> {
  const email = normalizarEmail(dados.email);
  if (!email) return { ok: false, erro: "EMAIL_INVALIDO" };
  const r = await reautenticar(usuarioId, dados.senha);
  if (!r.ok) return r;
  if (email === r.email) return { ok: true, email };
  try {
    await db.usuario.update({ where: { id: usuarioId }, data: { email } });
  } catch (e) {
    // Só o único de email vira mensagem amigável; qualquer outro P2002 é inesperado.
    if (ehUniqueDeEmail(e)) return { ok: false, erro: "EMAIL_EM_USO" };
    throw e;
  }
  console.info(`[auditoria] usuario.email_alterado usuario=${usuarioId} de=${mascararEmail(r.email)} para=${mascararEmail(email)}`);
  return { ok: true, email };
}

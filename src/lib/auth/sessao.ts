import { createHash, randomBytes } from "node:crypto";
import type { Papel } from "@prisma/client";
import { db } from "@/lib/db";

export const SESSAO_DURACAO_DIAS = 30;

export type UsuarioSessao = { id: string; nome: string; email: string; papel: Papel };

/** O cookie carrega o valor em claro; o banco guarda só o sha256 (dump ≠ sessão viva). */
function hashSessao(valor: string): string {
  return createHash("sha256").update(valor).digest("hex");
}

export async function criarSessao(usuarioId: string, expiraEm?: Date): Promise<string> {
  const valor = randomBytes(32).toString("hex");
  await db.sessao.create({
    data: {
      id: hashSessao(valor),
      usuarioId,
      expiraEm: expiraEm ?? new Date(Date.now() + SESSAO_DURACAO_DIAS * 24 * 60 * 60 * 1000),
    },
  });
  return valor;
}

/** Resolve o usuário de uma sessão viva. Expirada, inexistente ou usuário inativo → null. */
export async function obterUsuarioDaSessao(valor: string): Promise<UsuarioSessao | null> {
  if (!/^[0-9a-f]{64}$/.test(valor)) return null;
  const s = await db.sessao.findUnique({
    where: { id: hashSessao(valor) },
    select: { expiraEm: true, usuario: { select: { id: true, nome: true, email: true, papel: true, ativo: true } } },
  });
  if (!s || s.expiraEm.getTime() <= Date.now() || !s.usuario.ativo) return null;
  const u = s.usuario;
  return { id: u.id, nome: u.nome, email: u.email, papel: u.papel };
}

export async function encerrarSessao(valor: string): Promise<void> {
  await db.sessao.deleteMany({ where: { id: hashSessao(valor) } });
}

/** Limpeza oportunista; chamada pelo cron (GAB-41) ou manualmente. */
export async function apagarSessoesExpiradas(): Promise<number> {
  const r = await db.sessao.deleteMany({ where: { expiraEm: { lte: new Date() } } });
  return r.count;
}

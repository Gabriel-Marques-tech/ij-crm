import { randomBytes } from "node:crypto";
import type { Papel } from "@prisma/client";
import { db } from "@/lib/db";

export const SESSAO_DURACAO_DIAS = 30;

export type UsuarioSessao = { id: string; nome: string; email: string; papel: Papel };

export async function criarSessao(usuarioId: string, expiraEm?: Date): Promise<string> {
  const id = randomBytes(32).toString("hex");
  await db.sessao.create({
    data: {
      id,
      usuarioId,
      expiraEm: expiraEm ?? new Date(Date.now() + SESSAO_DURACAO_DIAS * 24 * 60 * 60 * 1000),
    },
  });
  return id;
}

/** Resolve o usuário de uma sessão viva. Expirada, inexistente ou usuário inativo → null. */
export async function obterUsuarioDaSessao(id: string): Promise<UsuarioSessao | null> {
  if (!/^[0-9a-f]{64}$/.test(id)) return null;
  const s = await db.sessao.findUnique({
    where: { id },
    select: { expiraEm: true, usuario: { select: { id: true, nome: true, email: true, papel: true, ativo: true } } },
  });
  if (!s || s.expiraEm.getTime() <= Date.now() || !s.usuario.ativo) return null;
  const u = s.usuario;
  return { id: u.id, nome: u.nome, email: u.email, papel: u.papel };
}

export async function encerrarSessao(id: string): Promise<void> {
  await db.sessao.deleteMany({ where: { id } });
}

/** Limpeza oportunista; chamada pelo cron (GAB-41) ou manualmente. */
export async function apagarSessoesExpiradas(): Promise<number> {
  const r = await db.sessao.deleteMany({ where: { expiraEm: { lte: new Date() } } });
  return r.count;
}

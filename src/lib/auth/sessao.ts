import { createHash, randomBytes } from "node:crypto";
import type { Area, Cargo, Papel } from "@prisma/client";
import { db } from "@/lib/db";
import { registrarErro } from "@/lib/erros/registrar";

export const SESSAO_DURACAO_DIAS = 30;
/** `ultimo_uso_em` é regravado no máximo a cada N minutos (evita uma escrita por request). */
export const SESSAO_TOQUE_MINUTOS = 5;
const UA_MAX = 512;

export type UsuarioSessao = {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
  /** Lado e cargos (GAB-82). Para perguntar "de que lado"/"é GP", use `ladoDe`/`ehGpDoLado` de ./areas. */
  area: Area | null;
  cargos: Cargo[];
  /** `atualizado_em` da foto em ms (cache-bust da URL); null/ausente = sem foto → iniciais. */
  fotoEm?: number | null;
};

/** O cookie carrega o valor em claro; o banco guarda só o sha256 (dump ≠ sessão viva). */
export function hashSessao(valor: string): string {
  return createHash("sha256").update(valor).digest("hex");
}

export async function criarSessao(usuarioId: string, expiraEm?: Date, userAgent?: string | null): Promise<string> {
  const valor = randomBytes(32).toString("hex");
  await db.sessao.create({
    data: {
      id: hashSessao(valor),
      usuarioId,
      expiraEm: expiraEm ?? new Date(Date.now() + SESSAO_DURACAO_DIAS * 24 * 60 * 60 * 1000),
      userAgent: userAgent ? userAgent.slice(0, UA_MAX) : null,
    },
  });
  return valor;
}

/** Resolve o usuário de uma sessão viva. Expirada, inexistente ou usuário inativo → null. */
export async function obterUsuarioDaSessao(valor: string, agora: Date = new Date()): Promise<UsuarioSessao | null> {
  if (!/^[0-9a-f]{64}$/.test(valor)) return null;
  const id = hashSessao(valor);
  const s = await db.sessao.findUnique({
    where: { id },
    select: {
      expiraEm: true,
      ultimoUsoEm: true,
      usuario: {
        select: { id: true, nome: true, email: true, papel: true, area: true, cargos: true, ativo: true, foto: { select: { atualizadoEm: true } } },
      },
    },
  });
  if (!s || s.expiraEm.getTime() <= agora.getTime() || !s.usuario.ativo) return null;
  await tocarSessao(id, s.ultimoUsoEm, agora);
  const u = s.usuario;
  return { id: u.id, nome: u.nome, email: u.email, papel: u.papel, area: u.area, cargos: u.cargos, fotoEm: u.foto?.atualizadoEm.getTime() ?? null };
}

/**
 * Atualiza `ultimo_uso_em` só se passou da janela. O `lte` no where faz requests
 * simultâneos gravarem uma vez só. Falha aqui não derruba o request.
 */
async function tocarSessao(id: string, ultimoUsoEm: Date, agora: Date): Promise<void> {
  const limite = new Date(agora.getTime() - SESSAO_TOQUE_MINUTOS * 60 * 1000);
  if (ultimoUsoEm.getTime() > limite.getTime()) return;
  try {
    await db.sessao.updateMany({ where: { id, ultimoUsoEm: { lte: limite } }, data: { ultimoUsoEm: agora } });
  } catch (e) {
    registrarErro("auth.tocarSessao", e);
  }
}

export async function encerrarSessao(valor: string): Promise<void> {
  await db.sessao.deleteMany({ where: { id: hashSessao(valor) } });
}

export type SessaoListada = { id: string; userAgent: string | null; criadoEm: Date; ultimoUsoEm: Date; atual: boolean };

/** Sessões vivas do usuário, mais recente primeiro; `atual` marca a do cookie deste request. */
export async function listarSessoes(usuarioId: string, idAtual: string | null, agora: Date = new Date()): Promise<SessaoListada[]> {
  const lista = await db.sessao.findMany({
    where: { usuarioId, expiraEm: { gt: agora } },
    orderBy: [{ ultimoUsoEm: "desc" }, { criadoEm: "desc" }],
    select: { id: true, userAgent: true, criadoEm: true, ultimoUsoEm: true },
  });
  return lista.map((s) => ({ ...s, atual: s.id === idAtual }));
}

/** Encerra UMA sessão — só se for do próprio usuário (id forjado de outro → nada acontece). */
export async function encerrarSessaoDoUsuario(usuarioId: string, sessaoId: string): Promise<boolean> {
  const r = await db.sessao.deleteMany({ where: { id: sessaoId, usuarioId } });
  return r.count > 0;
}

/** Encerra todas as sessões do usuário menos a atual. Devolve quantas caíram. */
export async function encerrarOutrasSessoes(usuarioId: string, idAtual: string): Promise<number> {
  const r = await db.sessao.deleteMany({ where: { usuarioId, id: { not: idAtual } } });
  return r.count;
}

/** Limpeza oportunista; chamada pelo cron (GAB-41) ou manualmente. */
export async function apagarSessoesExpiradas(): Promise<number> {
  const r = await db.sessao.deleteMany({ where: { expiraEm: { lte: new Date() } } });
  return r.count;
}

/**
 * Entrar com Google, parte de banco: só entra quem a gestão já cadastrou
 * (mesmo email, sem diferenciar maiúsculas) e está ativo. Sem cadastro
 * automático. O `sub` do Google é gravado no 1º login e exigido depois; o
 * convite pendente (token) é resolvido.
 */
import { db } from "@/lib/db";
import { normalizarEmail } from "@/lib/normalizacao";

/** `motivo` é só para o log; a tela recebe só `erro`. */
export type RecusaGoogle =
  | { ok: false; erro: "NAO_CADASTRADO"; motivo: "desconhecido" | "inativo" }
  | { ok: false; erro: "CONTA_DIFERENTE"; motivo: "sub_diferente" | "sub_de_outro_usuario" };

export type ResultadoLoginGoogle = { ok: true; usuarioId: string; vinculou: boolean; conviteResolvido: boolean } | RecusaGoogle;

function ehUniqueDeSub(e: unknown): boolean {
  const err = e as { code?: string; meta?: { target?: string[] | string } };
  if (err?.code !== "P2002") return false;
  const alvo = err.meta?.target;
  return Array.isArray(alvo) ? alvo.includes("google_sub") : typeof alvo === "string" && alvo.includes("google_sub");
}

export async function entrarComGoogle(c: { sub: string; email: string }): Promise<ResultadoLoginGoogle> {
  const email = normalizarEmail(c.email);
  if (!email) return { ok: false, erro: "NAO_CADASTRADO", motivo: "desconhecido" };
  const u = await db.usuario.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, ativo: true, googleSub: true, conviteTokenHash: true, conviteExpiraEm: true },
  });
  if (!u) return { ok: false, erro: "NAO_CADASTRADO", motivo: "desconhecido" };
  if (!u.ativo) return { ok: false, erro: "NAO_CADASTRADO", motivo: "inativo" };
  if (u.googleSub !== null && u.googleSub !== c.sub) return { ok: false, erro: "CONTA_DIFERENTE", motivo: "sub_diferente" };

  const vinculou = u.googleSub === null;
  const conviteResolvido = u.conviteTokenHash !== null || u.conviteExpiraEm !== null;
  if (vinculou || conviteResolvido) {
    try {
      // `googleSub` null-ou-igual e `ativo` no where: se outro login amarrou outra
      // conta ou a gestão desativou no meio, nada é gravado.
      const r = await db.usuario.updateMany({
        where: { id: u.id, ativo: true, OR: [{ googleSub: null }, { googleSub: c.sub }] },
        data: { googleSub: c.sub, conviteTokenHash: null, conviteExpiraEm: null },
      });
      if (r.count === 0) return { ok: false, erro: "CONTA_DIFERENTE", motivo: "sub_diferente" };
    } catch (e) {
      // A mesma conta Google já está amarrada a outro usuário do CRM.
      if (ehUniqueDeSub(e)) return { ok: false, erro: "CONTA_DIFERENTE", motivo: "sub_de_outro_usuario" };
      throw e;
    }
    if (vinculou) console.info(`[auditoria] usuario.google_vinculado usuario=${u.id}`);
    if (conviteResolvido) console.info(`[auditoria] usuario.convite_resolvido_google usuario=${u.id}`);
  }
  return { ok: true, usuarioId: u.id, vinculou, conviteResolvido };
}

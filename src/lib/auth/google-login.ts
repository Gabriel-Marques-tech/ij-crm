/**
 * Entrar com Google, parte de banco: só entra quem a gestão já cadastrou
 * (mesmo email, sem diferenciar maiúsculas) e está ativo. Sem cadastro
 * automático. O `sub` do Google é gravado no 1º login e exigido depois; o
 * convite pendente (token) é resolvido.
 */
import type { Papel, Usuario } from "@prisma/client";
import { db } from "@/lib/db";
import { normalizarEmail } from "@/lib/normalizacao";
import { PAPEIS, podeGerarRedefinicao } from "./papeis";

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

/**
 * Email do Google → a forma gravada no banco, ou null. Igualdade EXATA depois
 * da mesma normalização de `criarConvite`/`trocarEmail` (nada de `ILIKE`: `_`
 * e `%` virariam curinga). Só ASCII: `toLowerCase` transforma o sinal Kelvin
 * (U+212A) em "k" e outros caracteres Unicode em ASCII, o que casaria uma
 * conta Google diferente com o email de outra pessoa. E a normalização não
 * pode ter mexido em nada além de maiúsculas (nada de aparar `<>`, `.`, `;`).
 */
export function emailParaBusca(bruto: string): string | null {
  const v = bruto.trim();
  if (!/^[\x21-\x7e]+$/.test(v)) return null;
  const email = normalizarEmail(v);
  return email !== null && email === v.toLowerCase() ? email : null;
}

export async function entrarComGoogle(c: { sub: string; email: string }): Promise<ResultadoLoginGoogle> {
  const email = emailParaBusca(c.email);
  if (!email) return { ok: false, erro: "NAO_CADASTRADO", motivo: "desconhecido" };
  const u = await db.usuario.findUnique({
    where: { email },
    select: { id: true, ativo: true, googleSub: true, conviteTokenHash: true, conviteExpiraEm: true },
  });
  if (!u) return { ok: false, erro: "NAO_CADASTRADO", motivo: "desconhecido" };
  if (!u.ativo) return { ok: false, erro: "NAO_CADASTRADO", motivo: "inativo" };
  if (u.googleSub !== null && u.googleSub !== c.sub) return { ok: false, erro: "CONTA_DIFERENTE", motivo: "sub_diferente" };

  const vinculou = u.googleSub === null;
  // Só o 1º login com Google resolve o convite. Link gerado DEPOIS (gestão dando senha a
  // quem já entra com Google) continua valendo nos logins seguintes.
  const conviteResolvido = vinculou && (u.conviteTokenHash !== null || u.conviteExpiraEm !== null);
  if (vinculou) {
    try {
      // `googleSub: null` e `ativo` no where: se outro login amarrou outra
      // conta ou a gestão desativou no meio, nada é gravado.
      const r = await db.usuario.updateMany({
        where: { id: u.id, ativo: true, googleSub: null },
        data: { googleSub: c.sub, ...(conviteResolvido ? { conviteTokenHash: null, conviteExpiraEm: null } : {}) },
      });
      if (r.count === 0) return { ok: false, erro: "CONTA_DIFERENTE", motivo: "sub_diferente" };
    } catch (e) {
      // A mesma conta Google já está amarrada a outro usuário do CRM.
      if (ehUniqueDeSub(e)) return { ok: false, erro: "CONTA_DIFERENTE", motivo: "sub_de_outro_usuario" };
      throw e;
    }
    console.info(`[auditoria] usuario.google_vinculado usuario=${u.id}`);
    if (conviteResolvido) console.info(`[auditoria] usuario.convite_resolvido_google usuario=${u.id}`);
  }
  return { ok: true, usuarioId: u.id, vinculou, conviteResolvido };
}

export type ErroDesligarGoogle = "USUARIO_NAO_ENCONTRADO" | "PAPEL_NAO_PERMITIDO" | "NAO_PODE_ALTERAR_A_SI" | "SEM_GOOGLE";

/**
 * Gestão: desliga a conta Google amarrada (`google_sub` = null), ex.: a pessoa
 * recriou a conta Google. O próximo login com Google amarra de novo. Mesma
 * regra do link de redefinição (é tomada de conta): só papel estritamente
 * inferior (gestor → vendedor…), admin → qualquer um, ninguém em si mesmo.
 */
export async function desligarGoogle(usuarioId: string, por: Pick<Usuario, "id" | "papel">): Promise<{ ok: true } | { ok: false; erro: ErroDesligarGoogle }> {
  const alvo = await db.usuario.findUnique({ where: { id: usuarioId }, select: { id: true, papel: true, googleSub: true } });
  if (!alvo) return { ok: false, erro: "USUARIO_NAO_ENCONTRADO" };
  if (alvo.id === por.id) return { ok: false, erro: "NAO_PODE_ALTERAR_A_SI" };
  if (!podeGerarRedefinicao(por.papel, alvo.papel)) return { ok: false, erro: "PAPEL_NAO_PERMITIDO" };
  if (alvo.googleSub === null) return { ok: false, erro: "SEM_GOOGLE" };
  // `papel` no where: promovido no meio → nada é gravado.
  const permitidos: Papel[] = PAPEIS.filter((p) => podeGerarRedefinicao(por.papel, p));
  const r = await db.usuario.updateMany({ where: { id: alvo.id, papel: { in: permitidos }, googleSub: { not: null } }, data: { googleSub: null } });
  if (r.count === 0) return { ok: false, erro: "PAPEL_NAO_PERMITIDO" };
  console.info(`[auditoria] usuario.google_desligado usuario=${alvo.id} por=${por.id}`);
  return { ok: true };
}

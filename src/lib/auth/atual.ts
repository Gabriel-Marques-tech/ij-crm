import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Papel } from "@prisma/client";
import { temPapelMinimo } from "./papeis";
import { obterUsuarioDaSessao, type UsuarioSessao } from "./sessao";

export const COOKIE_SESSAO = "ij_sessao";

export function opcoesCookieSessao(expiraEm: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiraEm,
  };
}

/** Usuário da sessão atual, resolvido uma vez por request (React cache). */
export const usuarioAtual = cache(async (): Promise<UsuarioSessao | null> => {
  const jar = await cookies();
  const id = jar.get(COOKIE_SESSAO)?.value;
  if (!id) return null;
  return obterUsuarioDaSessao(id);
});

export async function exigirUsuario(): Promise<UsuarioSessao> {
  const u = await usuarioAtual();
  if (!u) redirect("/login");
  return u;
}

/** Papel insuficiente → 403 (página `forbidden`). */
export async function exigirPapel(minimo: Papel): Promise<UsuarioSessao> {
  const u = await exigirUsuario();
  if (!temPapelMinimo(u.papel, minimo)) redirect("/403");
  return u;
}

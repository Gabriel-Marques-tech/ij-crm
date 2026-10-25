"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { COOKIE_SESSAO, opcoesCookieSessao } from "./atual";
import { limitadorLogin } from "./limitador";
import { SESSAO_DURACAO_DIAS, criarSessao, encerrarSessao } from "./sessao";
import { aceitarConvite, autenticar } from "./usuarios";
import { comTratamentoForm } from "@/lib/erros/registrar";

export type EstadoForm = { erro?: string } | undefined;

async function abrirSessao(usuarioId: string) {
  const expiraEm = new Date(Date.now() + SESSAO_DURACAO_DIAS * 24 * 60 * 60 * 1000);
  const id = await criarSessao(usuarioId, expiraEm);
  const jar = await cookies();
  jar.set(COOKIE_SESSAO, id, opcoesCookieSessao(expiraEm));
}

const loginSchema = z.object({ email: z.string().min(1), senha: z.string().min(1) });

export async function loginAction(_prev: EstadoForm, form: FormData): Promise<EstadoForm> {
  return comTratamentoForm("auth.login", async (): Promise<EstadoForm> => {
    const parsed = loginSchema.safeParse({ email: form.get("email"), senha: form.get("senha") });
    if (!parsed.success) return { erro: "Informe email e senha." };
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
    const chave = `${parsed.data.email.trim().toLowerCase()}|${ip}`;
    if (limitadorLogin.bloqueado(chave)) return { erro: "Muitas tentativas. Aguarde 15 minutos." };
    const r = await autenticar(parsed.data.email, parsed.data.senha);
    if (!r.ok) {
      limitadorLogin.registrarFalha(chave);
      return { erro: "Email ou senha incorretos." };
    }
    limitadorLogin.registrarSucesso(chave);
    await abrirSessao(r.usuarioId);
    redirect("/");
  });
}

export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  const id = jar.get(COOKIE_SESSAO)?.value;
  if (id) await encerrarSessao(id);
  jar.delete(COOKIE_SESSAO);
  redirect("/login");
}

const conviteSchema = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/),
  senha: z.string(),
  confirmacao: z.string(),
});

export async function aceitarConviteAction(_prev: EstadoForm, form: FormData): Promise<EstadoForm> {
  return comTratamentoForm("auth.aceitarConvite", async (): Promise<EstadoForm> => {
    const parsed = conviteSchema.safeParse({
      token: form.get("token"),
      senha: form.get("senha"),
      confirmacao: form.get("confirmacao"),
    });
    if (!parsed.success) return { erro: "Convite inválido." };
    if (parsed.data.senha !== parsed.data.confirmacao) return { erro: "As senhas não conferem." };
    const r = await aceitarConvite(parsed.data.token, parsed.data.senha);
    if (!r.ok) {
      return { erro: r.erro === "SENHA_FRACA" ? "Senha precisa ter pelo menos 8 caracteres." : "Convite inválido ou expirado." };
    }
    await abrirSessao(r.usuarioId);
    redirect("/");
  });
}

"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { COOKIE_SESSAO, opcoesCookieSessao } from "./atual";
import { ipDoCliente } from "./ip";
import { freioEsqueci, limitadorLogin } from "./limitador";
import { MENSAGEM_REDEFINICAO, pedirRedefinicao, redefinirSenha } from "./redefinicao";
import { SESSAO_DURACAO_DIAS, criarSessao, encerrarSessao } from "./sessao";
import { aceitarConvite, autenticar } from "./usuarios";
import { comTratamentoForm } from "@/lib/erros/registrar";

export type EstadoForm = { erro?: string } | undefined;

async function abrirSessao(usuarioId: string) {
  const expiraEm = new Date(Date.now() + SESSAO_DURACAO_DIAS * 24 * 60 * 60 * 1000);
  const id = await criarSessao(usuarioId, expiraEm, (await headers()).get("user-agent"));
  const jar = await cookies();
  jar.set(COOKIE_SESSAO, id, opcoesCookieSessao(expiraEm));
}

async function ipDoRequest(): Promise<string> {
  return ipDoCliente(await headers());
}

const loginSchema = z.object({ email: z.string().min(1), senha: z.string().min(1) });

export async function loginAction(_prev: EstadoForm, form: FormData): Promise<EstadoForm> {
  return comTratamentoForm("auth.login", async (): Promise<EstadoForm> => {
    const parsed = loginSchema.safeParse({ email: form.get("email"), senha: form.get("senha") });
    if (!parsed.success) return { erro: "Informe email e senha." };
    const ip = await ipDoRequest();
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

export type EstadoEsqueci = { erro?: string; enviado?: true } | undefined;

// Tempo mínimo de resposta: email existente/inexistente/bloqueado demoram igual.
const ESQUECI_TEMPO_MINIMO_MS = 700;

export async function pedirRedefinicaoAction(_prev: EstadoEsqueci, form: FormData): Promise<EstadoEsqueci> {
  return comTratamentoForm("auth.pedirRedefinicao", async (): Promise<EstadoEsqueci> => {
    const inicio = Date.now();
    const email = String(form.get("email") ?? "").trim().toLowerCase().slice(0, 320);
    if (!email) return { erro: "Informe seu email." };
    const ip = await ipDoRequest();
    // Limite por IP e por IP+email (em memória — ver limitador.ts). Acima dele → mesma resposta, sem gravar.
    if (freioEsqueci.tentar(ip, email)) await pedirRedefinicao(email);
    const falta = ESQUECI_TEMPO_MINIMO_MS - (Date.now() - inicio);
    if (falta > 0) await new Promise((r) => setTimeout(r, falta));
    return { enviado: true };
  });
}

const redefinirSchema = z.object({ token: z.string().regex(/^[0-9a-f]{64}$/), senha: z.string(), confirmacao: z.string() });

export async function redefinirSenhaAction(_prev: EstadoForm, form: FormData): Promise<EstadoForm> {
  return comTratamentoForm("auth.redefinirSenha", async (): Promise<EstadoForm> => {
    const parsed = redefinirSchema.safeParse({ token: form.get("token"), senha: form.get("senha"), confirmacao: form.get("confirmacao") });
    if (!parsed.success) return { erro: MENSAGEM_REDEFINICAO.TOKEN_INVALIDO };
    const r = await redefinirSenha(parsed.data.token, parsed.data.senha, parsed.data.confirmacao);
    if (!r.ok) return { erro: MENSAGEM_REDEFINICAO[r.erro] };
    // Todas as sessões caíram (inclusive a deste navegador, se houver): entra de novo.
    (await cookies()).delete(COOKIE_SESSAO);
    redirect("/login?redefinida=1");
  });
}

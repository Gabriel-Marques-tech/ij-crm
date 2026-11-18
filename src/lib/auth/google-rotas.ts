/**
 * Rotas do "Entrar com Google": `/api/auth/google` (inicia) e
 * `/api/auth/google/callback`. Sem GOOGLE_CLIENT_ID/SECRET → 404.
 *
 * Toda recusa volta ao /login com `erro` (código curto) e `ref`; o log tem a
 * causa com a mesma ref. Nunca loga código, token nem segredo.
 */
import "server-only";
import { NextResponse } from "next/server";
import { registrarErro } from "@/lib/erros/registrar";
import { urlBase } from "@/lib/mcp/url";
import { COOKIE_SESSAO, opcoesCookieSessao } from "./atual";
import { mascararEmail } from "./conta";
import { destinoSeguro } from "./destino";
import { type CodigoErroGoogle, configGoogle, dominioPermitido, guardaPedidosGoogle, trocarCodigo, urlAutorizacao, verificarIdToken } from "./google";
import { entrarComGoogle } from "./google-login";
import { ipDoCliente } from "./ip";
import { limitadorGoogle } from "./limitador";
import { SESSAO_DURACAO_DIAS, criarSessao } from "./sessao";
import { COOKIE_AREA } from "./visibilidade";

export const COOKIE_STATE_GOOGLE = "ij_google_state";
const CAMINHO_COOKIE = "/api/auth/google";

function naoEncontrado(): Response {
  return new Response("Not Found", { status: 404 });
}

function novaRef(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

function apagarCookieState(res: NextResponse): NextResponse {
  res.cookies.set(COOKIE_STATE_GOOGLE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: CAMINHO_COOKIE, maxAge: 0 });
  return res;
}

function paraLogin(erro: CodigoErroGoogle, ref: string, voltar: string | null): NextResponse {
  const u = new URL(`${urlBase()}/login`);
  u.searchParams.set("erro", erro);
  u.searchParams.set("ref", ref);
  if (voltar) u.searchParams.set("voltar", voltar);
  return apagarCookieState(NextResponse.redirect(u, 303));
}

/** Recusa esperada: loga a causa (sem segredo) e volta ao login com a mesma ref. */
function recusar(erro: CodigoErroGoogle, motivo: string, ctx: { ip: string; voltar: string | null; email?: string }): NextResponse {
  const ref = novaRef();
  limitadorGoogle.registrarFalha(ctx.ip);
  console.warn(`[auth.google] ref=${ref} recusado erro=${erro} motivo=${motivo}${ctx.email ? ` email=${mascararEmail(ctx.email)}` : ""}`);
  return paraLogin(erro, ref, ctx.voltar);
}

function cookieDe(req: Request, nome: string): string | null {
  for (const parte of (req.headers.get("cookie") ?? "").split(";")) {
    const i = parte.indexOf("=");
    if (i > 0 && parte.slice(0, i).trim() === nome) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return null;
}

/** GET /api/auth/google?voltar=/caminho → redireciona ao Google. */
export async function iniciarLoginGoogle(req: Request): Promise<Response> {
  const cfg = configGoogle();
  if (!cfg) return naoEncontrado();
  const ip = ipDoCliente(req.headers);
  const voltar = destinoSeguro(new URL(req.url).searchParams.get("voltar"));
  if (limitadorGoogle.bloqueado(ip)) return recusar("limite", "limitador_inicio", { ip, voltar });
  limitadorGoogle.registrarFalha(ip); // todo início conta; o login concluído zera
  const pedido = guardaPedidosGoogle.criar(voltar);
  const res = NextResponse.redirect(urlAutorizacao(cfg, pedido), 303);
  res.cookies.set(COOKIE_STATE_GOOGLE, pedido.state, {
    httpOnly: true,
    // lax: o retorno do Google é navegação de topo (GET), então o cookie vai junto.
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: CAMINHO_COOKIE,
    maxAge: Math.floor(guardaPedidosGoogle.validadeMs / 1000),
  });
  res.headers.set("cache-control", "no-store");
  return res;
}

/** GET /api/auth/google/callback?code=…&state=… → sessão e volta para onde a pessoa estava. */
export async function callbackGoogle(req: Request): Promise<Response> {
  const cfg = configGoogle();
  if (!cfg) return naoEncontrado();
  const ip = ipDoCliente(req.headers);
  let voltar: string | null = null;
  try {
    const q = new URL(req.url).searchParams;
    if (limitadorGoogle.bloqueado(ip)) return recusar("limite", "limitador_callback", { ip, voltar });
    // Consome o pedido antes de tudo: mesmo um retorno com erro queima o state (uso único).
    const pedido = guardaPedidosGoogle.consumir(q.get("state"), cookieDe(req, COOKIE_STATE_GOOGLE));
    voltar = pedido ? destinoSeguro(pedido.voltar) : null;
    const erroGoogle = q.get("error");
    if (erroGoogle) {
      const motivo = `google_${erroGoogle.replace(/[^a-z_]/gi, "").slice(0, 40)}`;
      return recusar(erroGoogle === "access_denied" ? "cancelado" : "falha", motivo, { ip, voltar });
    }
    if (!pedido) return recusar("expirado", "state_invalido_ou_reutilizado", { ip, voltar });
    const codigo = q.get("code");
    if (!codigo || codigo.length > 2048) return recusar("falha", "sem_code", { ip, voltar });

    const idToken = await trocarCodigo(cfg, codigo, pedido.verificador);
    const v = await verificarIdToken(idToken, { clientId: cfg.clientId, nonce: pedido.nonce });
    if (!v.ok) {
      // Email não verificado tem a mesma mensagem de "não cadastrado" (não revela nada além).
      return v.erro === "EMAIL_NAO_VERIFICADO" || v.erro === "SEM_EMAIL"
        ? recusar("nao_cadastrado", `id_token_${v.erro.toLowerCase()}`, { ip, voltar })
        : recusar("falha", `id_token_${v.erro.toLowerCase()}`, { ip, voltar });
    }
    const { claims } = v;
    if (!dominioPermitido(claims, cfg.dominios)) return recusar("dominio", `dominio_nao_permitido hd=${claims.hd ?? "-"}`, { ip, voltar, email: claims.email });

    const r = await entrarComGoogle(claims);
    if (!r.ok) return recusar(r.erro === "NAO_CADASTRADO" ? "nao_cadastrado" : "conta_diferente", r.motivo, { ip, voltar, email: claims.email });

    limitadorGoogle.registrarSucesso(ip);
    const expiraEm = new Date(Date.now() + SESSAO_DURACAO_DIAS * 24 * 60 * 60 * 1000);
    const sessao = await criarSessao(r.usuarioId, expiraEm, req.headers.get("user-agent"));
    console.info(`[auditoria] usuario.login_google usuario=${r.usuarioId}`);
    const res = apagarCookieState(NextResponse.redirect(`${urlBase()}${voltar ?? "/"}`, 303));
    res.cookies.set(COOKIE_SESSAO, sessao, opcoesCookieSessao(expiraEm));
    // Como no login por senha: começa na própria área de entrada.
    res.cookies.set(COOKIE_AREA, "", { path: "/", maxAge: 0 });
    return res;
  } catch (e) {
    limitadorGoogle.registrarFalha(ip);
    return paraLogin("falha", registrarErro("auth.google.callback", e), voltar);
  }
}

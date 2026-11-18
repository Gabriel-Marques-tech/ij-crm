/**
 * Entrar com Google (OIDC authorization code + PKCE), sem dependência nova:
 * `fetch` nos endpoints fixos do Google e WebCrypto para a assinatura do
 * `id_token`. A parte de banco (casar email, amarrar `sub`) está em
 * ./google-login.ts; as rotas, em src/app/api/auth/google.
 *
 * NÃO confundir com src/lib/mcp/oauth.ts: lá o CRM é o PROVEDOR OAuth do
 * conector MCP; aqui o CRM é CLIENTE do Google.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { urlBase } from "@/lib/mcp/url";

/** Endpoints fixos (os mesmos do `.well-known/openid-configuration` do Google). */
export const GOOGLE_ENDPOINTS = {
  autorizacao: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  jwks: "https://www.googleapis.com/oauth2/v3/certs",
} as const;

const EMISSORES = new Set(["https://accounts.google.com", "accounts.google.com"]);
/** Tolerância de relógio entre a VPS e o Google. */
const FOLGA_RELOGIO_S = 60;
const TIMEOUT_FETCH_MS = 10_000;

export type ConfigGoogle = { clientId: string; clientSecret: string; dominios: string[]; redirectUri: string };

/**
 * `GOOGLE_DOMINIOS_PERMITIDOS` → domínios em minúsculas, sem `@` nem espaços.
 * Vazio ou `*` = qualquer domínio (`*` existe porque nos compose de produção o
 * valor vazio cai no padrão `sou.inteli.edu.br`).
 */
export function lerDominios(v: string | undefined): string[] {
  const lista = (v ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
  return lista.includes("*") ? [] : lista;
}

/** Sem `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` → null: botão some e as rotas dão 404. */
export function configGoogle(env: NodeJS.ProcessEnv = process.env): ConfigGoogle | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, dominios: lerDominios(env.GOOGLE_DOMINIOS_PERMITIDOS), redirectUri: `${urlBase()}/api/auth/google/callback` };
}

export function googleConfigurado(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim());
}

// ---------------------------------------------------------------- PKCE, state e nonce

function aleatorio(): string {
  return randomBytes(32).toString("base64url");
}

/** RFC 7636, S256. */
export function desafioPkce(verificador: string): string {
  return createHash("sha256").update(verificador).digest("base64url");
}

export function urlAutorizacao(cfg: ConfigGoogle, p: { state: string; nonce: string; desafio: string }): string {
  const u = new URL(GOOGLE_ENDPOINTS.autorizacao);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "openid email");
  u.searchParams.set("state", p.state);
  u.searchParams.set("nonce", p.nonce);
  u.searchParams.set("code_challenge", p.desafio);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("prompt", "select_account");
  // Com um domínio só, o Google já mostra as contas dele (é só dica: a checagem é no callback).
  if (cfg.dominios.length === 1) u.searchParams.set("hd", cfg.dominios[0]);
  return u.toString();
}

export type PedidoGoogle = { nonce: string; verificador: string; voltar: string | null };
type Guardado = PedidoGoogle & { expiraEm: number };

/**
 * Pedidos de login em andamento, comparados no SERVIDOR (memória do processo,
 * como o limitador — processo único). O navegador recebe o `state` num cookie
 * httpOnly; o callback exige `state` da URL = cookie e consome a entrada
 * (uso único, mesmo se expirada). nonce e verificador PKCE nunca saem daqui.
 * Reinício do processo derruba logins em andamento: a pessoa clica de novo.
 */
export class GuardaPedidosGoogle {
  private readonly pedidos = new Map<string, Guardado>();

  constructor(private readonly cfg: { validadeMs: number; maxPedidos: number } = { validadeMs: 10 * 60 * 1000, maxPedidos: 5000 }) {}

  get tamanho(): number {
    return this.pedidos.size;
  }

  get validadeMs(): number {
    return this.cfg.validadeMs;
  }

  private chave(state: string): string {
    return createHash("sha256").update(state).digest("hex");
  }

  criar(voltar: string | null, agora: number = Date.now()): { state: string; nonce: string; desafio: string } {
    for (const [k, p] of this.pedidos) {
      if (p.expiraEm > agora) break; // ordem de inserção = ordem de expiração
      this.pedidos.delete(k);
    }
    while (this.pedidos.size >= this.cfg.maxPedidos) this.pedidos.delete(this.pedidos.keys().next().value as string);
    const state = aleatorio();
    const nonce = aleatorio();
    const verificador = aleatorio();
    this.pedidos.set(this.chave(state), { nonce, verificador, voltar, expiraEm: agora + this.cfg.validadeMs });
    return { state, nonce, desafio: desafioPkce(verificador) };
  }

  /** `state` da URL tem de bater com o do cookie; a entrada morre aqui (uso único). */
  consumir(stateUrl: string | null, stateCookie: string | null | undefined, agora: number = Date.now()): PedidoGoogle | null {
    if (!stateUrl || !stateCookie || stateUrl.length > 200) return null;
    const a = Buffer.from(stateUrl);
    const b = Buffer.from(stateCookie);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const k = this.chave(stateUrl);
    const p = this.pedidos.get(k);
    this.pedidos.delete(k);
    if (!p || p.expiraEm <= agora) return null;
    return { nonce: p.nonce, verificador: p.verificador, voltar: p.voltar };
  }
}

const g = globalThis as unknown as { guardaPedidosGoogle?: GuardaPedidosGoogle };
export const guardaPedidosGoogle = (g.guardaPedidosGoogle ??= new GuardaPedidosGoogle());

// ---------------------------------------------------------------- token endpoint

/** Erro de comunicação com o Google: a mensagem vai para o log (nunca código, token nem segredo). */
export class ErroGoogle extends Error {
  override name = "ErroGoogle";
}

/** Troca o código pelo `id_token` (TLS direto com o Google). */
export async function trocarCodigo(cfg: ConfigGoogle, codigo: string, verificador: string): Promise<string> {
  const corpo = new URLSearchParams({
    grant_type: "authorization_code",
    code: codigo,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    code_verifier: verificador,
  });
  const r = await fetch(GOOGLE_ENDPOINTS.token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: corpo,
    signal: AbortSignal.timeout(TIMEOUT_FETCH_MS),
    cache: "no-store",
  });
  const json = (await r.json().catch(() => null)) as { id_token?: unknown; error?: unknown } | null;
  if (!r.ok) {
    // `error` é um código curto do OAuth (ex.: invalid_grant, invalid_client): seguro para log.
    const codigoErro = typeof json?.error === "string" ? json.error.replace(/[^a-z_]/gi, "").slice(0, 40) : "sem_corpo";
    throw new ErroGoogle(`token endpoint respondeu ${r.status} (${codigoErro})`);
  }
  if (typeof json?.id_token !== "string") throw new ErroGoogle("token endpoint sem id_token");
  return json.id_token;
}

// ---------------------------------------------------------------- id_token

export type ClaimsGoogle = { sub: string; email: string; hd: string | null };
export type ErroIdToken = "FORMATO" | "ALGORITMO" | "CHAVE_DESCONHECIDA" | "ASSINATURA" | "EMISSOR" | "AUDIENCIA" | "EXPIRADO" | "NONCE" | "SEM_EMAIL" | "EMAIL_NAO_VERIFICADO";
export type ResultadoIdToken = { ok: true; claims: ClaimsGoogle } | { ok: false; erro: ErroIdToken };

function decodificarParte(parte: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(Buffer.from(parte, "base64url").toString("utf8")) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Claims do Google (OIDC Core §3.1.3.7): emissor, audiência, validade, nonce e email verificado. */
export function validarClaims(payload: Record<string, unknown>, esperado: { clientId: string; nonce: string; agora?: number }): ResultadoIdToken {
  const agoraS = Math.floor((esperado.agora ?? Date.now()) / 1000);
  if (typeof payload.iss !== "string" || !EMISSORES.has(payload.iss)) return { ok: false, erro: "EMISSOR" };
  const aud = payload.aud;
  const audOk = typeof aud === "string" ? aud === esperado.clientId : Array.isArray(aud) && aud.includes(esperado.clientId) && payload.azp === esperado.clientId;
  // `azp` (parte autorizada), quando vem, tem de ser este cliente mesmo com `aud` string.
  if (!audOk || (payload.azp !== undefined && payload.azp !== esperado.clientId)) return { ok: false, erro: "AUDIENCIA" };
  if (typeof payload.exp !== "number" || payload.exp + FOLGA_RELOGIO_S <= agoraS) return { ok: false, erro: "EXPIRADO" };
  if (typeof payload.iat === "number" && payload.iat - FOLGA_RELOGIO_S > agoraS) return { ok: false, erro: "EXPIRADO" };
  if (typeof payload.nonce !== "string" || payload.nonce.length !== esperado.nonce.length || !timingSafeEqual(Buffer.from(payload.nonce), Buffer.from(esperado.nonce))) {
    return { ok: false, erro: "NONCE" };
  }
  if (typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 255) return { ok: false, erro: "FORMATO" };
  if (typeof payload.email !== "string" || !payload.email.includes("@")) return { ok: false, erro: "SEM_EMAIL" };
  // O Google manda booleano; aceita também a string antiga "true".
  if (payload.email_verified !== true && payload.email_verified !== "true") return { ok: false, erro: "EMAIL_NAO_VERIFICADO" };
  const hd = typeof payload.hd === "string" && payload.hd ? payload.hd.toLowerCase() : null;
  // Email como veio (só sem espaços): NÃO usar toLowerCase aqui, ele transforma o sinal
  // Kelvin (U+212A) em "k". A forma de busca exata é de `emailParaBusca` (google-login.ts).
  return { ok: true, claims: { sub: payload.sub, email: payload.email.trim(), hd } };
}

export type BuscaChave = (kid: string) => Promise<JsonWebKey | null>;

/**
 * Valida o `id_token`: assinatura RS256 com a chave pública do Google (JWKS)
 * e depois as claims. O token vem direto do token endpoint por TLS, então a
 * assinatura é defesa em profundidade — mas é barata, então conferimos.
 */
export async function verificarIdToken(jwt: string, esperado: { clientId: string; nonce: string; agora?: number }, buscarChave: BuscaChave = chaveDoGoogle): Promise<ResultadoIdToken> {
  const partes = jwt.split(".");
  if (partes.length !== 3 || jwt.length > 16_000) return { ok: false, erro: "FORMATO" };
  const cabecalho = decodificarParte(partes[0]);
  const payload = decodificarParte(partes[1]);
  if (!cabecalho || !payload) return { ok: false, erro: "FORMATO" };
  if (cabecalho.alg !== "RS256") return { ok: false, erro: "ALGORITMO" };
  if (typeof cabecalho.kid !== "string") return { ok: false, erro: "CHAVE_DESCONHECIDA" };
  const jwk = await buscarChave(cabecalho.kid);
  if (!jwk) return { ok: false, erro: "CHAVE_DESCONHECIDA" };
  let valida = false;
  try {
    const chave = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    valida = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", chave, Buffer.from(partes[2], "base64url"), new TextEncoder().encode(`${partes[0]}.${partes[1]}`));
  } catch {
    valida = false;
  }
  if (!valida) return { ok: false, erro: "ASSINATURA" };
  return validarClaims(payload, esperado);
}

// ---------------------------------------------------------------- JWKS (cache em memória)

type CacheJwks = { chaves: Map<string, JsonWebKey>; expiraEm: number; buscadoEm: number };
const gj = globalThis as unknown as { jwksGoogle?: CacheJwks };
const JWKS_PADRAO_MS = 60 * 60 * 1000;
/** Chave desconhecida força nova busca, no máximo uma vez por minuto (o Google gira as chaves). */
const JWKS_REBUSCA_MIN_MS = 60 * 1000;

async function buscarJwks(agora: number): Promise<CacheJwks> {
  const r = await fetch(GOOGLE_ENDPOINTS.jwks, { signal: AbortSignal.timeout(TIMEOUT_FETCH_MS), cache: "no-store" });
  if (!r.ok) throw new ErroGoogle(`JWKS respondeu ${r.status}`);
  const json = (await r.json()) as { keys?: Array<JsonWebKey & { kid?: string }> };
  const chaves = new Map<string, JsonWebKey>();
  for (const k of json.keys ?? []) if (k.kid && k.kty === "RSA") chaves.set(k.kid, k);
  const maxAge = Number(/max-age=(\d+)/.exec(r.headers.get("cache-control") ?? "")?.[1]);
  const validade = Number.isFinite(maxAge) && maxAge > 0 ? Math.min(maxAge * 1000, 24 * JWKS_PADRAO_MS) : JWKS_PADRAO_MS;
  return { chaves, expiraEm: agora + validade, buscadoEm: agora };
}

export async function chaveDoGoogle(kid: string): Promise<JsonWebKey | null> {
  const agora = Date.now();
  let c = gj.jwksGoogle;
  if (!c || c.expiraEm <= agora || (!c.chaves.has(kid) && agora - c.buscadoEm >= JWKS_REBUSCA_MIN_MS)) {
    c = gj.jwksGoogle = await buscarJwks(agora);
  }
  return c.chaves.get(kid) ?? null;
}

/** Só para testes: esquece as chaves em cache. */
export function esquecerJwksGoogle(): void {
  gj.jwksGoogle = undefined;
}

// ---------------------------------------------------------------- domínio

/**
 * `GOOGLE_DOMINIOS_PERMITIDOS` vazio = qualquer domínio (o email ainda precisa
 * estar cadastrado). Com lista: o domínio do email E o `hd` têm de estar nela.
 * `hd` é obrigatório: só conta gerenciada pelo Workspace do domínio o traz; uma
 * conta Google pessoal criada com um email do domínio não tem `hd` e é recusada.
 */
export function dominioPermitido(claims: Pick<ClaimsGoogle, "email" | "hd">, dominios: readonly string[]): boolean {
  if (dominios.length === 0) return true;
  const dominioEmail = claims.email.slice(claims.email.lastIndexOf("@") + 1).toLowerCase();
  return dominios.includes(dominioEmail) && claims.hd !== null && dominios.includes(claims.hd.toLowerCase());
}

// ---------------------------------------------------------------- mensagens da tela de login

export type CodigoErroGoogle = "nao_cadastrado" | "conta_diferente" | "dominio" | "expirado" | "cancelado" | "limite" | "falha";

/** Texto do /login para cada `?erro=` do callback (a ref vai junto, para cruzar com o log). */
export function mensagemErroGoogle(codigo: string | undefined, dominios: readonly string[]): string | null {
  switch (codigo) {
    case "nao_cadastrado":
      return "Seu email não está cadastrado no CRM. Peça a um gestor.";
    case "conta_diferente":
      return "Esta conta Google não é a que está ligada ao seu usuário do CRM. Entre com a conta de sempre ou peça a um gestor.";
    case "dominio":
      return dominios.length
        ? `Use sua conta Google ${dominios.map((d) => `@${d}`).join(" ou ")}. Contas de outro domínio não entram no CRM.`
        : "Esta conta Google não é de um domínio permitido.";
    case "expirado":
      return "O login com Google expirou ou foi aberto em outra aba. Tente de novo.";
    case "cancelado":
      return "Login com Google cancelado.";
    case "limite":
      return "Muitas tentativas. Aguarde 15 minutos.";
    case "falha":
      return "Não deu para entrar com Google agora. Tente de novo ou entre com email e senha.";
    default:
      return null;
  }
}

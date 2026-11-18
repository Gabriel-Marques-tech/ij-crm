// @vitest-environment node
/**
 * Entrar com Google de ponta a ponta, com o Google simulado (token endpoint e
 * JWKS respondidos por um `fetch` falso — nada de rede real).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { CLIENT_ID_TESTE, assinarIdToken, claimsTeste, gerarChavesTeste } from "@/test/google";
import { desafioPkce, esquecerJwksGoogle, GOOGLE_ENDPOINTS } from "@/lib/auth/google";
import { hashSessao } from "@/lib/auth/sessao";

vi.mock("server-only", () => ({}));

const { GET: iniciarGET } = await import("./route");
const { GET: callbackGET } = await import("./callback/route");
const db = dbTeste();
const BASE = "https://crm.ij.test";
const DOMINIO = "sou.inteli.edu.br";

const chaves = await gerarChavesTeste();
/** O que o Google falso põe no id_token desta vez (o nonce vem do pedido). */
let claimsDaVez: Record<string, unknown> = {};
let corpoToken: URLSearchParams | null = null;
let respostaToken: { status: number; json: unknown } | null = null;
let ipSeq = 0;
let ip = "";

const envOriginal = { ...process.env };

beforeAll(() => {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === GOOGLE_ENDPOINTS.token) {
      corpoToken = new URLSearchParams(String(init?.body));
      if (respostaToken) return Response.json(respostaToken.json, { status: respostaToken.status });
      // Conta do Workspace por padrão (`hd` do domínio); `hd: undefined` simula conta pessoal.
      const idToken = await assinarIdToken(chaves.privada, claimsTeste({ hd: DOMINIO, nonce: claimsDaVez.nonce, ...claimsDaVez }));
      return Response.json({ id_token: idToken, access_token: "nao-usado", token_type: "Bearer" });
    }
    if (url === GOOGLE_ENDPOINTS.jwks) return Response.json({ keys: [chaves.jwk] }, { headers: { "cache-control": "public, max-age=3600" } });
    throw new Error(`fetch inesperado nos testes: ${url}`);
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(async () => {
  await limparBanco(["sessao", "usuario"]);
  process.env.APP_URL = BASE;
  process.env.GOOGLE_CLIENT_ID = CLIENT_ID_TESTE;
  process.env.GOOGLE_CLIENT_SECRET = "segredo-de-teste";
  process.env.GOOGLE_DOMINIOS_PERMITIDOS = DOMINIO;
  claimsDaVez = {};
  corpoToken = null;
  respostaToken = null;
  ip = `10.0.0.${++ipSeq}`;
  esquecerJwksGoogle();
});

afterEach(() => {
  for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_DOMINIOS_PERMITIDOS", "APP_URL"]) {
    if (envOriginal[k] === undefined) delete process.env[k];
    else process.env[k] = envOriginal[k];
  }
});

async function iniciar(voltar?: string) {
  const res = await iniciarGET(new Request(`${BASE}/api/auth/google${voltar ? `?voltar=${encodeURIComponent(voltar)}` : ""}`, { headers: { "x-forwarded-for": ip } }));
  expect(res.status).toBe(303);
  const loc = new URL(res.headers.get("location")!);
  const state = loc.searchParams.get("state")!;
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith("ij_google_state="))!;
  expect(setCookie).toMatch(/HttpOnly/i);
  expect(setCookie).toMatch(/Path=\/api\/auth\/google/);
  claimsDaVez.nonce = loc.searchParams.get("nonce");
  return { loc, state, cookie: `ij_google_state=${state}` };
}

async function voltarDoGoogle(p: { state: string | null; cookie?: string; code?: string; error?: string }) {
  const q = new URLSearchParams();
  if (p.state !== null) q.set("state", p.state);
  if (p.code !== undefined) q.set("code", p.code);
  else if (!p.error) q.set("code", "codigo-de-teste");
  if (p.error) q.set("error", p.error);
  return callbackGET(new Request(`${BASE}/api/auth/google/callback?${q}`, { headers: { cookie: p.cookie ?? "", "x-forwarded-for": ip, "user-agent": "vitest" } }));
}

function destino(res: Response) {
  return new URL(res.headers.get("location")!);
}

function cookieSessao(res: Response): string | null {
  const c = res.headers.getSetCookie().find((x) => x.startsWith("ij_sessao="));
  return c ? c.slice("ij_sessao=".length).split(";")[0] : null;
}

async function criarUsuario(dados: { email: string; ativo?: boolean; googleSub?: string | null; convite?: boolean }) {
  return db.usuario.create({
    data: {
      nome: "Ana",
      email: dados.email,
      ativo: dados.ativo ?? true,
      googleSub: dados.googleSub ?? null,
      senhaHash: dados.convite ? null : "hash-qualquer",
      conviteTokenHash: dados.convite ? "a".repeat(64) : null,
      conviteExpiraEm: dados.convite ? new Date(Date.now() + 86_400_000) : null,
    },
  });
}

describe("Entrar com Google", () => {
  it("usuário ativo entra: sessão criada, sub gravado, volta ao destino", async () => {
    const u = await criarUsuario({ email: `ana@${DOMINIO}` });
    const { loc, state, cookie } = await iniciar("/projetos?aba=1");
    expect(loc.searchParams.get("redirect_uri")).toBe(`${BASE}/api/auth/google/callback`);
    expect(loc.searchParams.get("hd")).toBe(DOMINIO);
    claimsDaVez = { ...claimsDaVez, email: `Ana@${DOMINIO.toUpperCase()}`, sub: "sub-ana", hd: DOMINIO };

    const res = await voltarDoGoogle({ state, cookie });
    expect(res.status).toBe(303);
    expect(destino(res).toString()).toBe(`${BASE}/projetos?aba=1`);
    const valor = cookieSessao(res);
    expect(valor).toMatch(/^[0-9a-f]{64}$/);
    const sessao = await db.sessao.findUnique({ where: { id: hashSessao(valor!) } });
    expect(sessao?.usuarioId).toBe(u.id);
    expect(sessao?.userAgent).toBe("vitest");
    expect((await db.usuario.findUnique({ where: { id: u.id } }))?.googleSub).toBe("sub-ana");
    // PKCE: o verificador mandado ao token endpoint corresponde ao desafio do início.
    expect(desafioPkce(corpoToken!.get("code_verifier")!)).toBe(loc.searchParams.get("code_challenge"));
    expect(corpoToken!.get("redirect_uri")).toBe(`${BASE}/api/auth/google/callback`);
    // cookie de state apagado
    expect(res.headers.getSetCookie().find((c) => c.startsWith("ij_google_state="))).toMatch(/Max-Age=0/);
  });

  it("voltar externo é ignorado: cai em /", async () => {
    await criarUsuario({ email: `ana@${DOMINIO}` });
    const { state, cookie } = await iniciar("//evil.example/x");
    claimsDaVez = { ...claimsDaVez, email: `ana@${DOMINIO}`, sub: "sub-ana" };
    expect(destino(await voltarDoGoogle({ state, cookie })).toString()).toBe(`${BASE}/`);
  });

  it("segundo login com o mesmo sub entra; sub diferente é recusado", async () => {
    await criarUsuario({ email: `ana@${DOMINIO}`, googleSub: "sub-ana" });
    let p = await iniciar();
    claimsDaVez = { ...claimsDaVez, email: `ana@${DOMINIO}`, sub: "sub-ana" };
    expect(cookieSessao(await voltarDoGoogle(p))).not.toBeNull();

    p = await iniciar();
    claimsDaVez = { ...claimsDaVez, email: `ana@${DOMINIO}`, sub: "sub-intruso" };
    const res = await voltarDoGoogle(p);
    expect(cookieSessao(res)).toBeNull();
    expect(destino(res).searchParams.get("erro")).toBe("conta_diferente");
    expect(destino(res).searchParams.get("ref")).toMatch(/^[0-9a-f]{8}$/);
    expect(await db.sessao.count()).toBe(1);
  });

  it("mesma conta Google já ligada a outro usuário é recusada", async () => {
    await criarUsuario({ email: `outra@${DOMINIO}`, googleSub: "sub-ana" });
    await criarUsuario({ email: `ana@${DOMINIO}` });
    const p = await iniciar();
    claimsDaVez = { ...claimsDaVez, email: `ana@${DOMINIO}`, sub: "sub-ana" };
    const res = await voltarDoGoogle(p);
    expect(destino(res).searchParams.get("erro")).toBe("conta_diferente");
    expect(await db.sessao.count()).toBe(0);
  });

  it.each([
    ["desconhecido", async () => undefined, { email: `ninguem@${DOMINIO}` }],
    ["inativo", async () => criarUsuario({ email: `ana@${DOMINIO}`, ativo: false }), { email: `ana@${DOMINIO}` }],
    ["não verificado", async () => criarUsuario({ email: `ana@${DOMINIO}` }), { email: `ana@${DOMINIO}`, email_verified: false }],
  ])("%s → volta ao login com 'não cadastrado' e ref no log", async (_n, preparar, claims) => {
    await preparar();
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = await iniciar("/kanban");
    claimsDaVez = { ...claimsDaVez, sub: "sub-x", ...claims };
    const res = await voltarDoGoogle(p);
    const d = destino(res);
    expect(d.pathname).toBe("/login");
    expect(d.searchParams.get("erro")).toBe("nao_cadastrado");
    expect(d.searchParams.get("voltar")).toBe("/kanban");
    const ref = d.searchParams.get("ref")!;
    const linha = aviso.mock.calls.map((c) => String(c[0])).find((l) => l.includes(`ref=${ref}`));
    expect(linha).toBeDefined();
    // log sem email inteiro, sem código nem token
    expect(linha).not.toContain("codigo-de-teste");
    expect(linha).not.toMatch(/ana@|ninguem@/);
    expect(cookieSessao(res)).toBeNull();
    expect(await db.sessao.count()).toBe(0);
    aviso.mockRestore();
  });

  it("email de outro domínio, mesmo cadastrado, é recusado com mensagem de domínio", async () => {
    await criarUsuario({ email: "ana@gmail.com" });
    const p = await iniciar();
    claimsDaVez = { ...claimsDaVez, email: "ana@gmail.com", sub: "sub-ana" };
    const res = await voltarDoGoogle(p);
    expect(destino(res).searchParams.get("erro")).toBe("dominio");
    expect(await db.sessao.count()).toBe(0);
    expect((await db.usuario.findFirst())?.googleSub).toBeNull();
  });

  it("conta Google pessoal (sem hd) com email do domínio é recusada", async () => {
    await criarUsuario({ email: `ana@${DOMINIO}` });
    const p = await iniciar();
    claimsDaVez = { ...claimsDaVez, email: `ana@${DOMINIO}`, hd: undefined, sub: "sub-ana" };
    expect(destino(await voltarDoGoogle(p)).searchParams.get("erro")).toBe("dominio");
    expect(await db.sessao.count()).toBe(0);
  });

  it.each([
    ["_ (curinga de um caractere no LIKE)", "jo_o.silva", "joao.silva"],
    ["% (curinga de vários no LIKE)", "jo%", "joao.silva"],
    ["sinal Kelvin U+212A", "\u212Aarla", "karla"],
  ])("email com %s não casa com outro usuário", async (_n, localGoogle, localCadastrado) => {
    const u = await criarUsuario({ email: `${localCadastrado}@${DOMINIO}` });
    const p = await iniciar();
    claimsDaVez = { ...claimsDaVez, email: `${localGoogle}@${DOMINIO}`, sub: "sub-intruso" };
    const res = await voltarDoGoogle(p);
    expect(destino(res).searchParams.get("erro")).toBe("nao_cadastrado");
    expect(await db.sessao.count()).toBe(0);
    expect((await db.usuario.findUnique({ where: { id: u.id } }))?.googleSub).toBeNull();
  });

  it("email com _ entra no próprio usuário (igualdade exata)", async () => {
    const certo = await criarUsuario({ email: `jo_o@${DOMINIO}` });
    await criarUsuario({ email: `joao@${DOMINIO}` });
    const p = await iniciar();
    claimsDaVez = { ...claimsDaVez, email: `jo_o@${DOMINIO}`, sub: "sub-jo" };
    const valor = cookieSessao(await voltarDoGoogle(p));
    expect((await db.sessao.findUnique({ where: { id: hashSessao(valor!) } }))?.usuarioId).toBe(certo.id);
  });

  it("hd de outro Workspace com email do domínio permitido é recusado", async () => {
    await criarUsuario({ email: `ana@${DOMINIO}` });
    const p = await iniciar();
    claimsDaVez = { ...claimsDaVez, email: `ana@${DOMINIO}`, hd: "outra.com", sub: "sub-ana" };
    expect(destino(await voltarDoGoogle(p)).searchParams.get("erro")).toBe("dominio");
  });

  it("sem lista de domínios, qualquer domínio cadastrado entra", async () => {
    process.env.GOOGLE_DOMINIOS_PERMITIDOS = "";
    await criarUsuario({ email: "ana@gmail.com" });
    const p = await iniciar();
    claimsDaVez = { ...claimsDaVez, email: "ana@gmail.com", sub: "sub-ana" };
    expect(cookieSessao(await voltarDoGoogle(p))).not.toBeNull();
  });

  it("convite pendente é resolvido (token apagado) e a pessoa entra", async () => {
    const u = await criarUsuario({ email: `ana@${DOMINIO}`, convite: true });
    const p = await iniciar();
    claimsDaVez = { ...claimsDaVez, email: `ana@${DOMINIO}`, sub: "sub-ana" };
    expect(cookieSessao(await voltarDoGoogle(p))).not.toBeNull();
    const depois = await db.usuario.findUnique({ where: { id: u.id } });
    expect(depois?.conviteTokenHash).toBeNull();
    expect(depois?.conviteExpiraEm).toBeNull();
    expect(depois?.googleSub).toBe("sub-ana");
  });

  it("state reutilizado é recusado", async () => {
    await criarUsuario({ email: `ana@${DOMINIO}` });
    const p = await iniciar();
    claimsDaVez = { ...claimsDaVez, email: `ana@${DOMINIO}`, sub: "sub-ana" };
    expect(cookieSessao(await voltarDoGoogle(p))).not.toBeNull();
    const res = await voltarDoGoogle(p);
    expect(destino(res).searchParams.get("erro")).toBe("expirado");
    expect(cookieSessao(res)).toBeNull();
    expect(await db.sessao.count()).toBe(1);
  });

  it("state inválido, sem cookie ou de outro navegador é recusado sem chamar o Google", async () => {
    await criarUsuario({ email: `ana@${DOMINIO}` });
    const p = await iniciar();
    expect(destino(await voltarDoGoogle({ state: "inventado", cookie: "ij_google_state=inventado" })).searchParams.get("erro")).toBe("expirado");
    expect(destino(await voltarDoGoogle({ state: p.state })).searchParams.get("erro")).toBe("expirado");
    expect(destino(await voltarDoGoogle({ state: null, cookie: p.cookie })).searchParams.get("erro")).toBe("expirado");
    expect(corpoToken).toBeNull();
  });

  it("pessoa cancela no Google → 'cancelado'", async () => {
    const p = await iniciar();
    const res = await voltarDoGoogle({ ...p, error: "access_denied" });
    expect(destino(res).searchParams.get("erro")).toBe("cancelado");
  });

  it("token endpoint recusa → 'falha' com ref no log (sem o código)", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    respostaToken = { status: 400, json: { error: "invalid_grant", error_description: "Bad Request" } };
    const p = await iniciar();
    const res = await voltarDoGoogle(p);
    const d = destino(res);
    expect(d.searchParams.get("erro")).toBe("falha");
    const ref = d.searchParams.get("ref")!;
    const linha = erro.mock.calls.map((c) => String(c[0])).find((l) => l.includes(`ref=${ref}`))!;
    expect(linha).toContain("invalid_grant");
    expect(linha).not.toContain("codigo-de-teste");
    expect(linha).not.toContain("segredo-de-teste");
    erro.mockRestore();
  });

  it("id_token com audiência de outro cliente → 'falha'", async () => {
    await criarUsuario({ email: `ana@${DOMINIO}` });
    const p = await iniciar();
    claimsDaVez = { ...claimsDaVez, email: `ana@${DOMINIO}`, sub: "sub-ana", aud: "outro-cliente" };
    expect(destino(await voltarDoGoogle(p)).searchParams.get("erro")).toBe("falha");
    expect(await db.sessao.count()).toBe(0);
  });

  it("limitador: vários inícios no mesmo IP (NAT do campus) não recusam o callback do próprio fluxo", async () => {
    await criarUsuario({ email: `ana@${DOMINIO}` });
    for (let i = 0; i < 40; i++) await iniciar();
    const p = await iniciar();
    claimsDaVez = { ...claimsDaVez, email: `ana@${DOMINIO}`, sub: "sub-ana" };
    expect(cookieSessao(await voltarDoGoogle(p))).not.toBeNull();
  });

  it("limitador: callbacks forjados sem pedido válido não contam (não travam o IP)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await criarUsuario({ email: `ana@${DOMINIO}` });
    for (let i = 0; i < 60; i++) {
      await voltarDoGoogle({ state: "inventado", cookie: "ij_google_state=inventado" });
      await voltarDoGoogle({ state: null });
      await voltarDoGoogle({ state: "x", error: "access_denied" });
    }
    const p = await iniciar();
    claimsDaVez = { ...claimsDaVez, email: `ana@${DOMINIO}`, sub: "sub-ana" };
    expect(cookieSessao(await voltarDoGoogle(p))).not.toBeNull();
    vi.restoreAllMocks();
  });

  it("limitador: 30 recusas com pedido válido bloqueiam o callback, mas não o início", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 30; i++) {
      const p = await iniciar();
      claimsDaVez = { ...claimsDaVez, email: `ninguem@${DOMINIO}`, sub: "sub-x" };
      expect(destino(await voltarDoGoogle(p)).searchParams.get("erro")).toBe("nao_cadastrado");
    }
    const p = await iniciar(); // o início continua liberado
    expect(destino(await voltarDoGoogle(p)).searchParams.get("erro")).toBe("limite");
    vi.restoreAllMocks();
  });

  it("limitador: 120 inícios por IP em 15 min bloqueiam o início", async () => {
    for (let i = 0; i < 120; i++) await iniciar();
    const res = await iniciarGET(new Request(`${BASE}/api/auth/google`, { headers: { "x-forwarded-for": ip } }));
    expect(new URL(res.headers.get("location")!).searchParams.get("erro")).toBe("limite");
  });

  it("sem GOOGLE_CLIENT_ID/SECRET as duas rotas dão 404", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    expect((await iniciarGET(new Request(`${BASE}/api/auth/google`))).status).toBe(404);
    expect((await callbackGET(new Request(`${BASE}/api/auth/google/callback?state=a&code=b`))).status).toBe(404);
    process.env.GOOGLE_CLIENT_ID = CLIENT_ID_TESTE;
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect((await iniciarGET(new Request(`${BASE}/api/auth/google`))).status).toBe(404);
  });
});

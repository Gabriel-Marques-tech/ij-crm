// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CLIENT_ID_TESTE, assinarIdToken, claimsTeste, gerarChavesTeste } from "@/test/google";
import { GuardaPedidosGoogle, configGoogle, desafioPkce, dominioPermitido, lerDominios, urlAutorizacao, validarClaims, verificarIdToken } from "./google";

const NONCE = "nonce-de-teste-123";

describe("configGoogle", () => {
  it("sem client id ou segredo → null (botão some, rotas 404)", () => {
    expect(configGoogle({ GOOGLE_CLIENT_ID: "x" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(configGoogle({ GOOGLE_CLIENT_SECRET: "y" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(configGoogle({ GOOGLE_CLIENT_ID: " ", GOOGLE_CLIENT_SECRET: "y" } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });

  it("com as duas: redirect = APP_URL + /api/auth/google/callback", () => {
    const cfg = configGoogle({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s", APP_URL: "https://crm.ij.test/", NODE_ENV: "test" } as unknown as NodeJS.ProcessEnv);
    // urlBase lê process.env; aqui só conferimos o sufixo e os campos.
    expect(cfg?.clientId).toBe("id");
    expect(cfg?.redirectUri).toMatch(/\/api\/auth\/google\/callback$/);
  });

  it("lerDominios normaliza e ignora vazios", () => {
    expect(lerDominios(" IJ.org.br, @inteli.edu.br ,,")).toEqual(["ij.org.br", "inteli.edu.br"]);
    expect(lerDominios("")).toEqual([]);
    expect(lerDominios(undefined)).toEqual([]);
    expect(lerDominios("*")).toEqual([]);
  });
});

describe("urlAutorizacao", () => {
  const cfg = { clientId: "id", clientSecret: "s", dominios: [], redirectUri: "https://crm.ij.test/api/auth/google/callback" };

  it("code + PKCE S256 + state + nonce, sem o segredo", () => {
    const u = new URL(urlAutorizacao(cfg, { state: "st", nonce: "no", desafio: "de" }));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      client_id: "id",
      redirect_uri: cfg.redirectUri,
      response_type: "code",
      state: "st",
      nonce: "no",
      code_challenge: "de",
      code_challenge_method: "S256",
    });
    expect(u.searchParams.get("scope")).toContain("openid");
    expect(u.toString()).not.toContain("client_secret");
    expect(u.searchParams.has("hd")).toBe(false);
  });

  it("um domínio só vira dica `hd`", () => {
    const u = new URL(urlAutorizacao({ ...cfg, dominios: ["ij.org.br"] }, { state: "a", nonce: "b", desafio: "c" }));
    expect(u.searchParams.get("hd")).toBe("ij.org.br");
  });

  it("desafio PKCE é o sha256 do verificador em base64url sem padding (S256)", async () => {
    const v = "verificador-de-teste-com-43-caracteres-abcd";
    const esperado = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v))).toString("base64url");
    expect(desafioPkce(v)).toBe(esperado);
    expect(desafioPkce(v)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("GuardaPedidosGoogle (state/nonce)", () => {
  it("consome uma vez só", () => {
    const g = new GuardaPedidosGoogle();
    const { state } = g.criar("/projetos");
    const p = g.consumir(state, state);
    expect(p?.voltar).toBe("/projetos");
    expect(p?.nonce).toBeTruthy();
    expect(p?.verificador).toBeTruthy();
    expect(g.consumir(state, state)).toBeNull();
  });

  it("desafio devolvido corresponde ao verificador guardado", () => {
    const g = new GuardaPedidosGoogle();
    const { state, desafio } = g.criar(null);
    expect(desafioPkce(g.consumir(state, state)!.verificador)).toBe(desafio);
  });

  it("state da URL diferente do cookie → recusa; o pedido do cookie continua válido", () => {
    const g = new GuardaPedidosGoogle();
    const { state } = g.criar(null);
    const outro = g.criar(null).state;
    expect(g.consumir(outro, state)).toBeNull();
    expect(g.consumir(state, undefined)).toBeNull();
    expect(g.consumir(null, state)).toBeNull();
    expect(g.consumir(state, state)).not.toBeNull();
  });

  it("state inventado → null", () => {
    const g = new GuardaPedidosGoogle();
    expect(g.consumir("inventado", "inventado")).toBeNull();
  });

  it("expirado → null (e não volta a valer)", () => {
    const g = new GuardaPedidosGoogle({ validadeMs: 1000, maxPedidos: 10 });
    const { state } = g.criar(null, 0);
    expect(g.consumir(state, state, 1000)).toBeNull();
  });

  it("memória limitada: acima do máximo os mais antigos saem", () => {
    const g = new GuardaPedidosGoogle({ validadeMs: 60_000, maxPedidos: 3 });
    const primeiro = g.criar(null, 0).state;
    g.criar(null, 1);
    g.criar(null, 2);
    g.criar(null, 3);
    expect(g.tamanho).toBe(3);
    expect(g.consumir(primeiro, primeiro, 4)).toBeNull();
  });
});

describe("validarClaims", () => {
  const esperado = { clientId: CLIENT_ID_TESTE, nonce: NONCE };

  it("aceita token válido e normaliza o email", () => {
    const r = validarClaims(claimsTeste({ nonce: NONCE, email: "Ana@IJ.test", hd: "IJ.test" }), esperado);
    expect(r).toEqual({ ok: true, claims: { sub: "1000000000001", email: "ana@ij.test", hd: "ij.test" } });
  });

  it("aceita o emissor sem https e email_verified string", () => {
    expect(validarClaims(claimsTeste({ nonce: NONCE, iss: "accounts.google.com", email_verified: "true" }), esperado).ok).toBe(true);
  });

  it.each([
    ["emissor", { iss: "https://evil.example" }, "EMISSOR"],
    ["audiência de outro cliente", { aud: "outro" }, "AUDIENCIA"],
    ["aud em lista sem azp", { aud: [CLIENT_ID_TESTE, "x"], azp: "x" }, "AUDIENCIA"],
    ["expirado", { exp: Math.floor(Date.now() / 1000) - 120 }, "EXPIRADO"],
    ["emitido no futuro", { iat: Math.floor(Date.now() / 1000) + 3600 }, "EXPIRADO"],
    ["nonce errado", { nonce: "outro-nonce-de-teste" }, "NONCE"],
    ["sem nonce", { nonce: undefined }, "NONCE"],
    ["sem email", { email: undefined }, "SEM_EMAIL"],
    ["email não verificado", { email_verified: false }, "EMAIL_NAO_VERIFICADO"],
    ["email_verified ausente", { email_verified: undefined }, "EMAIL_NAO_VERIFICADO"],
    ["sem sub", { sub: "" }, "FORMATO"],
  ])("recusa %s", (_n, extra, erro) => {
    expect(validarClaims(claimsTeste({ nonce: NONCE, ...extra }), esperado)).toEqual({ ok: false, erro });
  });

  it("aud em lista com azp = cliente é aceito", () => {
    expect(validarClaims(claimsTeste({ nonce: NONCE, aud: [CLIENT_ID_TESTE, "x"], azp: CLIENT_ID_TESTE }), esperado).ok).toBe(true);
  });
});

describe("verificarIdToken (assinatura RS256)", async () => {
  const { privada, jwk } = await gerarChavesTeste();
  const outra = await gerarChavesTeste();
  const busca = async (kid: string) => (kid === jwk.kid ? jwk : null);
  const esperado = { clientId: CLIENT_ID_TESTE, nonce: NONCE };

  it("assinatura válida + claims válidas → ok", async () => {
    const jwt = await assinarIdToken(privada, claimsTeste({ nonce: NONCE }));
    expect(await verificarIdToken(jwt, esperado, busca)).toMatchObject({ ok: true, claims: { email: "ana@ij.test" } });
  });

  it("assinado por outra chave → ASSINATURA", async () => {
    const jwt = await assinarIdToken(outra.privada, claimsTeste({ nonce: NONCE }));
    expect(await verificarIdToken(jwt, esperado, busca)).toEqual({ ok: false, erro: "ASSINATURA" });
  });

  it("payload adulterado → ASSINATURA", async () => {
    const jwt = await assinarIdToken(privada, claimsTeste({ nonce: NONCE }));
    const [h, , s] = jwt.split(".");
    const forjado = Buffer.from(JSON.stringify(claimsTeste({ nonce: NONCE, email: "chefe@ij.test" }))).toString("base64url");
    expect(await verificarIdToken(`${h}.${forjado}.${s}`, esperado, busca)).toEqual({ ok: false, erro: "ASSINATURA" });
  });

  it("alg none / HS256 → ALGORITMO", async () => {
    const jwt = await assinarIdToken(privada, claimsTeste({ nonce: NONCE }), { alg: "none", kid: jwk.kid });
    expect(await verificarIdToken(jwt, esperado, busca)).toEqual({ ok: false, erro: "ALGORITMO" });
  });

  it("kid desconhecido → CHAVE_DESCONHECIDA", async () => {
    const jwt = await assinarIdToken(privada, claimsTeste({ nonce: NONCE }), { alg: "RS256", kid: "outro" });
    expect(await verificarIdToken(jwt, esperado, busca)).toEqual({ ok: false, erro: "CHAVE_DESCONHECIDA" });
  });

  it("lixo → FORMATO", async () => {
    expect(await verificarIdToken("a.b", esperado, busca)).toEqual({ ok: false, erro: "FORMATO" });
    expect(await verificarIdToken("x.y.z", esperado, busca)).toEqual({ ok: false, erro: "FORMATO" });
  });

  it("assinatura confere mas claims não (nonce) → NONCE", async () => {
    const jwt = await assinarIdToken(privada, claimsTeste({ nonce: "nonce-de-outra-aba" }));
    expect(await verificarIdToken(jwt, esperado, busca)).toEqual({ ok: false, erro: "NONCE" });
  });
});

describe("dominioPermitido", () => {
  it("lista vazia → qualquer domínio", () => {
    expect(dominioPermitido({ email: "a@gmail.com", hd: null }, [])).toBe(true);
  });

  it("domínio do email precisa estar na lista", () => {
    expect(dominioPermitido({ email: "a@ij.org.br", hd: null }, ["ij.org.br"])).toBe(true);
    expect(dominioPermitido({ email: "a@gmail.com", hd: null }, ["ij.org.br"])).toBe(false);
  });

  it("hd, quando vem, também precisa estar", () => {
    expect(dominioPermitido({ email: "a@ij.org.br", hd: "ij.org.br" }, ["ij.org.br"])).toBe(true);
    expect(dominioPermitido({ email: "a@ij.org.br", hd: "outra.com" }, ["ij.org.br"])).toBe(false);
  });

  it("não aceita subdomínio nem sufixo parecido", () => {
    expect(dominioPermitido({ email: "a@evil-ij.org.br", hd: null }, ["ij.org.br"])).toBe(false);
    expect(dominioPermitido({ email: "a@x.ij.org.br", hd: null }, ["ij.org.br"])).toBe(false);
  });
});

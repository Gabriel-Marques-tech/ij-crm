// @vitest-environment node
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

function req(caminho: string) {
  return new NextRequest(new URL(caminho, "http://localhost:3000"));
}

describe("proxy", () => {
  it("deixa /api/health passar sem sessão (healthcheck do compose/deploy)", () => {
    const res = proxy(req("/api/health"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("redireciona rota privada sem sessão para /login", () => {
    const res = proxy(req("/kanban"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it("esqueci a senha e /redefinir/[token] são públicos (GAB-43); a foto não", () => {
    expect(proxy(req("/esqueci")).headers.get("location")).toBeNull();
    expect(proxy(req(`/redefinir/${"a".repeat(64)}`)).headers.get("location")).toBeNull();
    expect(proxy(req("/api/usuarios/x/foto")).status).toBe(401);
  });

  it("não libera prefixo parecido (/api/healthz)", () => {
    const res = proxy(req("/api/healthz"));
    expect(res.status).toBe(401);
  });

  it("API privada sem sessão → 401 JSON (fetch não segue redirect para a tela de login)", async () => {
    const res = proxy(req("/api/gestao/importar/previa"));
    expect(res.status).toBe(401);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.json()).toEqual({ erro: "Sessão expirada. Entre de novo." });
  });

  it("webhook e cron continuam públicos; com cookie, a API passa", () => {
    expect(proxy(req("/api/webhooks/evolution")).status).toBe(200);
    expect(proxy(req("/api/cron/reprocessar")).status).toBe(200);
    const comCookie = new NextRequest(new URL("/api/gestao/importar/previa", "http://localhost:3000"), { headers: { cookie: "ij_sessao=abc" } });
    expect(proxy(comCookie).status).toBe(200);
  });
});

describe("proxy: matcher", () => {
  it("não intercepta ícones nem a marca (login sem sessão precisa deles)", async () => {
    const { unstable_doesMiddlewareMatch } = await import("next/experimental/testing/server");
    const { config } = await import("./proxy");
    const casa = (url: string) => unstable_doesMiddlewareMatch({ config, url });
    expect(casa("/icon.png")).toBe(false);
    expect(casa("/apple-icon.png")).toBe(false);
    expect(casa("/images/marca/mascote-em-pe.webp")).toBe(false);
    expect(casa("/kanban")).toBe(true);
    // Ponto é literal: nomes parecidos continuam privados.
    expect(casa("/icon-png")).toBe(true);
    expect(casa("/apple-icon-png")).toBe(true);
    expect(casa("/iconXpng")).toBe(true);
  });
});

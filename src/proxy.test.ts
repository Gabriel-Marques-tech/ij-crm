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

  it("não libera prefixo parecido (/api/healthz)", () => {
    const res = proxy(req("/api/healthz"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/login");
  });
});

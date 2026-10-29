// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Papel } from "@prisma/client";

const { sessao, redirect } = vi.hoisted(() => ({
  sessao: { papel: null as Papel | null },
  // Como o real: `redirect` lança (NEXT_REDIRECT) e nunca volta.
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${url};307;` });
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "s".repeat(64) }) }) }));
vi.mock("./sessao", () => ({
  hashSessao: (v: string) => v,
  obterUsuarioDaSessao: async () => (sessao.papel ? { id: "u1", nome: "U", email: "u@ij.test", papel: sessao.papel, ativo: true, fotoEm: null } : null),
}));

const { exigirEscrita, exigirUsuario } = await import("./atual");

beforeEach(() => {
  redirect.mockClear();
});

describe("exigirEscrita (papel VISUALIZADOR é somente leitura)", () => {
  it("visualizador → /403; o mesmo usuário passa no exigirUsuario (leitura e /perfil)", async () => {
    sessao.papel = "VISUALIZADOR";
    await expect(exigirEscrita()).rejects.toMatchObject({ digest: expect.stringContaining(";/403;") });
    expect(redirect).toHaveBeenCalledWith("/403");
    await expect(exigirUsuario()).resolves.toMatchObject({ id: "u1", papel: "VISUALIZADOR" });
  });

  it("vendedor, gestor e admin escrevem", async () => {
    for (const papel of ["VENDEDOR", "GESTOR", "ADMIN"] as const) {
      sessao.papel = papel;
      await expect(exigirEscrita()).resolves.toMatchObject({ papel });
    }
    expect(redirect).not.toHaveBeenCalled();
  });

  it("sem sessão → /login", async () => {
    sessao.papel = null;
    await expect(exigirEscrita()).rejects.toMatchObject({ digest: expect.stringContaining(";/login;") });
  });
});

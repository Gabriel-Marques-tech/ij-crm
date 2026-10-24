import { describe, expect, it } from "vitest";
import { conviteEstaValido, gerarConvite, hashToken } from "./convite";

describe("gerarConvite", () => {
  it("token em claro não é igual ao hash e o hash é determinístico", () => {
    const c = gerarConvite(new Date("2026-10-24T12:00:00Z"));
    expect(c.token).toHaveLength(64);
    expect(c.hash).not.toBe(c.token);
    expect(hashToken(c.token)).toBe(c.hash);
  });

  it("expira em 7 dias", () => {
    const c = gerarConvite(new Date("2026-10-24T12:00:00Z"));
    expect(c.expiraEm.toISOString()).toBe("2026-10-31T12:00:00.000Z");
  });

  it("dois convites nunca repetem token", () => {
    expect(gerarConvite().token).not.toBe(gerarConvite().token);
  });
});

describe("conviteEstaValido", () => {
  const expiraEm = new Date("2026-10-31T12:00:00Z");

  it("válido antes de expirar", () => {
    expect(conviteEstaValido({ conviteExpiraEm: expiraEm }, new Date("2026-10-30T00:00:00Z"))).toBe(true);
  });

  it("inválido depois de expirar", () => {
    expect(conviteEstaValido({ conviteExpiraEm: expiraEm }, new Date("2026-10-31T12:00:01Z"))).toBe(false);
  });

  it("inválido sem expiração (já usado)", () => {
    expect(conviteEstaValido({ conviteExpiraEm: null }, new Date())).toBe(false);
  });
});

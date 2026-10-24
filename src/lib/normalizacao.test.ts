import { describe, expect, it } from "vitest";
import { normalizarEmail, normalizarTelefoneBr } from "./normalizacao";

describe("normalizarEmail", () => {
  it("lowercase + trim", () => {
    expect(normalizarEmail("  Joao.Silva@IntelIJunior.com ")).toBe("joao.silva@intelijunior.com");
  });

  it("rejeita sem @ ou vazio", () => {
    expect(normalizarEmail("joao")).toBeNull();
    expect(normalizarEmail("   ")).toBeNull();
  });
});

describe("normalizarTelefoneBr", () => {
  it.each([
    ["11 99999-8888", "+5511999998888"],
    ["(11) 99999-8888", "+5511999998888"],
    ["5511999998888", "+5511999998888"],
    ["+55 11 99999-8888", "+5511999998888"],
    ["011999998888", "+5511999998888"],
  ])("%s → %s", (entrada, esperado) => {
    expect(normalizarTelefoneBr(entrada)).toBe(esperado);
  });

  it("aceita fixo com 8 dígitos", () => {
    expect(normalizarTelefoneBr("11 3333-4444")).toBe("+551133334444");
  });

  it("rejeita número curto ou DDD inválido", () => {
    expect(normalizarTelefoneBr("99999-8888")).toBeNull();
    expect(normalizarTelefoneBr("00 99999-8888")).toBeNull();
    expect(normalizarTelefoneBr("")).toBeNull();
  });

  it("é idempotente", () => {
    const n = normalizarTelefoneBr("11999998888")!;
    expect(normalizarTelefoneBr(n)).toBe(n);
  });
});

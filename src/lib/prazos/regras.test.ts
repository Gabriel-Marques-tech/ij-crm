import { describe, expect, it } from "vitest";
import { estadoPrazo, podeMexerNoPrazo, validarPrazo } from "./regras";

describe("podeMexerNoPrazo", () => {
  it("vendedor só nos próprios; gestor e admin em qualquer um", () => {
    expect(podeMexerNoPrazo({ id: "v", papel: "VENDEDOR" }, "v")).toBe(true);
    expect(podeMexerNoPrazo({ id: "v", papel: "VENDEDOR" }, "outro")).toBe(false);
    expect(podeMexerNoPrazo({ id: "g", papel: "GESTOR" }, "outro")).toBe(true);
    expect(podeMexerNoPrazo({ id: "a", papel: "ADMIN" }, "outro")).toBe(true);
  });
});

describe("validarPrazo", () => {
  it("título aparado (1–200) e dia válido", () => {
    expect(validarPrazo("  Entregar proposta ", "2026-10-30")).toEqual({ ok: true, titulo: "Entregar proposta", dia: "2026-10-30" });
    expect(validarPrazo("   ", "2026-10-30")).toMatchObject({ ok: false });
    expect(validarPrazo("x".repeat(201), "2026-10-30")).toMatchObject({ ok: false });
    expect(validarPrazo("ok", "")).toMatchObject({ ok: false });
    expect(validarPrazo("ok", "2026-02-30")).toMatchObject({ ok: false });
  });
});

describe("estadoPrazo", () => {
  it("feito > vencido (antes de hoje e não feito) > pendente", () => {
    expect(estadoPrazo({ dia: "2026-10-20", feito: true }, "2026-10-27")).toBe("feito");
    expect(estadoPrazo({ dia: "2026-10-26", feito: false }, "2026-10-27")).toBe("vencido");
    expect(estadoPrazo({ dia: "2026-10-27", feito: false }, "2026-10-27")).toBe("pendente");
    expect(estadoPrazo({ dia: "2026-10-28", feito: false }, "2026-10-27")).toBe("pendente");
  });
});

import { describe, expect, it } from "vitest";
import { interpretarCampoContato, interpretarCampoEmpresa, validarNome } from "./campos";

describe("validarNome", () => {
  it("apara e colapsa espaços; rejeita vazio e > 200", () => {
    expect(validarNome("  Acme   Ltda ")).toBe("Acme Ltda");
    expect(validarNome("   ")).toBeNull();
    expect(validarNome("x".repeat(201))).toBeNull();
  });
});

describe("interpretarCampoEmpresa", () => {
  it("CNPJ normalizado; vazio limpa; inválido explica", () => {
    expect(interpretarCampoEmpresa("cnpj", "12.abc.345/01de-35")).toEqual({ ok: true, valor: "12ABC34501DE35" });
    expect(interpretarCampoEmpresa("cnpj", " ")).toEqual({ ok: true, valor: null });
    const r = interpretarCampoEmpresa("cnpj", "11.222.333/0001-82");
    expect(r.ok).toBe(false);
  });

  it("domínio aceita email/URL e recusa provedor pessoal", () => {
    expect(interpretarCampoEmpresa("dominioEmail", "ana@Acme.com.br")).toEqual({ ok: true, valor: "acme.com.br" });
    expect(interpretarCampoEmpresa("dominioEmail", "https://www.acme.com/x")).toEqual({ ok: true, valor: "acme.com" });
    const r = interpretarCampoEmpresa("dominioEmail", "ana@gmail.com");
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.erro).toContain("gmail.com");
  });

  it("site ganha https:// quando falta; estado só UF", () => {
    expect(interpretarCampoEmpresa("site", "acme.com.br")).toEqual({ ok: true, valor: "https://acme.com.br" });
    expect(interpretarCampoEmpresa("site", "javascript:alert(1)").ok).toBe(false);
    expect(interpretarCampoEmpresa("estado", "sp")).toEqual({ ok: true, valor: "SP" });
    expect(interpretarCampoEmpresa("estado", "XX").ok).toBe(false);
  });

  it("nome obrigatório", () => {
    expect(interpretarCampoEmpresa("nome", "").ok).toBe(false);
  });
});

describe("interpretarCampoContato", () => {
  it("cargo opcional com limite", () => {
    expect(interpretarCampoContato("cargo", " CEO ")).toEqual({ ok: true, valor: "CEO" });
    expect(interpretarCampoContato("cargo", "")).toEqual({ ok: true, valor: null });
    expect(interpretarCampoContato("cargo", "x".repeat(101)).ok).toBe(false);
  });
});

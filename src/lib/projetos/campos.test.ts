import { describe, expect, it } from "vitest";
import { DESCRICAO_MAX, descricaoSchema, inicioDoDia, interpretarCampo, validarTitulo } from "./campos";

describe("validarTitulo", () => {
  it("apara e colapsa espaços; vazio ou longo demais → null", () => {
    expect(validarTitulo("  Acme   Ltda ")).toBe("Acme Ltda");
    expect(validarTitulo("   ")).toBeNull();
    expect(validarTitulo("x".repeat(201))).toBeNull();
    expect(validarTitulo("x".repeat(200))).toHaveLength(200);
  });
});

describe("inicioDoDia", () => {
  it("YYYY-MM-DD → meia-noite de São Paulo", () => {
    expect(inicioDoDia("2026-10-24")?.toISOString()).toBe("2026-10-24T03:00:00.000Z");
    expect(inicioDoDia("2026-02-30")).toBeNull();
    expect(inicioDoDia("24/10/2026")).toBeNull();
  });
});

describe("interpretarCampo", () => {
  it("texto opcional: vazio vira null", () => {
    expect(interpretarCampo("dor", "  ")).toEqual({ ok: true, valor: null });
    expect(interpretarCampo("dor", " precisa de site ")).toEqual({ ok: true, valor: "precisa de site" });
    expect(interpretarCampo("cidade", "x".repeat(101)).ok).toBe(false);
  });

  it("título é obrigatório", () => {
    expect(interpretarCampo("titulo", "").ok).toBe(false);
    expect(interpretarCampo("titulo", " Acme ")).toEqual({ ok: true, valor: "Acme" });
  });

  it("origem: enum ou vazio", () => {
    expect(interpretarCampo("origem", "RD")).toEqual({ ok: true, valor: "RD" });
    expect(interpretarCampo("origem", "")).toEqual({ ok: true, valor: null });
    expect(interpretarCampo("origem", "TIKTOK").ok).toBe(false);
  });

  it("enums e UF não aceitam chaves do protótipo de Object", () => {
    for (const k of ["toString", "constructor", "__proto__", "hasOwnProperty", "valueOf"]) {
      expect(interpretarCampo("origem", k).ok).toBe(false);
      expect(interpretarCampo("estado", k).ok).toBe(false);
      expect(interpretarCampo("revisar", k).ok).toBe(false);
    }
  });

  it("orçamento aceita formato BR e ponto decimal; guarda string com 2 casas", () => {
    expect(interpretarCampo("orcamentoPrevisto", "R$ 12.500,50")).toEqual({ ok: true, valor: "12500.50" });
    expect(interpretarCampo("orcamentoPrevisto", "12500,5")).toEqual({ ok: true, valor: "12500.50" });
    expect(interpretarCampo("orcamentoPrevisto", "12.500")).toEqual({ ok: true, valor: "12500.00" });
    // Formato BR: ponto é milhar, nunca decimal.
    expect(interpretarCampo("orcamentoPrevisto", "12500.5").ok).toBe(false);
    expect(interpretarCampo("orcamentoPrevisto", "8000")).toEqual({ ok: true, valor: "8000.00" });
    expect(interpretarCampo("orcamentoPrevisto", "")).toEqual({ ok: true, valor: null });
    expect(interpretarCampo("orcamentoPrevisto", "-5").ok).toBe(false);
    expect(interpretarCampo("orcamentoPrevisto", "abc").ok).toBe(false);
  });

  it("proposta URL só http(s)", () => {
    expect(interpretarCampo("propostaUrl", "https://docs.google.com/x")).toEqual({ ok: true, valor: "https://docs.google.com/x" });
    expect(interpretarCampo("propostaUrl", "javascript:alert(1)").ok).toBe(false);
    expect(interpretarCampo("propostaUrl", "docs.google.com").ok).toBe(false);
  });

  it("estado: UF válida em maiúsculas", () => {
    expect(interpretarCampo("estado", "sp")).toEqual({ ok: true, valor: "SP" });
    expect(interpretarCampo("estado", "XX").ok).toBe(false);
  });

  it("revisar: booleano", () => {
    expect(interpretarCampo("revisar", "true")).toEqual({ ok: true, valor: true });
    expect(interpretarCampo("revisar", "false")).toEqual({ ok: true, valor: false });
    expect(interpretarCampo("revisar", "talvez").ok).toBe(false);
  });

  it("data da próxima ação: dia civil ou vazio", () => {
    const r = interpretarCampo("proximaAcaoEm", "2026-11-03");
    expect(r.ok && (r.valor as Date).toISOString()).toBe("2026-11-03T03:00:00.000Z");
    expect(interpretarCampo("proximaAcaoEm", "")).toEqual({ ok: true, valor: null });
    expect(interpretarCampo("proximaAcaoEm", "amanhã").ok).toBe(false);
  });

  it("responsável: id não vazio", () => {
    expect(interpretarCampo("responsavelId", "abc")).toEqual({ ok: true, valor: "abc" });
    expect(interpretarCampo("responsavelId", "").ok).toBe(false);
  });
});

describe("descrição do card", () => {
  it("zod: até 5000 caracteres; acima disso, erro em português", () => {
    expect(DESCRICAO_MAX).toBe(5000);
    expect(descricaoSchema.safeParse("x".repeat(5000)).success).toBe(true);
    const r = descricaoSchema.safeParse("x".repeat(5001));
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toBe("Descrição: no máximo 5000 caracteres.");
  });

  it("vazio/só espaços vira null; quebras de linha internas ficam", () => {
    expect(descricaoSchema.parse("   \n ")).toBeNull();
    expect(descricaoSchema.parse(null)).toBeNull();
    expect(descricaoSchema.parse(undefined)).toBeNull();
    expect(descricaoSchema.parse("  linha 1\n\nlinha 2  ")).toBe("linha 1\n\nlinha 2");
  });

  it("é campo editável inline e usa o mesmo limite", () => {
    expect(interpretarCampo("descricao", "a\nb")).toEqual({ ok: true, valor: "a\nb" });
    expect(interpretarCampo("descricao", "")).toEqual({ ok: true, valor: null });
    expect(interpretarCampo("descricao", "x".repeat(5001))).toEqual({ ok: false, erro: "Descrição: no máximo 5000 caracteres." });
  });

  it("não interpreta HTML: o texto é guardado como veio (a tela exibe como texto puro)", () => {
    expect(interpretarCampo("descricao", "<b>oi</b> **x**")).toEqual({ ok: true, valor: "<b>oi</b> **x**" });
  });
});

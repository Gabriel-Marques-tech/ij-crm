import { describe, expect, it } from "vitest";
import { ROTULO_CAMPO_TERMINAL, ehCampoTerminal, formatarCampoTerminal, formatarDataHora, formatarValorCampo } from "./formatar";

describe("formatarValorCampo", () => {
  const nomes = new Map([["u1", "Ana Vendas"]]);

  it("vazio vira travessão", () => {
    expect(formatarValorCampo("dor", null, nomes)).toBe("—");
    expect(formatarValorCampo("dor", "", nomes)).toBe("—");
  });

  it("formata por campo", () => {
    expect(formatarValorCampo("orcamentoPrevisto", "12500.50", nomes)).toBe("R$ 12.500,50");
    expect(formatarValorCampo("revisar", true, nomes)).toBe("sim");
    expect(formatarValorCampo("revisar", false, nomes)).toBe("não");
    expect(formatarValorCampo("origem", "COLD_CALL", nomes)).toBe("Cold call");
    expect(formatarValorCampo("proximaAcaoEm", "2026-11-03", nomes)).toBe("03/11/2026");
    expect(formatarValorCampo("responsavelId", "u1", nomes)).toBe("Ana Vendas");
    expect(formatarValorCampo("responsavelId", "sumiu", nomes)).toBe("usuário removido");
    expect(formatarValorCampo("cidade", "Recife", nomes)).toBe("Recife");
  });

  it("descrição na Timeline: uma linha só, cortada em 120 caracteres", () => {
    expect(formatarValorCampo("descricao", "linha 1\n\nlinha 2", nomes)).toBe("linha 1 linha 2");
    expect(formatarValorCampo("descricao", "x".repeat(200), nomes)).toBe(`${"x".repeat(120)}…`);
  });
});

describe("formatarDataHora", () => {
  it("dd/mm/aaaa hh:mm no fuso de SP", () => {
    expect(formatarDataHora(new Date("2026-10-24T15:05:00Z"))).toBe("24/10/2026 12:05");
  });
});

describe("campos de ganho/perdido (GAB-32)", () => {
  it("rótulos e valores como na Timeline", () => {
    expect(ehCampoTerminal("valorFechado")).toBe(true);
    expect(ehCampoTerminal("dor")).toBe(false);
    expect(ehCampoTerminal("toString")).toBe(false);
    expect(ROTULO_CAMPO_TERMINAL.dataGanho).toBe("Data do ganho");
    expect(formatarCampoTerminal("valorFechado", "45000.50")).toBe("R$ 45.000,50");
    expect(formatarCampoTerminal("dataGanho", "2026-10-24T15:05:00.000Z")).toBe("24/10/2026 12:05");
    expect(formatarCampoTerminal("dataGanho", "lixo")).toBe("lixo");
    expect(formatarCampoTerminal("motivoPerda", "Preço")).toBe("Preço");
    expect(formatarCampoTerminal("motivoPerda", null)).toBe("—");
  });
});

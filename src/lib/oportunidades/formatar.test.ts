import { describe, expect, it } from "vitest";
import { formatarDataHora, formatarValorCampo } from "./formatar";

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
});

describe("formatarDataHora", () => {
  it("dd/mm/aaaa hh:mm no fuso de SP", () => {
    expect(formatarDataHora(new Date("2026-10-24T15:05:00Z"))).toBe("24/10/2026 12:05");
  });
});

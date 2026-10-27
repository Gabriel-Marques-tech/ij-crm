import { describe, expect, it } from "vitest";
import { fmtDestaque, fmtDias, fmtDinheiro, fmtPercentual, TRACO } from "./formatar";

describe("formatar ranking", () => {
  it("sem dado vira traço", () => {
    expect(fmtDinheiro(null)).toBe(TRACO);
    expect(fmtPercentual(null)).toBe(TRACO);
    expect(fmtDias(null)).toBe(TRACO);
    expect(fmtDestaque("inteiro", null)).toBe(TRACO);
  });

  it("formatos pt-BR", () => {
    expect(fmtDinheiro(12500)).toBe("R$ 12.500,00");
    expect(fmtPercentual(0.756)).toBe("76%");
    expect(fmtDias(0.4)).toBe("< 1 dia");
    expect(fmtDias(1.5)).toBe("1,5 dia");
    expect(fmtDias(12.25)).toBe("12,3 dias");
    expect(fmtDestaque("inteiro", 1234)).toBe("1.234");
  });
});

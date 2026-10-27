import { describe, expect, it } from "vitest";
import { lerValorInformal } from "./valores";

describe("lerValorInformal", () => {
  it.each([
    ["15k", "15000.00"],
    ["15 k", "15000.00"],
    ["uns 15k", "15000.00"],
    ["uns 15 mil", "15000.00"],
    ["15 mil reais", "15000.00"],
    ["R$ 15 mil", "15000.00"],
    ["2,5k", "2500.00"],
    ["2.5k", "2500.00"],
    ["1,5 milhão", "1500000.00"],
    ["1.2 mi", "1200000.00"],
    ["2 milhões", "2000000.00"],
    ["R$ 15.000", "15000.00"],
    ["R$ 15.000,50", "15000.50"],
    ["15000", "15000.00"],
    ["15.000,00", "15000.00"],
    ["em torno de 8 mil", "8000.00"],
    ["entre 10 e 15 mil", "10000.00"],
    ["15 mil e pouco", "15000.00"],
    ["8000.75", null],
    ["", null],
    ["não sei", null],
    ["muito caro", null],
    ["-5k", null],
    // Multiplicador só colado ao número (ou fechando um intervalo).
    ["15 pessoas, orçamento 20 mil", "20000.00"],
    ["10 a 15k", "10000.00"],
    ["de 10 até 15 mil", "10000.00"],
    ["entre 10k e 15k", "10000.00"],
    ["3 sócios, uns 50 mil", "50000.00"],
    ["15 pessoas, mil coisas", null],
    ["para 15 pessoas, orçamento 20000", null],
  ])("%j → %s", (expr, esperado) => {
    expect(lerValorInformal(expr)).toBe(esperado);
  });

  it("aceita número (a LLM pode mandar 15000)", () => {
    expect(lerValorInformal(15000)).toBe("15000.00");
    expect(lerValorInformal(-1)).toBeNull();
    expect(lerValorInformal(Number.NaN)).toBeNull();
  });

  it("acima da coluna Decimal(14,2) → null", () => {
    expect(lerValorInformal("9999999999999")).toBeNull();
    expect(lerValorInformal("5000000 milhões")).toBeNull();
  });
});

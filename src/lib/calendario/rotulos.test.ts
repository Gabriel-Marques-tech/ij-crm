import { describe, expect, it } from "vitest";
import { diaBR, rotuloDia } from "./rotulos";

describe("rótulos de dia", () => {
  it("dia da semana pt-BR e número, sem depender do fuso", () => {
    expect(rotuloDia("2026-10-26")).toEqual({ semana: "SEG", numero: 26, ddmm: "26/10" });
    expect(rotuloDia("2026-11-01")).toEqual({ semana: "DOM", numero: 1, ddmm: "01/11" });
    expect(diaBR("2026-10-30")).toBe("30/10/2026");
  });
});

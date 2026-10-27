import { describe, expect, it } from "vitest";
import { lerData, lerLista, lerOrigem, lerValor, normalizarTexto } from "./valores";

const iso = (r: ReturnType<typeof lerData>) => (r.ok ? (r.valor?.toISOString() ?? null) : "INVALIDA");

describe("lerData", () => {
  it("dd/mm/aaaa HH:mm é horário de São Paulo", () => {
    expect(iso(lerData("05/03/2026 14:30"))).toBe("2026-03-05T17:30:00.000Z");
    expect(iso(lerData("5/3/2026 09:05:07"))).toBe("2026-03-05T12:05:07.000Z");
  });
  it("só a data → meia-noite em SP", () => {
    expect(iso(lerData("31/12/2025"))).toBe("2025-12-31T03:00:00.000Z");
  });
  it("ISO com Z, com offset e sem fuso", () => {
    expect(iso(lerData("2026-01-10T12:00:00Z"))).toBe("2026-01-10T12:00:00.000Z");
    expect(iso(lerData("2026-01-10T12:00:00.5-02:00"))).toBe("2026-01-10T14:00:00.500Z");
    expect(iso(lerData("2026-01-10 12:00"))).toBe("2026-01-10T15:00:00.000Z");
    expect(iso(lerData("2026-01-10"))).toBe("2026-01-10T03:00:00.000Z");
  });
  it("vazio → null; impossível ou desconhecido → inválida", () => {
    expect(lerData("  ")).toEqual({ ok: true, valor: null });
    expect(iso(lerData("31/02/2026"))).toBe("INVALIDA");
    expect(iso(lerData("2026-13-01"))).toBe("INVALIDA");
    expect(iso(lerData("ontem"))).toBe("INVALIDA");
    expect(iso(lerData("05/03/2026 25:00"))).toBe("INVALIDA");
  });
});

describe("lerValor", () => {
  it("BR, com R$, e ponto decimal simples", () => {
    expect(lerValor("R$ 12.500,00")).toEqual({ ok: true, valor: "12500.00" });
    expect(lerValor("1.234")).toEqual({ ok: true, valor: "1234.00" });
    expect(lerValor("12500.5")).toEqual({ ok: true, valor: "12500.50" });
    expect(lerValor("")).toEqual({ ok: true, valor: null });
    expect(lerValor("doze mil")).toEqual({ ok: false });
    expect(lerValor("1,234.56")).toEqual({ ok: false });
  });
});

describe("outros", () => {
  it("normalizarTexto", () => {
    expect(normalizarTexto("  Reunião   de Proposta! ")).toBe("reuniao de proposta");
  });
  it("lerOrigem", () => {
    expect(lerOrigem("Indicação")).toBe("INDICACAO");
    expect(lerOrigem("RD Station")).toBe("RD");
    expect(lerOrigem("Cold Call")).toBe("COLD_CALL");
    expect(lerOrigem("Panfleto")).toBeNull();
  });
  it("lerLista", () => {
    expect(lerLista("Ana Souza, Bruno; Carla\nDiego | ")).toEqual(["Ana Souza", "Bruno", "Carla", "Diego"]);
  });
});

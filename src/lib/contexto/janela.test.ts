import { describe, expect, it } from "vitest";
import { janelaAnterior, janelaDe } from "./janela";

// São Paulo = UTC-3 (sem horário de verão desde 2019).
describe("janelas de 12 h (America/Sao_Paulo)", () => {
  it("manhã: 00:00–12:00 de SP", () => {
    const j = janelaDe(new Date("2026-10-27T13:30:00Z")); // 10:30 SP
    expect(j.inicio.toISOString()).toBe("2026-10-27T03:00:00.000Z");
    expect(j.fim.toISOString()).toBe("2026-10-27T15:00:00.000Z");
  });

  it("tarde: 12:00–24:00 de SP", () => {
    const j = janelaDe(new Date("2026-10-27T15:00:00Z")); // 12:00 SP em ponto
    expect(j.inicio.toISOString()).toBe("2026-10-27T15:00:00.000Z");
    expect(j.fim.toISOString()).toBe("2026-10-28T03:00:00.000Z");
  });

  it("23:59 de SP ainda é a tarde do mesmo dia (UTC já virou)", () => {
    const j = janelaDe(new Date("2026-10-28T02:59:59Z"));
    expect(j.inicio.toISOString()).toBe("2026-10-27T15:00:00.000Z");
  });

  it("anterior da manhã é a tarde do dia anterior; anterior da tarde é a manhã", () => {
    expect(janelaAnterior(new Date("2026-10-27T03:00:00Z")).inicio.toISOString()).toBe("2026-10-26T15:00:00.000Z");
    expect(janelaAnterior(new Date("2026-10-27T20:00:00Z")).inicio.toISOString()).toBe("2026-10-27T03:00:00.000Z");
    expect(janelaAnterior(new Date("2026-10-27T20:00:00Z")).fim.toISOString()).toBe("2026-10-27T15:00:00.000Z");
  });

  it("virada de mês e de ano", () => {
    expect(janelaAnterior(new Date("2027-01-01T05:00:00Z")).inicio.toISOString()).toBe("2026-12-31T15:00:00.000Z");
  });
});

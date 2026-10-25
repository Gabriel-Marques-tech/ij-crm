import { describe, expect, it } from "vitest";
import { diaEmFuso, diasNaFase, estadoProximaAcao, nivelAging } from "./aging";

const DIA = 24 * 60 * 60 * 1000;

describe("diasNaFase", () => {
  const agora = new Date("2026-10-24T15:00:00Z");

  it("conta dias inteiros completos desde fase_desde", () => {
    expect(diasNaFase(agora, agora)).toBe(0);
    expect(diasNaFase(new Date(agora.getTime() - DIA + 1), agora)).toBe(0);
    expect(diasNaFase(new Date(agora.getTime() - DIA), agora)).toBe(1);
    expect(diasNaFase(new Date(agora.getTime() - 10.5 * DIA), agora)).toBe(10);
  });

  it("relógio adiantado no servidor (fase_desde no futuro) nunca dá negativo", () => {
    expect(diasNaFase(new Date(agora.getTime() + DIA), agora)).toBe(0);
  });
});

describe("nivelAging", () => {
  it("sem limite na fase → neutro, qualquer que seja a idade", () => {
    expect(nivelAging(0, null)).toBe("neutro");
    expect(nivelAging(999, null)).toBe("neutro");
  });

  it("verde abaixo de 70% do limite", () => {
    expect(nivelAging(0, 10)).toBe("verde");
    expect(nivelAging(6, 10)).toBe("verde");
  });

  it("âmbar de 70% até antes do limite", () => {
    expect(nivelAging(7, 10)).toBe("ambar");
    expect(nivelAging(9, 10)).toBe("ambar");
  });

  it("vermelho a partir do limite (mesma leitura de 'alerta ≥ Nd' da Gestão)", () => {
    expect(nivelAging(10, 10)).toBe("vermelho");
    expect(nivelAging(40, 10)).toBe("vermelho");
  });

  it("limites curtos: 1 dia → verde no dia 0, vermelho no dia 1", () => {
    expect(nivelAging(0, 1)).toBe("verde");
    expect(nivelAging(1, 1)).toBe("vermelho");
    // 70% de 3 = 2,1 → dia 2 ainda verde, dia 3 vermelho
    expect(nivelAging(2, 3)).toBe("verde");
    expect(nivelAging(3, 3)).toBe("vermelho");
  });
});

describe("diaEmFuso", () => {
  it("usa o dia civil de São Paulo, não o UTC", () => {
    expect(diaEmFuso(new Date("2026-10-25T02:30:00Z"))).toBe("2026-10-24");
    expect(diaEmFuso(new Date("2026-10-25T03:00:00Z"))).toBe("2026-10-25");
  });
});

describe("estadoProximaAcao", () => {
  const agora = new Date("2026-10-24T15:00:00Z"); // 12:00 em SP

  it("sem data → null", () => {
    expect(estadoProximaAcao(null, agora)).toBeNull();
  });

  it("vencida / hoje / futura pelo dia civil de SP", () => {
    expect(estadoProximaAcao(new Date("2026-10-23T03:00:00Z"), agora)).toBe("vencida");
    expect(estadoProximaAcao(new Date("2026-10-24T03:00:00Z"), agora)).toBe("hoje");
    // 23:59 de SP ainda é hoje, mesmo já sendo 25 em UTC
    expect(estadoProximaAcao(new Date("2026-10-25T02:59:00Z"), agora)).toBe("hoje");
    expect(estadoProximaAcao(new Date("2026-10-25T03:00:00Z"), agora)).toBe("futura");
  });
});

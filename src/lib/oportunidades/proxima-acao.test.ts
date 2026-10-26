import { describe, expect, it } from "vitest";
import { inicioDoDia } from "./campos";
import { diasAte, faixaProximaAcao, somarDias } from "./proxima-acao";

// Instantes em São Paulo (-03:00, sem horário de verão desde 2019).
const sp = (iso: string) => new Date(`${iso}-03:00`);
const dia = (d: string) => inicioDoDia(d)!;

describe("faixaProximaAcao", () => {
  it("sem data → sem", () => {
    expect(faixaProximaAcao(null, sp("2026-10-24T12:00:00"))).toBe("sem");
  });

  it("vencida / hoje / próximos 7 dias (sem hoje) / depois", () => {
    const agora = sp("2026-10-24T12:00:00");
    expect(faixaProximaAcao(dia("2026-10-23"), agora)).toBe("vencida");
    expect(faixaProximaAcao(dia("2026-10-24"), agora)).toBe("hoje");
    expect(faixaProximaAcao(dia("2026-10-25"), agora)).toBe("semana");
    expect(faixaProximaAcao(dia("2026-10-31"), agora)).toBe("semana");
    expect(faixaProximaAcao(dia("2026-11-01"), agora)).toBe("depois");
  });

  it("23:59 em SP ainda é o mesmo dia, mesmo com o relógio UTC já no dia seguinte", () => {
    const agora = sp("2026-10-24T23:59:59"); // 02:59 UTC do dia 25
    expect(agora.toISOString().slice(0, 10)).toBe("2026-10-25");
    expect(faixaProximaAcao(dia("2026-10-24"), agora)).toBe("hoje");
    expect(faixaProximaAcao(dia("2026-10-25"), agora)).toBe("semana");
    expect(faixaProximaAcao(dia("2026-10-31"), agora)).toBe("semana");
    expect(faixaProximaAcao(dia("2026-11-01"), agora)).toBe("depois");
  });

  it("00:00 em SP vira o dia: o de ontem passa a vencida", () => {
    const agora = sp("2026-10-25T00:00:00");
    expect(faixaProximaAcao(dia("2026-10-24"), agora)).toBe("vencida");
    expect(faixaProximaAcao(dia("2026-10-25"), agora)).toBe("hoje");
    expect(faixaProximaAcao(dia("2026-11-01"), agora)).toBe("semana");
  });

  it("21:00–23:59 em SP (UTC já no dia seguinte) não adianta o 'hoje'", () => {
    const agora = sp("2026-10-24T21:30:00");
    expect(faixaProximaAcao(dia("2026-10-25"), agora)).toBe("semana");
    expect(faixaProximaAcao(dia("2026-10-24"), agora)).toBe("hoje");
  });

  it("data gravada com horário qualquer conta pelo dia civil em SP", () => {
    const agora = sp("2026-10-24T08:00:00");
    // 2026-10-25 01:00 UTC = 24/10 22:00 em SP → hoje
    expect(faixaProximaAcao(new Date("2026-10-25T01:00:00Z"), agora)).toBe("hoje");
    // 2026-10-24 02:59 UTC = 23/10 23:59 em SP → vencida
    expect(faixaProximaAcao(new Date("2026-10-24T02:59:00Z"), agora)).toBe("vencida");
  });

  it("virada de mês e de ano", () => {
    expect(faixaProximaAcao(dia("2027-01-07"), sp("2026-12-31T23:00:00"))).toBe("semana");
    expect(faixaProximaAcao(dia("2027-01-08"), sp("2026-12-31T23:00:00"))).toBe("depois");
    expect(faixaProximaAcao(dia("2026-12-31"), sp("2027-01-01T00:00:00"))).toBe("vencida");
  });
});

describe("somarDias / diasAte", () => {
  it("soma dias civis com virada de mês, ano e bissexto", () => {
    expect(somarDias("2026-10-31", 1)).toBe("2026-11-01");
    expect(somarDias("2026-12-31", 7)).toBe("2027-01-07");
    expect(somarDias("2028-02-28", 1)).toBe("2028-02-29");
    expect(somarDias("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("diasAte: positivo no futuro, negativo no passado", () => {
    expect(diasAte("2026-10-24", "2026-10-24")).toBe(0);
    expect(diasAte("2026-10-24", "2026-10-31")).toBe(7);
    expect(diasAte("2026-10-24", "2026-10-21")).toBe(-3);
    expect(diasAte("2026-12-30", "2027-01-02")).toBe(3);
  });
});

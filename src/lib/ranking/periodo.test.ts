import { describe, expect, it } from "vitest";
import { dentroDoPeriodo, resolverPeriodo } from "./periodo";

const sp = (iso: string) => new Date(`${iso}-03:00`);

describe("resolverPeriodo — semana (seg–dom em SP)", () => {
  it("segunda 00:00 de SP abre a semana; domingo 23:59 ainda é a semana anterior", () => {
    const agora = sp("2026-10-26T12:00:00"); // segunda
    const s = resolverPeriodo("semana", "2026-10-25", agora); // domingo
    expect(s.primeiroDia).toBe("2026-10-19");
    expect(s.ultimoDia).toBe("2026-10-25");
    expect(s.inicio.toISOString()).toBe("2026-10-19T03:00:00.000Z");
    expect(s.fim.toISOString()).toBe("2026-10-26T03:00:00.000Z");
    expect(dentroDoPeriodo(sp("2026-10-25T23:59:59"), s)).toBe(true);
    expect(dentroDoPeriodo(sp("2026-10-26T00:00:00"), s)).toBe(false);
    expect(dentroDoPeriodo(sp("2026-10-19T00:00:00"), s)).toBe(true);
    expect(dentroDoPeriodo(sp("2026-10-18T23:59:59"), s)).toBe(false);
  });

  it("sem ref: semana de hoje em SP (domingo 23:30 SP já é segunda em UTC)", () => {
    const agora = sp("2026-10-25T23:30:00"); // 02:30Z de segunda
    const s = resolverPeriodo("semana", undefined, agora);
    expect(s.primeiroDia).toBe("2026-10-19");
    expect(s.atual).toBe(true);
    expect(s.proximo).toBeNull();
    expect(s.anterior).toBe("2026-10-18");
  });

  it("semana que atravessa a virada de mês/ano", () => {
    const s = resolverPeriodo("semana", "2026-12-31", sp("2027-01-10T10:00:00"));
    expect(s.primeiroDia).toBe("2026-12-28");
    expect(s.ultimoDia).toBe("2027-01-03");
    expect(s.proximo).toBe("2027-01-04");
    expect(s.atual).toBe(false);
  });

  it("ref inválida ou no futuro cai em hoje", () => {
    const agora = sp("2026-10-26T12:00:00");
    expect(resolverPeriodo("semana", "2026-02-30", agora).primeiroDia).toBe("2026-10-26");
    expect(resolverPeriodo("semana", "lixo", agora).primeiroDia).toBe("2026-10-26");
    expect(resolverPeriodo("semana", "2027-01-01", agora).primeiroDia).toBe("2026-10-26");
  });
});

describe("resolverPeriodo — mês", () => {
  it("virada de mês em SP: 31/10 23:59 é outubro, 01/11 00:00 é novembro", () => {
    const agora = sp("2026-11-15T12:00:00");
    const out = resolverPeriodo("mes", "2026-10-10", agora);
    expect(out.primeiroDia).toBe("2026-10-01");
    expect(out.ultimoDia).toBe("2026-10-31");
    expect(dentroDoPeriodo(sp("2026-10-31T23:59:59"), out)).toBe(true);
    expect(dentroDoPeriodo(sp("2026-11-01T00:00:00"), out)).toBe(false);
    // 31/10 22:00 SP = 01/11 01:00 UTC: ainda outubro.
    expect(dentroDoPeriodo(new Date("2026-11-01T01:00:00Z"), out)).toBe(true);
    expect(out.anterior).toBe("2026-09-30");
    expect(out.proximo).toBe("2026-11-01");
    expect(out.rotulo).toBe("outubro de 2026");
  });

  it("fevereiro e dezembro", () => {
    const agora = sp("2027-06-01T12:00:00");
    expect(resolverPeriodo("mes", "2027-02-14", agora).ultimoDia).toBe("2027-02-28");
    const dez = resolverPeriodo("mes", "2026-12-05", agora);
    expect(dez.ultimoDia).toBe("2026-12-31");
    expect(dez.fim.toISOString()).toBe("2027-01-01T03:00:00.000Z");
  });

  it("mês atual não tem próximo", () => {
    const m = resolverPeriodo("mes", undefined, sp("2026-10-26T12:00:00"));
    expect(m.primeiroDia).toBe("2026-10-01");
    expect(m.proximo).toBeNull();
    expect(m.atual).toBe(true);
  });
});

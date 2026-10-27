import { describe, expect, it } from "vitest";
import { gradeDe, paramsDoPeriodo, periodoDaBusca, primeiroDoMes, resolverPeriodo } from "./periodo";

const sp = (iso: string) => new Date(`${iso}-03:00`);
const agora = sp("2026-10-27T10:00:00"); // terça

describe("primeiroDoMes", () => {
  it("vira o ano nas duas direções", () => {
    expect(primeiroDoMes("2026-10-27")).toBe("2026-10-01");
    expect(primeiroDoMes("2026-12-31", 1)).toBe("2027-01-01");
    expect(primeiroDoMes("2027-01-15", -1)).toBe("2026-12-01");
  });
});

describe("resolverPeriodo: mês", () => {
  it("sem ?data= é o mês de hoje em SP, mesmo com o servidor em UTC", () => {
    // 31/10 23:30 em SP = 01/11 02:30 UTC: ainda é outubro.
    const p = resolverPeriodo("mes", undefined, sp("2026-10-31T23:30:00"));
    expect(p.primeiroDia).toBe("2026-10-01");
    expect(p.ultimoDia).toBe("2026-10-31");
    expect(p.dias).toHaveLength(31);
    expect(p.atual).toBe(true);
    expect(p.ref).toBeNull();
    expect(p.rotulo).toBe("Outubro 2026");
    expect(p.rotuloAgenda).toBe("Este mês");
  });

  it("grade em semanas completas seg–dom", () => {
    const p = resolverPeriodo("mes", undefined, agora);
    // Outubro/2026 começa numa quinta e termina num sábado.
    expect(p.grade[0]).toBe("2026-09-28");
    expect(p.grade.at(-1)).toBe("2026-11-01");
    expect(p.grade).toHaveLength(35);
  });

  it("mês que começa no domingo: a 1ª linha é quase toda do mês anterior", () => {
    const p = resolverPeriodo("mes", "2026-03-20", agora); // 01/03/2026 é domingo
    expect(p.primeiroDia).toBe("2026-03-01");
    expect(p.ultimoDia).toBe("2026-03-31");
    expect(p.grade[0]).toBe("2026-02-23");
    expect(p.grade[6]).toBe("2026-03-01");
    expect(p.grade.at(-1)).toBe("2026-04-05");
    expect(p.grade).toHaveLength(42);
    expect(p.ref).toBe("2026-03-01");
    expect(p.atual).toBe(false);
    expect(p.rotuloAgenda).toBe("Mês");
  });

  it("fevereiro (bissexto ou não) e navegação mês a mês", () => {
    expect(resolverPeriodo("mes", "2028-02-10", sp("2028-01-01T10:00:00")).ultimoDia).toBe("2028-02-29");
    const p = resolverPeriodo("mes", "2027-02-10", agora);
    expect(p.ultimoDia).toBe("2027-02-28");
    expect(p.anterior).toBe("2027-01-01");
    expect(p.proxima).toBe("2027-03-01");
    expect(resolverPeriodo("mes", "2026-12-05", agora).proxima).toBe("2027-01-01");
  });
});

describe("resolverPeriodo: 15 dias", () => {
  it("rolante: hoje + 14, grade em semanas completas", () => {
    const p = resolverPeriodo("15d", undefined, agora);
    expect(p.primeiroDia).toBe("2026-10-27");
    expect(p.ultimoDia).toBe("2026-11-10");
    expect(p.dias).toHaveLength(15);
    expect(p.grade[0]).toBe("2026-10-26");
    expect(p.grade.at(-1)).toBe("2026-11-15");
    expect(p.atual).toBe(true);
    expect(p.rotulo).toBe("27/10 a 10/11/2026");
    expect(p.rotuloAgenda).toBe("Próximos 15 dias");
  });

  it("navega de 15 em 15 dias, virando o ano", () => {
    const p = resolverPeriodo("15d", "2026-12-25", agora);
    expect(p.ultimoDia).toBe("2027-01-08");
    expect(p.anterior).toBe("2026-12-10");
    expect(p.proxima).toBe("2027-01-09");
    expect(p.rotulo).toBe("25/12/2026 a 08/01/2027");
    expect(p.atual).toBe(false);
    expect(p.ref).toBe("2026-12-25");
  });
});

describe("resolverPeriodo: semana", () => {
  it("igual à semana do Calendário (seg–dom), navegação de 7 dias", () => {
    const p = resolverPeriodo("semana", "2026-10-29", agora);
    expect(p.primeiroDia).toBe("2026-10-26");
    expect(p.ultimoDia).toBe("2026-11-01");
    expect(p.grade).toEqual(p.dias);
    expect(p.anterior).toBe("2026-10-19");
    expect(p.proxima).toBe("2026-11-02");
    expect(p.atual).toBe(true);
    expect(p.ref).toBeNull();
    expect(p.rotuloAgenda).toBe("Esta semana");
  });
});

describe("periodoDaBusca", () => {
  it("padrão é o mês; período ou data inválidos caem no padrão/atual", () => {
    expect(periodoDaBusca({}, agora).periodo).toBe("mes");
    expect(periodoDaBusca({ periodo: "ano" }, agora).periodo).toBe("mes");
    for (const data of ["lixo", "2026-02-30", "9999-01-01"]) {
      expect(periodoDaBusca({ periodo: "15d", data }, agora).primeiroDia).toBe("2026-10-27");
    }
  });

  it("link antigo ?semana= abre aquela semana", () => {
    const p = periodoDaBusca({ semana: "2026-11-04" }, agora);
    expect(p.periodo).toBe("semana");
    expect(p.primeiroDia).toBe("2026-11-02");
  });
});

describe("paramsDoPeriodo", () => {
  it("omite o padrão e a data do período atual", () => {
    expect(paramsDoPeriodo("mes", null)).toEqual({});
    expect(paramsDoPeriodo("15d", null)).toEqual({ periodo: "15d" });
    expect(paramsDoPeriodo("semana", "2026-11-02")).toEqual({ periodo: "semana", data: "2026-11-02" });
  });
});

describe("gradeDe", () => {
  it("um único domingo vira a semana inteira dele", () => {
    expect(gradeDe("2026-11-01", "2026-11-01")).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
  });
});

import { describe, expect, it } from "vitest";
import { agruparPorDia, diaDoPrazo, instanteDoPrazo, resolverSemana, segundaDe } from "./semana";

const sp = (iso: string) => new Date(`${iso}-03:00`);

describe("segundaDe", () => {
  it("semana começa na segunda (pt-BR): domingo pertence à semana que começou 6 dias antes", () => {
    expect(segundaDe("2026-10-26")).toBe("2026-10-26"); // segunda
    expect(segundaDe("2026-10-28")).toBe("2026-10-26"); // quarta
    expect(segundaDe("2026-11-01")).toBe("2026-10-26"); // domingo
    expect(segundaDe("2026-11-02")).toBe("2026-11-02");
  });

  it("vira mês e ano", () => {
    expect(segundaDe("2026-03-01")).toBe("2026-02-23"); // domingo 1º de março
    expect(segundaDe("2027-01-01")).toBe("2026-12-28"); // sexta
    expect(segundaDe("2027-01-03")).toBe("2026-12-28"); // domingo
  });
});

describe("resolverSemana", () => {
  it("sem ?semana= é a semana de hoje em SP, mesmo com o servidor em UTC", () => {
    // Domingo 01/11 23:30 em SP = segunda 02/11 02:30 UTC: ainda é a semana de 26/10.
    const s = resolverSemana(undefined, sp("2026-11-01T23:30:00"));
    expect(s.segunda).toBe("2026-10-26");
    expect(s.domingo).toBe("2026-11-01");
    expect(s.hoje).toBe("2026-11-01");
    expect(s.atual).toBe(true);
    expect(s.dias).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
  });

  it("intervalo meio-aberto em instantes de SP: segunda 00:00 até a segunda seguinte", () => {
    const s = resolverSemana("2026-10-28", sp("2026-10-27T10:00:00"));
    expect(s.inicio.toISOString()).toBe("2026-10-26T03:00:00.000Z");
    expect(s.fim.toISOString()).toBe("2026-11-02T03:00:00.000Z");
  });

  it("qualquer dia da semana normaliza para a segunda; navegação anterior/próxima", () => {
    const s = resolverSemana("2026-12-31", sp("2026-10-27T10:00:00"));
    expect(s.segunda).toBe("2026-12-28");
    expect(s.domingo).toBe("2027-01-03");
    expect(s.anterior).toBe("2026-12-21");
    expect(s.proxima).toBe("2027-01-04");
    expect(s.atual).toBe(false);
    expect(s.rotulo).toBe("28/12/2026 a 03/01/2027");
  });

  it("rótulo sem repetir o ano quando a semana não vira o ano", () => {
    expect(resolverSemana("2026-10-26", sp("2026-10-27T10:00:00")).rotulo).toBe("26/10 a 01/11/2026");
  });

  it("?semana= inválido ou absurdo cai na semana atual", () => {
    for (const ref of ["", "lixo", "2026-02-30", "2026-13-01", "0001-01-01", "9999-12-31"]) {
      expect(resolverSemana(ref, sp("2026-10-27T10:00:00")).segunda).toBe("2026-10-26");
    }
  });
});

describe("prazo: dia civil ↔ coluna DATE", () => {
  it("ida e volta sem depender do fuso", () => {
    expect(instanteDoPrazo("2026-10-30").toISOString()).toBe("2026-10-30T00:00:00.000Z");
    expect(diaDoPrazo(instanteDoPrazo("2026-10-30"))).toBe("2026-10-30");
  });
});

describe("agruparPorDia", () => {
  const dias = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"];

  it("sete dias na ordem, mesmo os vazios; itens fora da semana ficam de fora", () => {
    const g = agruparPorDia(dias, [{ id: "a", dia: "2026-10-27" }, { id: "fora", dia: "2026-11-02" }], [{ id: "p", dia: "2026-11-01" }]);
    expect(g.map((d) => d.dia)).toEqual(dias);
    expect(g[1].acoes.map((a) => a.id)).toEqual(["a"]);
    expect(g[6].prazos.map((p) => p.id)).toEqual(["p"]);
    expect(g.flatMap((d) => d.acoes).map((a) => a.id)).not.toContain("fora");
  });

  it("mantém a ordem de entrada dentro do dia", () => {
    const g = agruparPorDia(dias, [{ id: "1", dia: "2026-10-28" }, { id: "2", dia: "2026-10-28" }], []);
    expect(g[2].acoes.map((a) => a.id)).toEqual(["1", "2"]);
  });
});

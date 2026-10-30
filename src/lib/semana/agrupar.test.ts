import { describe, expect, it } from "vitest";
import { inicioDoDia } from "@/lib/projetos/campos";
import { agruparSemana, quandoRotulo, validarProximaEscolha } from "./agrupar";

const sp = (iso: string) => new Date(`${iso}-03:00`);
const AGORA = sp("2026-10-24T12:00:00"); // sábado
const item = (id: string, dia: string | null, faseDesde = "2026-10-01T10:00:00") => ({
  id,
  proximaAcaoEm: dia ? inicioDoDia(dia)! : null,
  faseDesde: sp(faseDesde),
});
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("agruparSemana", () => {
  it("separa em vencidas / hoje / 7 dias / sem e conta o que fica além da semana", () => {
    const g = agruparSemana(
      [item("d8", "2026-11-01"), item("sem", null), item("d1", "2026-10-25"), item("hoje", "2026-10-24"), item("ontem", "2026-10-23"), item("d7", "2026-10-31")],
      AGORA,
    );
    expect(g.destaque?.id).toBe("ontem");
    expect(g.destaqueFaixa).toBe("vencida");
    expect(ids(g.vencidas)).toEqual([]); // o destaque não se repete na lista
    expect(g.totais).toEqual({ vencida: 1, hoje: 1, semana: 2, sem: 1 });
    expect(ids(g.hoje)).toEqual(["hoje"]);
    expect(ids(g.semana)).toEqual(["d1", "d7"]);
    expect(ids(g.sem)).toEqual(["sem"]);
    expect(g.depois).toBe(1);
  });

  it("destaque: a vencida mais antiga primeiro", () => {
    const g = agruparSemana([item("v2", "2026-10-22"), item("v5", "2026-10-19"), item("h", "2026-10-24")], AGORA);
    expect(g.destaque?.id).toBe("v5");
    expect(ids(g.vencidas)).toEqual(["v2"]);
  });

  it("sem vencida → destaque é de hoje; sem hoje → a mais próxima", () => {
    expect(agruparSemana([item("d3", "2026-10-27"), item("h", "2026-10-24")], AGORA).destaque?.id).toBe("h");
    const g = agruparSemana([item("d3", "2026-10-27"), item("d1", "2026-10-25"), item("sem", null)], AGORA);
    expect(g.destaque?.id).toBe("d1");
    expect(g.destaqueFaixa).toBe("semana");
    expect(ids(g.semana)).toEqual(["d3"]);
  });

  it("só 'sem próxima ação' ou 'depois' → sem destaque", () => {
    const g = agruparSemana([item("sem", null), item("longe", "2026-12-01")], AGORA);
    expect(g.destaque).toBeNull();
    expect(g.destaqueFaixa).toBeNull();
    expect(ids(g.sem)).toEqual(["sem"]);
  });

  it("empate no dia: há mais tempo na fase primeiro, depois id", () => {
    const g = agruparSemana(
      [item("b", "2026-10-24", "2026-10-10T10:00:00"), item("a", "2026-10-24", "2026-10-10T10:00:00"), item("velho", "2026-10-24", "2026-09-01T10:00:00")],
      AGORA,
    );
    expect(g.destaque?.id).toBe("velho");
    expect(ids(g.hoje)).toEqual(["a", "b"]);
  });

  it("sem próxima ação: há mais tempo na fase primeiro", () => {
    const g = agruparSemana([item("novo", null, "2026-10-20T10:00:00"), item("antigo", null, "2026-09-01T10:00:00")], AGORA);
    expect(ids(g.sem)).toEqual(["antigo", "novo"]);
  });

  it("fronteira de meia-noite em SP com servidor em UTC", () => {
    // 23:59 em SP (02:59 UTC do dia 25): o card de 25/10 ainda é dos próximos dias.
    const quase = agruparSemana([item("d25", "2026-10-25"), item("d24", "2026-10-24")], sp("2026-10-24T23:59:00"));
    expect(quase.destaque?.id).toBe("d24");
    expect(quase.destaqueFaixa).toBe("hoje");
    expect(ids(quase.semana)).toEqual(["d25"]);
    // 00:00 em SP: o de 24 vence, o de 25 é hoje.
    const virou = agruparSemana([item("d25", "2026-10-25"), item("d24", "2026-10-24")], sp("2026-10-25T00:00:00"));
    expect(virou.destaque?.id).toBe("d24");
    expect(virou.destaqueFaixa).toBe("vencida");
    expect(ids(virou.hoje)).toEqual(["d25"]);
  });
});

describe("quandoRotulo", () => {
  it("vencida: ontem / há N dias", () => {
    expect(quandoRotulo(inicioDoDia("2026-10-23")!, AGORA)).toEqual({ curto: "ontem", data: "23/10" });
    expect(quandoRotulo(inicioDoDia("2026-10-19")!, AGORA)).toEqual({ curto: "há 5 dias", data: "19/10" });
  });

  it("hoje, amanhã e dia da semana", () => {
    expect(quandoRotulo(inicioDoDia("2026-10-24")!, AGORA)).toEqual({ curto: "hoje", data: "24/10" });
    expect(quandoRotulo(inicioDoDia("2026-10-25")!, AGORA)).toEqual({ curto: "amanhã", data: "25/10" });
    expect(quandoRotulo(inicioDoDia("2026-10-28")!, AGORA)).toEqual({ curto: "qua", data: "28/10" });
  });

  it("ano diferente aparece na data", () => {
    expect(quandoRotulo(inicioDoDia("2027-01-02")!, sp("2026-12-30T10:00:00"))).toEqual({ curto: "sáb", data: "02/01/2027" });
  });

  it("usa o dia de SP, não o do servidor (23:30 em SP = dia seguinte em UTC)", () => {
    expect(quandoRotulo(inicioDoDia("2026-10-25")!, sp("2026-10-24T23:30:00")).curto).toBe("amanhã");
  });
});

describe("validarProximaEscolha", () => {
  it("exige ação e data", () => {
    expect(validarProximaEscolha("", "2026-10-25", AGORA)).toEqual({ ok: false, erro: "Descreva a próxima ação." });
    expect(validarProximaEscolha("Ligar", "", AGORA)).toEqual({ ok: false, erro: "Escolha a data da próxima ação." });
    expect(validarProximaEscolha("Ligar", "2026-02-30", AGORA)).toEqual({ ok: false, erro: "Data inválida." });
  });

  it("não aceita data no passado (hoje vale)", () => {
    expect(validarProximaEscolha("Ligar", "2026-10-23", AGORA)).toEqual({ ok: false, erro: "A data da próxima ação não pode estar no passado." });
    const r = validarProximaEscolha("  Ligar   de novo ", "2026-10-24", AGORA);
    expect(r).toEqual({ ok: true, proximaAcao: "Ligar   de novo", proximaAcaoEm: inicioDoDia("2026-10-24") });
  });

  it("'hoje' é o de SP: às 23:30 de SP ainda aceita a data de hoje e recusa a de ontem", () => {
    expect(validarProximaEscolha("x", "2026-10-24", sp("2026-10-24T23:30:00")).ok).toBe(true);
    expect(validarProximaEscolha("x", "2026-10-23", sp("2026-10-24T23:30:00")).ok).toBe(false);
  });

  it("limita o texto a 500 caracteres", () => {
    expect(validarProximaEscolha("a".repeat(501), "2026-10-25", AGORA).ok).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { resolverSemana } from "@/lib/calendario/semana";
import { dividirSemana, fimDaJanela } from "./colunas";

const sp = (iso: string) => new Date(`${iso}-03:00`);
const a = (cardId: string, dia: string) => ({ cardId, dia });
const p = (id: string, dia: string) => ({ id, dia });

describe("dividirSemana (Minha Semana em colunas)", () => {
  // Quinta 29/10/2026: semana 26/10–01/11; hoje+7 = 05/11.
  const semana = resolverSemana(undefined, sp("2026-10-29T10:00:00"));

  it("janela = segunda desta semana até hoje+7", () => {
    expect(fimDaJanela(semana)).toBe("2026-11-05");
  });

  it("o destaque (Mais urgente) também aparece na coluna do dia dele", () => {
    const r = dividirSemana(semana, { acoes: [a("x", "2026-10-30"), a("y", "2026-10-29")], prazos: [] }, "x");
    expect(r.dias[4].acoes.map((i) => i.cardId)).toEqual(["x"]);
    expect(r.dias[3].acoes.map((i) => i.cardId)).toEqual(["y"]);
  });

  it("depois do domingo até hoje+7 vai para a 'Próxima semana' (nada do antigo 'Próximos 7 dias' some)", () => {
    const r = dividirSemana(
      semana,
      { acoes: [a("dom", "2026-11-01"), a("seg", "2026-11-02"), a("qui", "2026-11-05"), a("destaque", "2026-11-03")], prazos: [p("pz", "2026-11-04"), p("col", "2026-10-30")] },
      "destaque",
    );
    expect(r.dias[6].acoes.map((i) => i.cardId)).toEqual(["dom"]);
    expect(r.proxima.acoes.map((i) => i.cardId)).toEqual(["seg", "qui"]);
    expect(r.proxima.prazos.map((i) => i.id)).toEqual(["pz"]);
    expect(r.dias[4].prazos.map((i) => i.id)).toEqual(["col"]);
  });

  it("destaque depois do domingo não se repete na 'Próxima semana' (já está no topo)", () => {
    const r = dividirSemana(semana, { acoes: [a("destaque", "2026-11-03"), a("outro", "2026-11-03")], prazos: [] }, "destaque");
    expect(r.proxima.acoes.map((i) => i.cardId)).toEqual(["outro"]);
    expect(r.dias.flatMap((d) => d.acoes)).toHaveLength(0);
  });

  it("sem destaque, nada é filtrado", () => {
    const r = dividirSemana(semana, { acoes: [a("x", "2026-10-26"), a("y", "2026-11-02")], prazos: [] }, null);
    expect(r.dias[0].acoes).toHaveLength(1);
    expect(r.proxima.acoes).toHaveLength(1);
  });
});

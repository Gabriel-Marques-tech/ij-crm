import { describe, expect, it } from "vitest";
import { desfazerMovimento } from "./otimista";
import type { CardCliente } from "./tipos";

const card = (id: string, faseId: string, faseDesdeMs = 1): CardCliente => ({
  id,
  titulo: id,
  descricaoPrevia: null,
  descricaoTruncada: false,
  faseId,
  faseDesdeMs,
  revisar: false,
  proximaAcao: null,
  proximaAcaoEmMs: null,
  responsavelId: "u-ana",
  responsavelNome: "Ana",
  responsavelFotoEm: null,
  empresaNome: null,
  origem: null,
  estado: null,
  valorFechado: null,
  motivoPerda: null,
  alertaVenda: null,
});

describe("desfazerMovimento", () => {
  const original = card("x", "A", 100);

  it("card ainda no destino otimista → volta para fase e faseDesde originais, outros intactos", () => {
    const atual = [card("y", "B", 5), { ...original, faseId: "B", faseDesdeMs: 999 }, card("z", "C", 7)];
    const r = desfazerMovimento(atual, "x", "B", original);
    expect(r.find((c) => c.id === "x")).toMatchObject({ faseId: "A", faseDesdeMs: 100 });
    expect(r.filter((c) => c.id !== "x")).toEqual([atual[0], atual[2]]);
  });

  it("card já saiu do destino (movimento posterior) → não mexe", () => {
    const atual = [{ ...original, faseId: "C", faseDesdeMs: 1000 }];
    expect(desfazerMovimento(atual, "x", "B", original)).toBe(atual);
  });

  it("card sumiu (revalidate trouxe estado novo) → não mexe", () => {
    const atual = [card("y", "B")];
    expect(desfazerMovimento(atual, "x", "B", original)).toBe(atual);
  });
});

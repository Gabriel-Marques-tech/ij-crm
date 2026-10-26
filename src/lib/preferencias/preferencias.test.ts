import { describe, expect, it } from "vitest";
import {
  PREFERENCIAS_PADRAO,
  VISUALIZACAO_PADRAO,
  comInicio,
  comVisualizacaoKanban,
  destinoInicio,
  inicioSchema,
  lerPreferencias,
  paginaInicial,
  visualizacaoKanban,
} from "./preferencias";

describe("lerPreferencias", () => {
  it("válido → mesmo conteúdo", () => {
    const p = { v: 1, kanban: { vendas: { mostrarVazias: true, abertas: ["perdido"] } } };
    expect(lerPreferencias(p)).toEqual(p);
  });

  it.each([null, undefined, "x", 42, [], { v: 2, kanban: {} }, { kanban: {} }])("inválido (%j) → padrão, sem lançar", (bruto) => {
    expect(lerPreferencias(bruto)).toEqual(PREFERENCIAS_PADRAO);
  });

  it("chaves desconhecidas são descartadas", () => {
    const p = lerPreferencias({ v: 1, tema: "claro", kanban: { vendas: { mostrarVazias: false, abertas: [], cor: "azul" } } });
    expect(p).toEqual({ v: 1, kanban: { vendas: { mostrarVazias: false, abertas: [] } } });
  });

  it("um quadro corrompido não derruba os outros", () => {
    const p = lerPreferencias({ v: 1, kanban: { vendas: { mostrarVazias: "sim", abertas: "x" }, projetos: { mostrarVazias: true, abertas: ["a"] } } });
    expect(p.kanban.vendas).toEqual(VISUALIZACAO_PADRAO);
    expect(p.kanban.projetos).toEqual({ mostrarVazias: true, abertas: ["a"] });
  });

  it("kanban inválido → vazio, mantendo v", () => {
    expect(lerPreferencias({ v: 1, kanban: "x" })).toEqual(PREFERENCIAS_PADRAO);
  });
});

describe("página inicial (GAB-43)", () => {
  it("sem preferência → Minha Semana", () => {
    expect(paginaInicial(PREFERENCIAS_PADRAO)).toBe("semana");
    expect(destinoInicio(PREFERENCIAS_PADRAO)).toBe("/semana");
  });

  it.each([
    ["semana", "/semana"],
    ["vendas", "/kanban"],
    ["projetos", "/kanban?quadro=projetos"],
  ] as const)("%s → %s", (inicio, destino) => {
    const p = lerPreferencias({ v: 1, kanban: {}, inicio });
    expect(p.inicio).toBe(inicio);
    expect(destinoInicio(p)).toBe(destino);
  });

  it("valor inválido em `inicio` vira o padrão sem derrubar o kanban", () => {
    const p = lerPreferencias({ v: 1, inicio: "tabela", kanban: { vendas: { mostrarVazias: true, abertas: [] } } });
    expect(paginaInicial(p)).toBe("semana");
    expect(p.kanban.vendas).toEqual({ mostrarVazias: true, abertas: [] });
  });

  it("comInicio troca só a página inicial", () => {
    const original = lerPreferencias({ v: 1, kanban: { vendas: { mostrarVazias: true, abertas: [] } } });
    expect(comInicio(original, "projetos")).toEqual({ v: 1, inicio: "projetos", kanban: { vendas: { mostrarVazias: true, abertas: [] } } });
    expect(original.inicio).toBeUndefined();
  });

  it("schema estrito de entrada recusa valor fora da lista", () => {
    expect(inicioSchema.safeParse("vendas").success).toBe(true);
    expect(inicioSchema.safeParse("/admin").success).toBe(false);
  });
});

describe("visualizacaoKanban", () => {
  const p = lerPreferencias({ v: 1, kanban: { vendas: { mostrarVazias: true, abertas: ["perdido", "fase_apagada", "perdido"] } } });

  it("ignora chaves de fase que não existem mais e repetidas", () => {
    expect(visualizacaoKanban(p, "vendas", ["primeiro_contato", "perdido"])).toEqual({ mostrarVazias: true, abertas: ["perdido"] });
  });

  it("quadro sem preferência → padrão", () => {
    expect(visualizacaoKanban(p, "projetos", ["x"])).toEqual(VISUALIZACAO_PADRAO);
  });
});

describe("comVisualizacaoKanban", () => {
  it("troca só o quadro pedido, sem mutar o original", () => {
    const original = lerPreferencias({ v: 1, kanban: { projetos: { mostrarVazias: true, abertas: [] } } });
    const novo = comVisualizacaoKanban(original, "vendas", { mostrarVazias: false, abertas: ["a"] });
    expect(novo).toEqual({ v: 1, kanban: { projetos: { mostrarVazias: true, abertas: [] }, vendas: { mostrarVazias: false, abertas: ["a"] } } });
    expect(original.kanban.vendas).toBeUndefined();
  });
});

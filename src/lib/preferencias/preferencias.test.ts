import { describe, expect, it } from "vitest";
import {
  PREFERENCIAS_PADRAO,
  VISUALIZACAO_PADRAO,
  comInicio,
  comVisualizacaoKanban,
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

  it("bloco `tarefas` inválido vira ausente sem derrubar o resto", () => {
    const p = lerPreferencias({ v: 1, kanban: {}, tarefas: { vista: "lista" } });
    expect(p.tarefas).toBeUndefined();
    expect(p.kanban).toEqual({});
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

describe("página inicial dentro da área (GAB-97)", () => {
  it("sem preferência → Minha Semana", () => {
    expect(paginaInicial(PREFERENCIAS_PADRAO)).toBe("semana");
  });

  it.each([
    ["semana", "semana"],
    ["kanban", "kanban"],
    // Valores do GAB-43, ainda gravados no JSON: a área decide o quadro.
    ["vendas", "kanban"],
    ["projetos", "kanban"],
  ] as const)("gravado %s → %s", (inicio, esperado) => {
    expect(paginaInicial(lerPreferencias({ v: 1, kanban: {}, inicio }))).toBe(esperado);
  });

  it("valor inválido em `inicio` vira o padrão sem derrubar o kanban", () => {
    const p = lerPreferencias({ v: 1, inicio: "tabela", kanban: { vendas: { mostrarVazias: true, abertas: [] } } });
    expect(paginaInicial(p)).toBe("semana");
    expect(p.kanban.vendas).toEqual({ mostrarVazias: true, abertas: [] });
  });

  it("comInicio troca só a página inicial", () => {
    const original = lerPreferencias({ v: 1, kanban: { vendas: { mostrarVazias: true, abertas: [] } } });
    expect(comInicio(original, "kanban")).toEqual({ v: 1, inicio: "kanban", kanban: { vendas: { mostrarVazias: true, abertas: [] } } });
    expect(original.inicio).toBeUndefined();
  });

  it("schema estrito de entrada só aceita os valores novos", () => {
    expect(inicioSchema.safeParse("kanban").success).toBe(true);
    expect(inicioSchema.safeParse("vendas").success).toBe(false);
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

describe("avisos no WhatsApp (GAB-88)", () => {
  it("ausente → ligado (padrão); gravado → o que a pessoa escolheu", async () => {
    const { comWhatsappAvisos, whatsappAvisosLigado } = await import("./preferencias");
    expect(whatsappAvisosLigado(lerPreferencias({ v: 1, kanban: {} }))).toBe(true);
    const desligado = comWhatsappAvisos(PREFERENCIAS_PADRAO, false);
    expect(whatsappAvisosLigado(lerPreferencias(desligado))).toBe(false);
    expect(lerPreferencias(desligado)).toMatchObject({ v: 1, kanban: {} });
  });

  it("valor corrompido não apaga o resto: vira o padrão (ligado)", async () => {
    const { whatsappAvisosLigado } = await import("./preferencias");
    const p = lerPreferencias({ v: 1, kanban: {}, inicio: "vendas", avisos: { whatsapp: "talvez" } });
    expect(p.inicio).toBe("kanban");
    expect(whatsappAvisosLigado(p)).toBe(true);
  });
});

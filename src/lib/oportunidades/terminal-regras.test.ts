import { describe, expect, it } from "vitest";
import { dialogoTerminal, interpretarGanho, interpretarPerda, lerDinheiro, MOTIVOS_PERDA } from "./terminal-regras";

describe("lerDinheiro", () => {
  it("aceita formato BR, com ou sem R$, e devolve decimal com 2 casas", () => {
    expect(lerDinheiro("12.500,00")).toEqual({ ok: true, valor: "12500.00" });
    expect(lerDinheiro("R$ 1.234,5")).toEqual({ ok: true, valor: "1234.50" });
    expect(lerDinheiro("r$12500")).toEqual({ ok: true, valor: "12500.00" });
    expect(lerDinheiro("  8000.75 ")).toEqual({ ok: true, valor: "8000.75" });
    expect(lerDinheiro("0")).toEqual({ ok: true, valor: "0.00" });
    expect(lerDinheiro("12.500")).toEqual({ ok: true, valor: "12500.00" });
    expect(lerDinheiro("1.250.000")).toEqual({ ok: true, valor: "1250000.00" });
  });

  it("vazio = sem valor", () => {
    expect(lerDinheiro("")).toEqual({ ok: true, valor: null });
    expect(lerDinheiro("   ")).toEqual({ ok: true, valor: null });
  });

  it("recusa negativo, texto, notação científica, 3 casas e acima de 12 dígitos", () => {
    for (const ruim of ["-10", "abc", "1e5", "10,123", "1.2.3,4,5", "1234567890123", "Infinity", "NaN", "12,"]) {
      expect(lerDinheiro(ruim), ruim).toEqual({ ok: false });
    }
  });
});

describe("dialogoTerminal", () => {
  it("ganho só pede dados em vendas; perdido pede motivo em qualquer quadro", () => {
    expect(dialogoTerminal("vendas", "GANHO")).toBe("GANHO");
    expect(dialogoTerminal("vendas", "PERDIDO")).toBe("PERDIDO");
    expect(dialogoTerminal("projetos", "GANHO")).toBeNull();
    expect(dialogoTerminal("projetos", "PERDIDO")).toBe("PERDIDO");
    expect(dialogoTerminal("vendas", null)).toBeNull();
  });
});

describe("interpretarGanho", () => {
  it("valor opcional: ausente ou vazio → null", () => {
    expect(interpretarGanho(undefined)).toEqual({ ok: true, valorFechado: null });
    expect(interpretarGanho({})).toEqual({ ok: true, valorFechado: null });
    expect(interpretarGanho({ valorFechado: "" })).toEqual({ ok: true, valorFechado: null });
  });

  it("valor BR válido vira decimal; inválido é erro de regra", () => {
    expect(interpretarGanho({ valorFechado: "R$ 45.000,00" })).toEqual({ ok: true, valorFechado: "45000.00" });
    expect(interpretarGanho({ valorFechado: "quarenta mil" })).toEqual({ ok: false, erro: "VALOR_FECHADO_INVALIDO" });
    expect(interpretarGanho({ valorFechado: 45000 })).toEqual({ ok: false, erro: "VALOR_FECHADO_INVALIDO" });
  });
});

describe("interpretarPerda", () => {
  it("lista curta: preço, timing, concorrente, sem resposta, outro", () => {
    expect(MOTIVOS_PERDA.map((m) => m.chave)).toEqual(["preco", "timing", "concorrente", "sem_resposta", "outro"]);
  });

  it("motivo é obrigatório e precisa ser da lista", () => {
    expect(interpretarPerda(undefined)).toEqual({ ok: false, erro: "MOTIVO_PERDA_OBRIGATORIO" });
    expect(interpretarPerda({ motivo: "" })).toEqual({ ok: false, erro: "MOTIVO_PERDA_OBRIGATORIO" });
    expect(interpretarPerda({ motivo: "toString" })).toEqual({ ok: false, erro: "MOTIVO_PERDA_INVALIDO" });
    expect(interpretarPerda({ motivo: 3 })).toEqual({ ok: false, erro: "MOTIVO_PERDA_INVALIDO" });
  });

  it("grava o rótulo, com o detalhe opcional depois de dois-pontos", () => {
    expect(interpretarPerda({ motivo: "preco" })).toEqual({ ok: true, motivoPerda: "Preço" });
    expect(interpretarPerda({ motivo: "sem_resposta", detalhe: "  " })).toEqual({ ok: true, motivoPerda: "Sem resposta" });
    expect(interpretarPerda({ motivo: "concorrente", detalhe: "  fechou   com a  X " })).toEqual({ ok: true, motivoPerda: "Concorrente: fechou com a X" });
  });

  it("“outro” exige texto", () => {
    expect(interpretarPerda({ motivo: "outro" })).toEqual({ ok: false, erro: "MOTIVO_PERDA_DETALHE_OBRIGATORIO" });
    expect(interpretarPerda({ motivo: "outro", detalhe: "   " })).toEqual({ ok: false, erro: "MOTIVO_PERDA_DETALHE_OBRIGATORIO" });
    expect(interpretarPerda({ motivo: "outro", detalhe: "empresa fechou" })).toEqual({ ok: true, motivoPerda: "Outro: empresa fechou" });
  });

  it("detalhe tem limite de tamanho", () => {
    expect(interpretarPerda({ motivo: "timing", detalhe: "x".repeat(501) })).toEqual({ ok: false, erro: "MOTIVO_PERDA_DETALHE_LONGO" });
    expect(interpretarPerda({ motivo: "timing", detalhe: 42 })).toEqual({ ok: false, erro: "MOTIVO_PERDA_INVALIDO" });
  });
});

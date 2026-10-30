import { describe, expect, it } from "vitest";
import { alertaDaVenda, dialogoTerminal, interpretarGanho, interpretarPerda, lerDinheiro, MOTIVOS_PERDA, motivoDeTexto, valorParaCampo } from "./terminal-regras";

describe("lerDinheiro", () => {
  it("aceita formato BR, com ou sem R$, e devolve decimal com 2 casas", () => {
    expect(lerDinheiro("12.500,00")).toEqual({ ok: true, valor: "12500.00" });
    expect(lerDinheiro("R$ 1.234,5")).toEqual({ ok: true, valor: "1234.50" });
    expect(lerDinheiro("r$12500")).toEqual({ ok: true, valor: "12500.00" });
    expect(lerDinheiro("  8000,75 ")).toEqual({ ok: true, valor: "8000.75" });
    expect(lerDinheiro("0")).toEqual({ ok: true, valor: "0.00" });
    expect(lerDinheiro("12.500")).toEqual({ ok: true, valor: "12500.00" });
    expect(lerDinheiro("1.250.000")).toEqual({ ok: true, valor: "1250000.00" });
  });

  it("milhar BR sem centavos e decimal com vírgula", () => {
    expect(lerDinheiro("1.234")).toEqual({ ok: true, valor: "1234.00" });
    expect(lerDinheiro("12.500")).toEqual({ ok: true, valor: "12500.00" });
    expect(lerDinheiro("1.234,56")).toEqual({ ok: true, valor: "1234.56" });
    expect(lerDinheiro("1,5")).toEqual({ ok: true, valor: "1.50" });
  });

  it("ponto só é milhar (grupos de 3); decimal é com vírgula: '1.23', '8000.75' e o americano '1,234.56' são recusados", () => {
    for (const ruim of ["1.23", "8000.75", "12500.5", "1,234.56", "12.34,5", "1.2345"]) {
      expect(lerDinheiro(ruim), ruim).toEqual({ ok: false });
    }
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
  it("exige o objeto de dados (o servidor é a porta, não o diálogo)", () => {
    expect(interpretarGanho(undefined)).toEqual({ ok: false, erro: "DADOS_TERMINAL_OBRIGATORIOS" });
    expect(interpretarGanho(null)).toEqual({ ok: false, erro: "DADOS_TERMINAL_OBRIGATORIOS" });
    expect(interpretarGanho([])).toEqual({ ok: false, erro: "DADOS_TERMINAL_OBRIGATORIOS" });
    expect(interpretarGanho("12")).toEqual({ ok: false, erro: "DADOS_TERMINAL_OBRIGATORIOS" });
  });

  it("valor opcional: ausente ou vazio → null", () => {
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
    expect(interpretarPerda(undefined)).toEqual({ ok: false, erro: "DADOS_TERMINAL_OBRIGATORIOS" });
    expect(interpretarPerda({})).toEqual({ ok: false, erro: "MOTIVO_PERDA_OBRIGATORIO" });
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

describe("pré-preenchimento do diálogo (re-ganho / re-perda)", () => {
  it("valor guardado (decimal) → texto BR que o próprio parser aceita", () => {
    expect(valorParaCampo("10000.00")).toBe("10.000,00");
    expect(valorParaCampo("1.5")).toBe("1,50");
    expect(valorParaCampo(null)).toBe("");
    for (const v of ["10000.00", "1234567.89", "0.00"]) {
      expect(lerDinheiro(valorParaCampo(v))).toEqual({ ok: true, valor: Number(v).toFixed(2) });
    }
  });

  it("motivo gravado → motivo + detalhe; texto fora da lista vira “outro”", () => {
    expect(motivoDeTexto("Preço")).toEqual({ motivo: "preco", detalhe: "" });
    expect(motivoDeTexto("Concorrente: fechou com a X")).toEqual({ motivo: "concorrente", detalhe: "fechou com a X" });
    expect(motivoDeTexto("Outro: empresa fechou")).toEqual({ motivo: "outro", detalhe: "empresa fechou" });
    expect(motivoDeTexto("cliente sumiu")).toEqual({ motivo: "outro", detalhe: "cliente sumiu" });
    expect(motivoDeTexto(null)).toEqual({ motivo: "", detalhe: "" });
    // Ida e volta.
    const r = interpretarPerda(motivoDeTexto("Timing: só em 2027"));
    expect(r).toEqual({ ok: true, motivoPerda: "Timing: só em 2027" });
  });
});

describe("alertaDaVenda", () => {
  const venda = (tipoTerminal: "GANHO" | "PERDIDO" | null, deletadoEm: Date | null = null) => ({ deletadoEm, fase: { tipoTerminal } });
  it("só avisa enquanto a venda de origem não está em ganho", () => {
    expect(alertaDaVenda(null)).toBeNull();
    expect(alertaDaVenda(venda("GANHO"))).toBeNull();
    expect(alertaDaVenda(venda(null))).toBe("reaberta");
    expect(alertaDaVenda(venda("PERDIDO"))).toBe("perdida");
    expect(alertaDaVenda(venda("GANHO", new Date()))).toBe("removida");
  });
});

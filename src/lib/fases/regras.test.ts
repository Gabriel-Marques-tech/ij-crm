import { describe, expect, it } from "vitest";
import { chaveDeNome, chaveUnica, validarCor, validarRemocao, validarReordenacao, validarTerminais } from "./regras";

describe("chaveDeNome", () => {
  it("vira snake_case ASCII sem acentos", () => {
    expect(chaveDeNome("Reunião Diagnóstica")).toBe("reuniao_diagnostica");
    expect(chaveDeNome("Em negociação")).toBe("em_negociacao");
    expect(chaveDeNome("  Contrato   assinado! ")).toBe("contrato_assinado");
    expect(chaveDeNome("Coleta de dados (2ª rodada)")).toBe("coleta_de_dados_2_rodada");
  });

  it("nome sem nenhum caractere aproveitável cai em 'fase'", () => {
    expect(chaveDeNome("???")).toBe("fase");
    expect(chaveDeNome("")).toBe("fase");
  });
});

describe("chaveUnica", () => {
  it("devolve a própria chave quando livre", () => {
    expect(chaveUnica("perdido", ["ganho"])).toBe("perdido");
  });

  it("acrescenta sufixo numérico crescente quando já existe (inclusive arquivadas)", () => {
    expect(chaveUnica("perdido", ["perdido"])).toBe("perdido_2");
    expect(chaveUnica("perdido", ["perdido", "perdido_2"])).toBe("perdido_3");
  });
});

describe("validarCor", () => {
  it("aceita #rrggbb minúsculo, normaliza caixa, rejeita o resto", () => {
    expect(validarCor("#FF4D3A")).toBe("#ff4d3a");
    expect(validarCor("#abc")).toBeNull();
    expect(validarCor("red")).toBeNull();
    expect(validarCor("ff4d3a")).toBeNull();
  });
});

describe("validarTerminais", () => {
  const ganho = { tipoTerminal: "GANHO" as const };
  const perdido = { tipoTerminal: "PERDIDO" as const };
  const comum = { tipoTerminal: null };

  it("vendas exige ao menos um GANHO e um PERDIDO", () => {
    expect(validarTerminais("vendas", [comum, ganho, perdido])).toBeNull();
    expect(validarTerminais("vendas", [comum, ganho])).toBe("TERMINAL_PERDIDO_OBRIGATORIO");
    expect(validarTerminais("vendas", [comum, perdido])).toBe("TERMINAL_GANHO_OBRIGATORIO");
  });

  it("outros pipelines exigem só um GANHO", () => {
    expect(validarTerminais("projetos", [comum, ganho])).toBeNull();
    expect(validarTerminais("projetos", [comum])).toBe("TERMINAL_GANHO_OBRIGATORIO");
    expect(validarTerminais("projetos", [comum, perdido])).toBe("TERMINAL_GANHO_OBRIGATORIO");
  });
});

describe("validarReordenacao", () => {
  it("aceita só permutações exatas das fases ativas", () => {
    expect(validarReordenacao(["a", "b", "c"], ["c", "a", "b"])).toBe(true);
    expect(validarReordenacao(["a", "b", "c"], ["a", "b"])).toBe(false);
    expect(validarReordenacao(["a", "b", "c"], ["a", "b", "b"])).toBe(false);
    expect(validarReordenacao(["a", "b"], ["a", "b", "x"])).toBe(false);
  });
});

describe("validarRemocao", () => {
  const fase = { id: "f1", pipelineId: "p1" };
  const destino = { id: "f2", pipelineId: "p1", arquivadaEm: null };

  it("sem cards e sem histórico → EXCLUIR", () => {
    expect(validarRemocao({ fase, qtdCards: 0, qtdTransicoes: 0, destino: null })).toEqual({ ok: true, acao: "EXCLUIR" });
  });

  it("sem cards mas com histórico → ARQUIVAR (de_fase_id é RESTRICT)", () => {
    expect(validarRemocao({ fase, qtdCards: 0, qtdTransicoes: 3, destino: null })).toEqual({ ok: true, acao: "ARQUIVAR" });
  });

  it("com cards exige destino; com destino válido migra e arquiva", () => {
    expect(validarRemocao({ fase, qtdCards: 2, qtdTransicoes: 0, destino: null })).toEqual({ ok: false, erro: "DESTINO_OBRIGATORIO" });
    expect(validarRemocao({ fase, qtdCards: 2, qtdTransicoes: 0, destino })).toEqual({ ok: true, acao: "ARQUIVAR" });
  });

  it("destino inválido: a própria fase, outro pipeline ou fase arquivada", () => {
    expect(validarRemocao({ fase, qtdCards: 1, qtdTransicoes: 0, destino: { ...destino, id: "f1" } })).toEqual({ ok: false, erro: "DESTINO_INVALIDO" });
    expect(validarRemocao({ fase, qtdCards: 1, qtdTransicoes: 0, destino: { ...destino, pipelineId: "p2" } })).toEqual({ ok: false, erro: "DESTINO_INVALIDO" });
    expect(validarRemocao({ fase, qtdCards: 1, qtdTransicoes: 0, destino: { ...destino, arquivadaEm: new Date() } })).toEqual({ ok: false, erro: "DESTINO_INVALIDO" });
  });
});

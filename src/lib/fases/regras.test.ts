import { describe, expect, it, vi } from "vitest";
import { chaveDeNome, chaveUnica, destinoCompativel, inserirComChaveUnica, validarCor, validarRemocao, validarReordenacao, validarTerminais } from "./regras";

describe("inserirComChaveUnica", () => {
  const p2002 = Object.assign(new Error("unique"), { code: "P2002", meta: { target: ["pipeline_id", "chave"] } });

  it("usa a chave livre de primeira", async () => {
    const inserir = vi.fn(async (chave: string) => chave);
    expect(await inserirComChaveUnica("perdido", ["ganho"], inserir)).toBe("perdido");
    expect(inserir).toHaveBeenCalledTimes(1);
  });

  it("em P2002 na chave (corrida com escrita externa) tenta UMA vez com sufixo", async () => {
    const inserir = vi.fn(async (chave: string) => {
      if (chave === "perdido") throw p2002;
      return chave;
    });
    expect(await inserirComChaveUnica("perdido", [], inserir)).toBe("perdido_2");
    expect(inserir).toHaveBeenCalledTimes(2);
  });

  it("segunda falha ou erro que não é P2002 de chave propaga", async () => {
    await expect(inserirComChaveUnica("x", [], async () => { throw p2002; })).rejects.toBe(p2002);
    const outro = Object.assign(new Error("fk"), { code: "P2003" });
    await expect(inserirComChaveUnica("x", [], async () => { throw outro; })).rejects.toBe(outro);
  });
});

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
  const fase = { id: "f1", pipelineId: "p1", tipoTerminal: null };
  const destino = { id: "f2", pipelineId: "p1", arquivadaEm: null, tipoTerminal: null };

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

  it("cards soft-deletados não contam como cards nem exigem destino, mas seguram a FK → ARQUIVAR", () => {
    expect(validarRemocao({ fase, qtdCards: 0, qtdTransicoes: 0, qtdCardsDeletados: 1, destino: null })).toEqual({ ok: true, acao: "ARQUIVAR" });
  });

  it("destino inválido: a própria fase, outro pipeline ou fase arquivada", () => {
    expect(validarRemocao({ fase, qtdCards: 1, qtdTransicoes: 0, destino: { ...destino, id: "f1" } })).toEqual({ ok: false, erro: "DESTINO_INVALIDO" });
    expect(validarRemocao({ fase, qtdCards: 1, qtdTransicoes: 0, destino: { ...destino, pipelineId: "p2" } })).toEqual({ ok: false, erro: "DESTINO_INVALIDO" });
    expect(validarRemocao({ fase, qtdCards: 1, qtdTransicoes: 0, destino: { ...destino, arquivadaEm: new Date() } })).toEqual({ ok: false, erro: "DESTINO_INVALIDO" });
  });

  it("cards não atravessam a fronteira aberta ↔ terminal nem trocam ganho ↔ perdido (o gancho de terminal não roda aqui)", () => {
    const ganho = { ...destino, tipoTerminal: "GANHO" as const };
    const perdido = { ...destino, tipoTerminal: "PERDIDO" as const };
    const incompativel = { ok: false, erro: "DESTINO_TERMINAL_INCOMPATIVEL" };
    expect(validarRemocao({ fase, qtdCards: 1, qtdTransicoes: 0, destino: ganho })).toEqual(incompativel);
    expect(validarRemocao({ fase, qtdCards: 1, qtdTransicoes: 0, destino: perdido })).toEqual(incompativel);
    const faseGanho = { ...fase, tipoTerminal: "GANHO" as const };
    expect(validarRemocao({ fase: faseGanho, qtdCards: 1, qtdTransicoes: 0, destino })).toEqual(incompativel);
    expect(validarRemocao({ fase: faseGanho, qtdCards: 1, qtdTransicoes: 0, destino: perdido })).toEqual(incompativel);
    expect(validarRemocao({ fase: faseGanho, qtdCards: 1, qtdTransicoes: 0, destino: ganho })).toEqual({ ok: true, acao: "ARQUIVAR" });
    // Sem cards vivos não há migração: o destino nem importa.
    expect(validarRemocao({ fase: faseGanho, qtdCards: 0, qtdTransicoes: 0, destino: null })).toEqual({ ok: true, acao: "EXCLUIR" });
  });
});

describe("destinoCompativel", () => {
  it("mesmo tipo terminal (ou ambos abertos)", () => {
    expect(destinoCompativel({ tipoTerminal: null }, { tipoTerminal: null })).toBe(true);
    expect(destinoCompativel({ tipoTerminal: "GANHO" }, { tipoTerminal: "GANHO" })).toBe(true);
    expect(destinoCompativel({ tipoTerminal: "PERDIDO" }, { tipoTerminal: "PERDIDO" })).toBe(true);
    expect(destinoCompativel({ tipoTerminal: null }, { tipoTerminal: "GANHO" })).toBe(false);
    expect(destinoCompativel({ tipoTerminal: "PERDIDO" }, { tipoTerminal: null })).toBe(false);
    expect(destinoCompativel({ tipoTerminal: "GANHO" }, { tipoTerminal: "PERDIDO" })).toBe(false);
  });
});

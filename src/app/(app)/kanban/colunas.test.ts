import { describe, expect, it } from "vitest";
import { colunasAbertas, proximoAlvo } from "./colunas";

const fases = [
  { id: "a", isTerminal: false },
  { id: "vazia", isTerminal: false },
  { id: "vazia2", isTerminal: false },
  { id: "ganho", isTerminal: true },
];
const contagem = new Map([
  ["a", 3],
  ["ganho", 2],
]);
const abertas = (abertasManual: string[] = [], alvoArrasto: string | null = null, mostrarVazias = false) =>
  [...colunasAbertas({ fases, contagem, abertasManual: new Set(abertasManual), alvoArrasto, mostrarVazias })].sort();

describe("colunasAbertas", () => {
  it("sem arrasto: abre só coluna não terminal com card", () => {
    expect(abertas()).toEqual(["a"]);
  });

  it("aberta à mão fica aberta (vazia ou terminal)", () => {
    expect(abertas(["vazia", "ganho"])).toEqual(["a", "ganho", "vazia"]);
  });

  it("durante arrasto só a recolhida sob o card abre; as outras seguem faixa", () => {
    expect(abertas([], "vazia")).toEqual(["a", "vazia"]);
  });

  it("terminal segue a mesma regra", () => {
    expect(abertas([], "ganho")).toEqual(["a", "ganho"]);
  });

  it("alvo numa coluna já aberta não muda nada", () => {
    expect(abertas([], "a")).toEqual(["a"]);
  });

  it("mostrar vazias: abre as não terminais vazias; terminal segue recolhida", () => {
    expect(abertas([], null, true)).toEqual(["a", "vazia", "vazia2"]);
    expect(abertas(["ganho"], null, true)).toEqual(["a", "ganho", "vazia", "vazia2"]);
  });

  it("alvo desconhecido é ignorado", () => {
    expect(abertas([], "??")).toEqual(["a"]);
  });
});

describe("proximoAlvo (anti-flicker)", () => {
  it("sem coluna sob o card mantém a última", () => {
    expect(proximoAlvo("vazia", null)).toBe("vazia");
  });
  it("outra coluna sob o card troca", () => {
    expect(proximoAlvo("vazia", "vazia2")).toBe("vazia2");
  });
  it("primeiro alvo", () => {
    expect(proximoAlvo(null, "a")).toBe("a");
  });
});

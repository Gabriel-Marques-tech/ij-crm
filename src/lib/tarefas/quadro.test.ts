import { describe, expect, it } from "vitest";
import { agrupar, agruparPorResponsavel, posicaoAoSoltar, posicaoEntre, SEM_RESPONSAVEL } from "./quadro";
import { ROTULO_STATUS } from "./quadro";
import { ROTULO_PRIORIDADE } from "./modelo";

const pessoas = [
  { id: "p", nome: "Paula", fotoEm: null, ativo: true },
  { id: "e", nome: "Eduardo", fotoEm: null, ativo: true },
  { id: "x", nome: "Xavier", fotoEm: null, ativo: false },
  { id: "z", nome: "Zé sem tarefa", fotoEm: null, ativo: true },
];

describe("agruparPorResponsavel", () => {
  it("uma linha por pessoa com tarefa, em ordem de nome; 'Sem responsável' por último; pessoa sem tarefa não ganha linha", () => {
    const linhas = agruparPorResponsavel(
      [
        { id: "1", responsavelId: "p" },
        { id: "2", responsavelId: null },
        { id: "3", responsavelId: "e" },
        { id: "4", responsavelId: "p" },
        { id: "5", responsavelId: "x" },
      ],
      pessoas,
    );
    expect(linhas.map((l) => [l.chave, l.nome, l.tarefas.map((t) => t.id)])).toEqual([
      ["e", "Eduardo", ["3"]],
      ["p", "Paula", ["1", "4"]],
      ["x", "Xavier (inativo)", ["5"]],
      [SEM_RESPONSAVEL, "Sem responsável", ["2"]],
    ]);
  });

  it("sem tarefa sem dono, não há linha 'Sem responsável'; responsável fora da lista ainda aparece", () => {
    expect(agruparPorResponsavel([{ responsavelId: "p" }], pessoas).map((l) => l.chave)).toEqual(["p"]);
    expect(agruparPorResponsavel([{ responsavelId: "fantasma" }], pessoas).map((l) => l.nome)).toEqual(["Pessoa removida"]);
  });
});

describe("posicaoEntre", () => {
  it("fica no meio dos vizinhos; no fim, +1; no início, −1; coluna vazia, 1", () => {
    expect(posicaoEntre(1, 2)).toBe(1.5);
    expect(posicaoEntre(3, null)).toBe(4);
    expect(posicaoEntre(null, 1)).toBe(0);
    expect(posicaoEntre(null, null)).toBe(1);
  });
});

describe("agrupar", () => {
  const xs = [
    { id: "1", responsavelId: "p", status: "A_FAZER" as const, prioridade: "ALTA" as const, etiquetas: ["backend", "infra"] },
    { id: "2", responsavelId: null, status: "FEITA" as const, prioridade: "SEM_PRIORIDADE" as const, etiquetas: [] },
  ];
  it("por status e prioridade lista todos os valores (vazios inclusive); por etiqueta usa a primeira; nenhum é um grupo só", () => {
    const porStatus = agrupar(xs, pessoas, "status", ROTULO_STATUS, ROTULO_PRIORIDADE);
    expect(porStatus.map((l) => [l.nome, l.tarefas.length])).toEqual([["Backlog", 0], ["A fazer", 1], ["Em andamento", 0], ["Em revisão", 0], ["Feita", 1], ["Cancelada", 0]]);
    expect(agrupar(xs, pessoas, "prio", ROTULO_STATUS, ROTULO_PRIORIDADE).map((l) => l.nome)).toEqual(["Urgente", "Alta", "Média", "Baixa", "Sem prioridade"]);
    expect(agrupar(xs, pessoas, "etiqueta", ROTULO_STATUS, ROTULO_PRIORIDADE).map((l) => [l.chave, l.tarefas.map((t) => t.id)])).toEqual([["backend", ["1"]], ["none", ["2"]]]);
    expect(agrupar(xs, pessoas, "nenhum", ROTULO_STATUS, ROTULO_PRIORIDADE)).toHaveLength(1);
    expect(agrupar(xs, pessoas, "resp", ROTULO_STATUS, ROTULO_PRIORIDADE).map((l) => l.chave)).toEqual(["p", SEM_RESPONSAVEL]);
  });
});

describe("posicaoAoSoltar", () => {
  const col = [
    { id: "a", posicao: 1 },
    { id: "b", posicao: 2 },
    { id: "c", posicao: 3 },
  ];
  const manual = { manual: true, mesmaColuna: true };
  it("ordem manual: antes do alvo, entre os vizinhos; no topo; sem alvo, no fim; coluna vazia, 1", () => {
    expect(posicaoAoSoltar(col, "b", manual)).toBe(1.5);
    expect(posicaoAoSoltar(col, "a", manual)).toBe(0);
    expect(posicaoAoSoltar(col, null, manual)).toBe(4);
    expect(posicaoAoSoltar([], null, manual)).toBe(1);
  });
  it("ordenado por outro critério (ou decrescente): mesma coluna não mexe; outra coluna vai para o fim pela maior posição", () => {
    const porPrazo = [col[2], col[0], col[1]]; // exibida fora da ordem manual
    expect(posicaoAoSoltar(porPrazo, "a", { manual: false, mesmaColuna: true })).toBeNull();
    expect(posicaoAoSoltar(porPrazo, "a", { manual: false, mesmaColuna: false })).toBe(4);
    expect(posicaoAoSoltar([], "a", { manual: false, mesmaColuna: false })).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import { EXIBICAO_PADRAO, aplicarExibicao, lerExibicao, ordenador } from "./exibicao";
import type { TarefaLista } from "./modelo";

const AGORA = Date.UTC(2026, 10, 4, 15);
const DIA = 864e5;
const t = (n: number, extra: Partial<TarefaLista> = {}): TarefaLista => ({
  id: String(n), numero: n, titulo: `T${n}`, descricao: null, status: "A_FAZER", prioridade: "SEM_PRIORIDADE", posicao: n,
  responsavelId: null, prazo: null, etiquetas: [], paiId: null, concluidaEmMs: null, criadoEmMs: n, ...extra,
});

describe("lerExibicao", () => {
  it("válido → igual; inválido ou parcial → padrão inteiro", () => {
    const e = { ...EXIBICAO_PADRAO, vista: "lista" as const, dens: "compacta" as const };
    expect(lerExibicao(e)).toEqual(e);
    expect(lerExibicao({ vista: "lista" })).toEqual(EXIBICAO_PADRAO);
    expect(lerExibicao(null)).toEqual(EXIBICAO_PADRAO);
    expect(lerExibicao({ ...EXIBICAO_PADRAO, agrupar: "cor" })).toEqual(EXIBICAO_PADRAO);
  });
});

describe("ordenador", () => {
  const xs = [t(1, { prazo: "2026-11-10", prioridade: "BAIXA" }), t(2, { prazo: null, prioridade: "URGENTE" }), t(3, { prazo: "2026-11-05", prioridade: "ALTA" })];
  it("prazo: sem prazo por último; prioridade: urgente primeiro; decrescente inverte; empate pela posição", () => {
    expect(xs.slice().sort(ordenador({ ordenar: "prazo", ordemDesc: false })).map((x) => x.numero)).toEqual([3, 1, 2]);
    expect(xs.slice().sort(ordenador({ ordenar: "prioridade", ordemDesc: false })).map((x) => x.numero)).toEqual([2, 3, 1]);
    expect(xs.slice().sort(ordenador({ ordenar: "prioridade", ordemDesc: true })).map((x) => x.numero)).toEqual([1, 3, 2]);
    expect([t(2, { posicao: 5 }), t(1, { posicao: 2 })].sort(ordenador({ ordenar: "status", ordemDesc: false })).map((x) => x.numero)).toEqual([1, 2]);
  });
  it("responsável: pelo nome, sem responsável por último", () => {
    const nomes = new Map([["p", "Paula"], ["e", "Eduardo"]]);
    const ys = [t(1, { responsavelId: "p" }), t(2, { responsavelId: null }), t(3, { responsavelId: "e" })];
    expect(ys.slice().sort(ordenador({ ordenar: "responsavel", ordemDesc: false }, (id) => nomes.get(id) ?? id)).map((x) => x.numero)).toEqual([3, 1, 2]);
  });
});

describe("aplicarExibicao", () => {
  const xs = [
    t(1, { status: "FEITA", concluidaEmMs: AGORA - 2 * DIA }),
    t(2, { status: "CANCELADA", concluidaEmMs: AGORA - 20 * DIA }),
    t(3, { status: "FEITA", concluidaEmMs: AGORA - 40 * DIA }),
    t(4),
    t(5, { paiId: "4" }),
  ];
  it("concluídas por período: semana, mês, nenhuma", () => {
    const n = (c: "todas" | "semana" | "mes" | "nenhuma") => aplicarExibicao(xs, { concluidas: c, subtarefas: "todas", vista: "quadro" }, AGORA).map((x) => x.numero);
    expect(n("todas")).toEqual([1, 2, 3, 4, 5]);
    expect(n("semana")).toEqual([1, 4, 5]);
    expect(n("mes")).toEqual([1, 2, 4, 5]);
    expect(n("nenhuma")).toEqual([4, 5]);
  });
  it("subtarefas: em todo lugar, só na lista, ou nunca", () => {
    const n = (s: "todas" | "lista" | "nenhuma", vista: "quadro" | "lista") => aplicarExibicao(xs, { concluidas: "nenhuma", subtarefas: s, vista }, AGORA).map((x) => x.numero);
    expect(n("lista", "quadro")).toEqual([4]);
    expect(n("lista", "lista")).toEqual([4, 5]);
    expect(n("nenhuma", "lista")).toEqual([4]);
  });
});

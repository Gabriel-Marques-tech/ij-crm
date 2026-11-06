import { describe, expect, it } from "vitest";
import type { TarefaLista } from "./modelo";
import { FILTROS_VAZIOS, contarAtivos, escreverFiltros, filtrarTarefas, lerFiltros } from "./filtros";

const HOJE = "2026-11-04";
const t = (n: number, extra: Partial<TarefaLista> = {}): TarefaLista => ({
  id: String(n), numero: n, titulo: `Tarefa ${n}`, descricao: null, status: "A_FAZER", prioridade: "SEM_PRIORIDADE", posicao: n,
  responsavelId: null, prazo: null, etiquetas: [], paiId: null, concluidaEmMs: null, criadoEmMs: 0, ...extra,
});
const T = [
  t(1, { responsavelId: "p", status: "EM_ANDAMENTO", prioridade: "ALTA", etiquetas: ["backend"], prazo: "2026-11-03" }),
  t(2, { responsavelId: "e", prioridade: "URGENTE", etiquetas: ["frontend", "design"], prazo: "2026-11-04" }),
  t(3, { responsavelId: null, prazo: "2026-11-09" }),
  t(4, { responsavelId: "p", status: "FEITA", prazo: "2026-11-20" }),
];
const ids = (xs: TarefaLista[]) => xs.map((x) => x.numero);

describe("lerFiltros / escreverFiltros", () => {
  it("lê listas por vírgula, descarta valores fora do enum e marca 'não é' pelo prefixo n", () => {
    const f = lerFiltros(new URLSearchParams("resp=p,e&status=FEITA,INVENTADO&nprio=URGENTE&q=%20cpf%20"));
    expect(f).toEqual({ ...FILTROS_VAZIOS, resp: ["p", "e"], status: ["FEITA"], prio: ["URGENTE"], nao: ["prio"], q: "cpf" });
    expect(contarAtivos(f)).toBe(4);
  });

  it("escreve só o que está ativo, com n na frente para 'não é', e preserva outros parâmetros", () => {
    const p = escreverFiltros({ ...FILTROS_VAZIOS, resp: ["p"], etiqueta: ["backend"], nao: ["etiqueta"], q: "x" }, new URLSearchParams("vista=lista&resp=antigo&netiqueta=y"));
    expect(p.toString()).toBe("vista=lista&resp=p&netiqueta=backend&q=x");
    expect(lerFiltros(p)).toMatchObject({ resp: ["p"], etiqueta: ["backend"], nao: ["etiqueta"], q: "x" });
  });
});

describe("filtrarTarefas", () => {
  it("OU dentro da dimensão, E entre dimensões; 'none' é sem responsável", () => {
    expect(ids(filtrarTarefas(T, { ...FILTROS_VAZIOS, resp: ["p", "none"] }, HOJE))).toEqual([1, 3, 4]);
    expect(ids(filtrarTarefas(T, { ...FILTROS_VAZIOS, resp: ["p"], status: ["FEITA"] }, HOJE))).toEqual([4]);
  });

  it("'não é' inverte a dimensão", () => {
    expect(ids(filtrarTarefas(T, { ...FILTROS_VAZIOS, prio: ["SEM_PRIORIDADE"], nao: ["prio"] }, HOJE))).toEqual([1, 2]);
    expect(ids(filtrarTarefas(T, { ...FILTROS_VAZIOS, etiqueta: ["backend"], nao: ["etiqueta"] }, HOJE))).toEqual([2, 3, 4]);
  });

  it("prazo: atrasado, hoje, próximos 7 dias (inclui hoje), sem prazo", () => {
    expect(ids(filtrarTarefas(T, { ...FILTROS_VAZIOS, prazo: ["atrasado"] }, HOJE))).toEqual([1]);
    expect(ids(filtrarTarefas(T, { ...FILTROS_VAZIOS, prazo: ["hoje"] }, HOJE))).toEqual([2]);
    expect(ids(filtrarTarefas(T, { ...FILTROS_VAZIOS, prazo: ["semana"] }, HOJE))).toEqual([2, 3]);
    expect(ids(filtrarTarefas([...T, t(5)], { ...FILTROS_VAZIOS, prazo: ["sem"] }, HOJE))).toEqual([5]);
  });

  it("busca por trecho do título ou pelo #número exato", () => {
    expect(ids(filtrarTarefas(T, { ...FILTROS_VAZIOS, q: "tarefa 2" }, HOJE))).toEqual([2]);
    expect(ids(filtrarTarefas(T, { ...FILTROS_VAZIOS, q: "#3" }, HOJE))).toEqual([3]);
  });
});

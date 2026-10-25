import { describe, expect, it } from "vitest";
import { FILTROS_VAZIOS, contarAtivos, escreverFiltros, filtrarCards, lerFiltros, type Filtros } from "./filtros";
import type { CardCliente, FaseCliente } from "./tipos";

const DIA = 24 * 60 * 60 * 1000;
// 2026-10-24 15:00 UTC = 12:00 em São Paulo.
const AGORA = Date.UTC(2026, 9, 24, 15, 0, 0);
// Meio-dia em São Paulo, N dias a partir de hoje.
const diaSP = (n: number) => AGORA + n * DIA;

const fase = (id: string, limite: number | null): FaseCliente => ({
  id,
  nome: id,
  cor: null,
  limiteDiasAlerta: limite,
  isTerminal: false,
  tipoTerminal: null,
});
const FASES = [fase("A", 10), fase("SEMLIMITE", null)];

const card = (id: string, extra: Partial<CardCliente> = {}): CardCliente => ({
  id,
  titulo: id,
  faseId: "A",
  faseDesdeMs: AGORA,
  revisar: false,
  proximaAcao: null,
  proximaAcaoEmMs: null,
  responsavelId: "u1",
  responsavelNome: "Ana",
  empresaNome: null,
  origem: null,
  estado: null,
  ...extra,
});

const f = (parcial: Partial<Filtros>): Filtros => ({ ...FILTROS_VAZIOS, ...parcial });
const ids = (cs: CardCliente[]) => cs.map((c) => c.id);
const filtrar = (cs: CardCliente[], filtros: Filtros) => filtrarCards(cs, filtros, { fases: FASES, agoraMs: AGORA });

describe("filtrarCards", () => {
  const cards = [
    card("ana", { responsavelId: "u1" }),
    card("bia", { responsavelId: "u2" }),
    card("caio", { responsavelId: "u3" }),
  ];

  it("sem filtros → todos, na mesma ordem", () => {
    expect(ids(filtrar(cards, FILTROS_VAZIOS))).toEqual(["ana", "bia", "caio"]);
  });

  it("responsável: qualquer um dos escolhidos (OU dentro do grupo)", () => {
    expect(ids(filtrar(cards, f({ resp: ["u1", "u3"] })))).toEqual(["ana", "caio"]);
  });

  it("grupos diferentes combinam com E", () => {
    const cs = [card("x", { responsavelId: "u1", revisar: true }), card("y", { responsavelId: "u1" }), card("z", { responsavelId: "u2", revisar: true })];
    expect(ids(filtrar(cs, f({ resp: ["u1"], revisar: "sim" })))).toEqual(["x"]);
  });

  it("busca: título ou empresa, sem diferenciar caixa nem acento", () => {
    const cs = [card("1", { titulo: "Padaria São João" }), card("2", { titulo: "Contato", empresaNome: "JOAO Distribuidora" }), card("3", { titulo: "Outro" })];
    expect(ids(filtrar(cs, f({ q: "joão" })))).toEqual(["1", "2"]);
    expect(ids(filtrar(cs, f({ q: "  sao jo " })))).toEqual(["1"]);
  });

  it("revisar sim / não", () => {
    const cs = [card("r", { revisar: true }), card("n")];
    expect(ids(filtrar(cs, f({ revisar: "sim" })))).toEqual(["r"]);
    expect(ids(filtrar(cs, f({ revisar: "nao" })))).toEqual(["n"]);
  });

  it("próxima ação: vencida, hoje, próximos 7 dias (sem hoje) e sem próxima ação", () => {
    const cs = [
      card("ontem", { proximaAcaoEmMs: diaSP(-1) }),
      card("hoje", { proximaAcaoEmMs: diaSP(0) }),
      card("d7", { proximaAcaoEmMs: diaSP(7) }),
      card("d8", { proximaAcaoEmMs: diaSP(8) }),
      card("nada"),
    ];
    expect(ids(filtrar(cs, f({ acao: ["vencida"] })))).toEqual(["ontem"]);
    expect(ids(filtrar(cs, f({ acao: ["hoje"] })))).toEqual(["hoje"]);
    expect(ids(filtrar(cs, f({ acao: ["semana"] })))).toEqual(["d7"]);
    expect(ids(filtrar(cs, f({ acao: ["sem"] })))).toEqual(["nada"]);
    expect(ids(filtrar(cs, f({ acao: ["vencida", "hoje"] })))).toEqual(["ontem", "hoje"]);
  });

  it("aging: pela regra da fase (limite 10: verde < 7, âmbar 7–9, vermelho ≥ 10; sem limite → neutro)", () => {
    const cs = [
      card("verde", { faseDesdeMs: AGORA - 2 * DIA }),
      card("ambar", { faseDesdeMs: AGORA - 8 * DIA }),
      card("vermelho", { faseDesdeMs: AGORA - 12 * DIA }),
      card("neutro", { faseId: "SEMLIMITE", faseDesdeMs: AGORA - 50 * DIA }),
    ];
    expect(ids(filtrar(cs, f({ aging: ["vermelho"] })))).toEqual(["vermelho"]);
    expect(ids(filtrar(cs, f({ aging: ["verde", "ambar"] })))).toEqual(["verde", "ambar"]);
    expect(ids(filtrar(cs, f({ aging: ["neutro"] })))).toEqual(["neutro"]);
  });

  it("origem, inclusive sem origem", () => {
    const cs = [card("rd", { origem: "RD" }), card("ev", { origem: "EVENTO" }), card("sem")];
    expect(ids(filtrar(cs, f({ origem: ["RD", "SEM"] })))).toEqual(["rd", "sem"]);
  });

  it("UF", () => {
    const cs = [card("sp", { estado: "SP" }), card("rj", { estado: "RJ" }), card("sem")];
    expect(ids(filtrar(cs, f({ uf: ["RJ"] })))).toEqual(["rj"]);
  });

  it("card em fase desconhecida não quebra aging (tratado como neutro)", () => {
    expect(ids(filtrar([card("x", { faseId: "??" })], f({ aging: ["neutro"] })))).toEqual(["x"]);
  });

  it("sempreVisiveis passa mesmo sem bater no filtro", () => {
    const cs = [card("a", { revisar: true }), card("b")];
    expect(ids(filtrarCards(cs, f({ revisar: "sim" }), { fases: FASES, agoraMs: AGORA, sempreVisiveis: new Set(["b"]) }))).toEqual(["a", "b"]);
  });
});

describe("lerFiltros / escreverFiltros", () => {
  it("lê os parâmetros, ignorando valores inválidos e repetidos", () => {
    const p = new URLSearchParams(
      "quadro=vendas&resp=u1,u2,u1&q=%20padaria%20&revisar=sim&acao=hoje,xpto,vencida&aging=vermelho,roxo&origem=RD,SEM,toString&uf=sp,RJ,ZZ",
    );
    expect(lerFiltros(p)).toEqual({
      resp: ["u1", "u2"],
      q: "padaria",
      revisar: "sim",
      acao: ["hoje", "vencida"],
      aging: ["vermelho"],
      origem: ["RD", "SEM"],
      uf: ["SP", "RJ"],
    });
  });

  it("parâmetros ausentes ou vazios → filtros vazios", () => {
    expect(lerFiltros(new URLSearchParams("quadro=vendas&resp=&revisar=talvez"))).toEqual(FILTROS_VAZIOS);
  });

  it("escrever preserva outros parâmetros e remove os vazios", () => {
    const base = new URLSearchParams("quadro=vendas&q=velho&uf=SP");
    const r = escreverFiltros(f({ resp: ["u1", "u2"], revisar: "nao", acao: ["sem"] }), base);
    expect(r.toString()).toBe("quadro=vendas&resp=u1%2Cu2&revisar=nao&acao=sem");
    expect(base.toString()).toBe("quadro=vendas&q=velho&uf=SP");
  });

  it("ida e volta mantém os filtros", () => {
    const filtros = f({ resp: ["u1"], q: "são joão", revisar: "sim", acao: ["semana"], aging: ["ambar", "neutro"], origem: ["INDICACAO"], uf: ["MG"] });
    expect(lerFiltros(escreverFiltros(filtros, new URLSearchParams()))).toEqual(filtros);
  });

  it("busca é limitada a 100 caracteres", () => {
    expect(lerFiltros(new URLSearchParams({ q: "x".repeat(300) })).q).toHaveLength(100);
  });
});

describe("contarAtivos", () => {
  it("conta cada valor escolhido (um por chip)", () => {
    expect(contarAtivos(FILTROS_VAZIOS)).toBe(0);
    expect(contarAtivos(f({ resp: ["u1", "u2"], q: "x", revisar: "sim", acao: ["hoje"], aging: [], origem: ["RD"], uf: ["SP", "RJ"] }))).toBe(8);
  });
});

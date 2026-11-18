import { describe, expect, it } from "vitest";
import type { BaseOrg } from "./organizacao";
import { destinoAntigo, filtrarMembros, hrefMembros, lerVisao, podeCadastrarPessoa, veFichaCompleta } from "./membros";

const HOJE = "2026-11-18";
const base: BaseOrg = {
  hoje: HOJE,
  areas: [
    { id: "gg", nome: "Gente & Gestão", tipo: "AREA", superiorId: null, ladoCrm: null, ehGG: true },
    { id: "rh", nome: "RH", tipo: "FRENTE", superiorId: "gg", ladoCrm: null, ehGG: false },
    { id: "proj", nome: "Projetos", tipo: "AREA", superiorId: null, ladoCrm: "PROJETOS", ehGG: false },
  ],
  cargos: [
    { id: "dir", nome: "Diretor", categoria: "DIRETORIA", ehGp: false },
    { id: "ana", nome: "Analista", categoria: "MEMBRO", ehGp: false },
  ],
  posicoes: [
    { id: "p_dgg", nome: "Diretoria de G&G", areaId: "gg", cargoId: "dir", liderancaId: null },
    { id: "p_arh", nome: "Analista de RH", areaId: "rh", cargoId: "ana", liderancaId: "p_dgg" },
    { id: "p_aproj", nome: "Analista de Projetos", areaId: "proj", cargoId: "ana", liderancaId: null },
  ],
  ocupacoes: [
    { id: "o1", membroId: "m_ana", posicaoId: "p_arh", inicio: "2026-01-01", fim: null, principal: true, invalidadoEm: null, motivoInvalidacao: null },
    { id: "o2", membroId: "m_bia", posicaoId: "p_dgg", inicio: "2026-01-01", fim: null, principal: true, invalidadoEm: null, motivoInvalidacao: null },
    // Encerrada: não conta para o filtro de cargo/área.
    { id: "o3", membroId: "m_caio", posicaoId: "p_aproj", inicio: "2025-01-01", fim: "2025-12-01", principal: true, invalidadoEm: null, motivoInvalidacao: null },
  ],
  membros: [
    { id: "m_ana", nome: "Ana Souza", email: "ana.secreta@ij.test", status: "ATIVO", usuarioId: "u_ana" },
    { id: "m_bia", nome: "Bia Lima", email: null, status: "AFASTADO", usuarioId: null },
    { id: "m_caio", nome: "Caio Melo", email: "caio@ij.test", status: "INATIVO", usuarioId: null },
  ],
  vinculos: [],
};
const nomes = (ms: { nome: string }[]) => ms.map((m) => m.nome);

describe("lerVisao", () => {
  it("organograma por padrão; lista só pelo valor exato", () => {
    expect(lerVisao(undefined)).toBe("organograma");
    expect(lerVisao("lista")).toBe("lista");
    expect(lerVisao("LISTA")).toBe("organograma");
    expect(lerVisao("constructor")).toBe("organograma");
  });
});

describe("filtrarMembros", () => {
  it("sem filtro: todos", () => {
    expect(nomes(filtrarMembros(base, {}, { buscaEmail: false }))).toEqual(["Ana Souza", "Bia Lima", "Caio Melo"]);
  });

  it("área inclui as frentes abaixo dela; só posições vigentes", () => {
    expect(nomes(filtrarMembros(base, { area: "gg" }, { buscaEmail: false }))).toEqual(["Ana Souza", "Bia Lima"]);
    expect(nomes(filtrarMembros(base, { area: "rh" }, { buscaEmail: false }))).toEqual(["Ana Souza"]);
    expect(nomes(filtrarMembros(base, { area: "proj" }, { buscaEmail: false }))).toEqual([]);
  });

  it("cargo e status; combinam com a área", () => {
    expect(nomes(filtrarMembros(base, { cargo: "ana" }, { buscaEmail: false }))).toEqual(["Ana Souza"]);
    expect(nomes(filtrarMembros(base, { cargo: "dir", area: "rh" }, { buscaEmail: false }))).toEqual([]);
    expect(nomes(filtrarMembros(base, { status: "AFASTADO" }, { buscaEmail: false }))).toEqual(["Bia Lima"]);
  });

  it("busca por nome sem acento nem caixa", () => {
    expect(nomes(filtrarMembros(base, { q: "  souza " }, { buscaEmail: false }))).toEqual(["Ana Souza"]);
    expect(nomes(filtrarMembros(base, { q: "CAIO" }, { buscaEmail: false }))).toEqual(["Caio Melo"]);
  });

  it("e-mail só entra na busca de quem vê o e-mail (não vaza por tentativa)", () => {
    expect(nomes(filtrarMembros(base, { q: "secreta" }, { buscaEmail: false }))).toEqual([]);
    expect(nomes(filtrarMembros(base, { q: "secreta" }, { buscaEmail: true }))).toEqual(["Ana Souza"]);
  });
});

describe("acesso", () => {
  const membro = { usuarioId: "u_ana" };
  it("ficha completa: editor de G&G, gestor/admin e a própria pessoa", () => {
    expect(veFichaCompleta({ id: "x", papel: "VENDEDOR" }, membro, true)).toBe(true);
    expect(veFichaCompleta({ id: "x", papel: "GESTOR" }, membro, false)).toBe(true);
    expect(veFichaCompleta({ id: "x", papel: "ADMIN" }, membro, false)).toBe(true);
    expect(veFichaCompleta({ id: "u_ana", papel: "VISUALIZADOR" }, membro, false)).toBe(true);
  });
  it("os demais (membro, visualizador) veem só nome, área, cargo e status", () => {
    for (const papel of ["VENDEDOR", "PROJETOS", "VISUALIZADOR"] as const) expect(veFichaCompleta({ id: "x", papel }, membro, false)).toBe(false);
    expect(veFichaCompleta({ id: "x", papel: "VENDEDOR" }, { usuarioId: null }, false)).toBe(false);
  });
  it("cadastrar pessoa com conta: a régua da Gestão (gestor e admin)", () => {
    expect(podeCadastrarPessoa("ADMIN")).toBe(true);
    expect(podeCadastrarPessoa("GESTOR")).toBe(true);
    for (const papel of ["VENDEDOR", "PROJETOS", "VISUALIZADOR"] as const) expect(podeCadastrarPessoa(papel)).toBe(false);
  });
});

describe("URLs", () => {
  it("hrefMembros guarda a visão e os filtros, sem os vazios", () => {
    expect(hrefMembros({ visao: "lista", q: "ana", area: "", status: undefined })).toBe("/membros?visao=lista&q=ana");
    expect(hrefMembros({ visao: "organograma", cadastrar: "p1" })).toBe("/membros?visao=organograma&cadastrar=p1");
    // `fechado=` vazio = nenhum galho recolhido (sem ele, o padrão recolhe G&G).
    expect(hrefMembros({ visao: "organograma", fechado: "", cadastrar: "p1" })).toBe("/membros?visao=organograma&fechado=&cadastrar=p1");
  });

  it("rotas antigas do G&G levam à nova com os parâmetros que ainda valem", () => {
    expect(destinoAntigo("lista", { q: "ana", area: "gg", status: "ATIVO", outro: "x" })).toBe("/membros?visao=lista&q=ana&area=gg&status=ATIVO");
    expect(destinoAntigo("organograma", { escopo: "gg", fechado: "a,b" })).toBe("/membros?visao=organograma&escopo=gg&fechado=a%2Cb");
    expect(destinoAntigo("organograma", {})).toBe("/membros?visao=organograma");
  });
});

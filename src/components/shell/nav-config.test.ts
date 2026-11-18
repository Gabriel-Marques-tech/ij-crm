import { describe, expect, it } from "vitest";
import { areaDaRota, ehRotaGG, HREF_GG, isActive, itemAtivo, itensDaGaveta, itensDoMenu, ITENS_GG } from "./nav-config";

const pessoa = (papel: "ADMIN" | "GESTOR" | "VENDEDOR" | "PROJETOS" | "VISUALIZADOR", area: "VENDAS" | "PROJETOS" | null = null) => ({ papel, area, cargos: [], areaEntrada: null });
const ADMIN = pessoa("ADMIN");
const VENDEDOR = pessoa("VENDEDOR", "VENDAS");
const MEMBRO_PROJETOS = pessoa("PROJETOS", "PROJETOS");

const rotulos = (itens: { label: string }[]) => itens.map((i) => i.label);

describe("itensDoMenu", () => {
  it("Vendas, na ordem da spec, com o compartilhado no fim", () => {
    expect(rotulos(itensDoMenu(ADMIN, "VENDAS"))).toEqual(["Minha Semana", "Kanban de vendas", "Propostas", "Tabela", "Ranking", "Contatos", "Empresas", "Calendário"]);
  });

  it("Projetos: Propostas entra; Tabela e Ranking não", () => {
    expect(rotulos(itensDoMenu(ADMIN, "PROJETOS"))).toEqual(["Minha Semana", "Kanban de projetos", "Propostas", "Contatos", "Empresas", "Calendário"]);
  });

  it("visitante não vê Minha Semana, Tabela e Ranking", () => {
    expect(rotulos(itensDoMenu(MEMBRO_PROJETOS, "VENDAS"))).toEqual(["Kanban de vendas", "Propostas", "Contatos", "Empresas", "Calendário"]);
  });

  it("o Kanban de cada área leva ao quadro dela", () => {
    expect(itensDoMenu(ADMIN, "VENDAS").find((i) => i.quadro)?.href).toBe("/kanban");
    expect(itensDoMenu(ADMIN, "PROJETOS").find((i) => i.quadro)?.href).toBe("/kanban?quadro=projetos");
  });

  it("nunca repete href", () => {
    const hrefs = itensDoMenu(ADMIN, "VENDAS").map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("itensDaGaveta", () => {
  it("Gestão só para gestor e admin; Membros para todos (GAB-106)", () => {
    expect(rotulos(itensDaGaveta(VENDEDOR))).toEqual(["Painel", "Membros", "Meu perfil"]);
    expect(rotulos(itensDaGaveta(pessoa("GESTOR", "VENDAS")))).toEqual(["Painel", "Membros", "Gestão", "Meu perfil"]);
    expect(rotulos(itensDaGaveta(ADMIN))).toEqual(["Painel", "Membros", "Gestão", "Meu perfil"]);
    expect(itensDaGaveta(VENDEDOR).find((i) => i.label === "Membros")?.href).toBe("/membros");
  });

  it("Gente & Gestão fica só com o que é dela; Membros, organograma e estrutura saíram (GAB-106)", () => {
    const hrefs = ITENS_GG.map((i) => i.href);
    expect(hrefs).not.toContain("/gg/membros");
    expect(hrefs).not.toContain("/gg/organograma");
    expect(hrefs).not.toContain("/gg/estrutura");
    expect(hrefs).toContain(HREF_GG);
    expect(ehRotaGG("/membros")).toBe(false);
  });
});

describe("areaDaRota", () => {
  it("/kanban pelo quadro; sem quadro é Vendas; quadro desconhecido não define", () => {
    expect(areaDaRota("/kanban", null, VENDEDOR)).toBe("VENDAS");
    expect(areaDaRota("/kanban", "projetos", VENDEDOR)).toBe("PROJETOS");
    expect(areaDaRota("/kanban", "nada", VENDEDOR)).toBeNull();
  });

  it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])("?quadro=%s não acha membro herdado do protótipo", (quadro) => {
    expect(areaDaRota("/kanban", quadro, VENDEDOR)).toBeNull();
    expect(areaDaRota("/projetos/abc", quadro, VENDEDOR)).toBeNull();
  });

  it("/projetos/[id] pelo quadro do card, inclusive nas páginas da proposta; antes de declarar, não define", () => {
    expect(areaDaRota("/projetos/abc", "projetos", VENDEDOR)).toBe("PROJETOS");
    expect(areaDaRota("/projetos/abc/proposta", "vendas", MEMBRO_PROJETOS)).toBe("VENDAS");
    expect(areaDaRota("/projetos/abc", null, VENDEDOR)).toBeNull();
  });

  it("Tabela e Ranking são de Vendas", () => {
    expect(areaDaRota("/tabela", null, ADMIN)).toBe("VENDAS");
    expect(areaDaRota("/ranking", null, ADMIN)).toBe("VENDAS");
  });

  it("Minha Semana é da área da pessoa; de quem é das duas, não define", () => {
    expect(areaDaRota("/semana", null, VENDEDOR)).toBe("VENDAS");
    expect(areaDaRota("/semana", null, MEMBRO_PROJETOS)).toBe("PROJETOS");
    expect(areaDaRota("/semana", null, pessoa("GESTOR", "PROJETOS"))).toBe("PROJETOS");
    expect(areaDaRota("/semana", null, ADMIN)).toBeNull();
    expect(areaDaRota("/semana", null, pessoa("ADMIN", "VENDAS"))).toBeNull();
    expect(areaDaRota("/semana", null, pessoa("GESTOR"))).toBeNull();
  });

  it("?area= indicada por `/` vale só na Semana de quem é das duas áreas", () => {
    expect(areaDaRota("/semana", null, ADMIN, "PROJETOS")).toBe("PROJETOS");
    expect(areaDaRota("/semana", null, pessoa("GESTOR"), "VENDAS")).toBe("VENDAS");
    expect(areaDaRota("/semana", null, VENDEDOR, "PROJETOS")).toBe("VENDAS");
    expect(areaDaRota("/contatos", null, ADMIN, "PROJETOS")).toBeNull();
    expect(areaDaRota("/kanban", null, ADMIN, "PROJETOS")).toBe("VENDAS");
  });

  it.each(["/contatos", "/empresas/x", "/calendario", "/propostas", "/painel", "/perfil", "/membros", "/membros/x", "/gestao/ranking"])("%s não define área", (rota) => {
    expect(areaDaRota(rota, null, VENDEDOR)).toBeNull();
  });
});

describe("isActive", () => {
  it("raiz só casa exato", () => {
    expect(isActive("/", "/")).toBe(true);
    expect(isActive("/kanban", "/")).toBe(false);
  });

  it("demais rotas casam por prefixo de segmento", () => {
    expect(isActive("/kanban", "/kanban")).toBe(true);
    expect(isActive("/kanban/vendas", "/kanban")).toBe(true);
    expect(isActive("/kanbanx", "/kanban")).toBe(false);
  });
});

describe("itemAtivo", () => {
  const item = (rotulo: string, area: "VENDAS" | "PROJETOS" = "VENDAS") => itensDoMenu(ADMIN, area).find((i) => i.label === rotulo)!;
  const vendas = item("Kanban de vendas");
  const projetos = item("Kanban de projetos", "PROJETOS");

  it("/kanban sem quadro = Vendas; ?quadro=projetos = Projetos", () => {
    expect(itemAtivo(vendas, "/kanban", null)).toBe(true);
    expect(itemAtivo(projetos, "/kanban", null)).toBe(false);
    expect(itemAtivo(vendas, "/kanban", "projetos")).toBe(false);
    expect(itemAtivo(projetos, "/kanban", "projetos")).toBe(true);
  });

  it("no detalhe vale o quadro declarado; sem ele nenhum quadro acende", () => {
    expect(itemAtivo(projetos, "/projetos/abc", "projetos")).toBe(true);
    expect(itemAtivo(vendas, "/projetos/abc", "projetos")).toBe(false);
    expect(itemAtivo(vendas, "/projetos/abc", null)).toBe(false);
    expect(itemAtivo(projetos, "/projetos/abc", null)).toBe(false);
  });

  it("fora do Kanban nenhum quadro acende; os outros itens seguem o prefixo", () => {
    expect(itemAtivo(vendas, "/tabela", "vendas")).toBe(false);
    expect(itemAtivo(item("Tabela"), "/tabela", null)).toBe(true);
    expect(itemAtivo(item("Tabela"), "/kanban", null)).toBe(false);
    expect(itemAtivo(item("Propostas"), "/propostas", null)).toBe(true);
    expect(itemAtivo(item("Minha Semana"), "/semana", null)).toBe(true);
    expect(itemAtivo(item("Calendário"), "/calendario", null)).toBe(true);
  });
});

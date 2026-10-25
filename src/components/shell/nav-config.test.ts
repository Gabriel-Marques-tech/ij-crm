import { describe, expect, it } from "vitest";
import { NAV_ITEMS, isActive, itemAtivo, itensParaPapel } from "./nav-config";

describe("itensParaPapel", () => {
  it("vendedor não vê Gestão; gestor e admin veem", () => {
    expect(itensParaPapel("VENDEDOR").map((i) => i.href)).not.toContain("/gestao");
    expect(itensParaPapel("GESTOR").map((i) => i.href)).toContain("/gestao");
    expect(itensParaPapel("ADMIN").map((i) => i.href)).toContain("/gestao");
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

describe("NAV_ITEMS", () => {
  it("tem hrefs únicos", () => {
    const hrefs = NAV_ITEMS.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("alternador de quadro (Vendas / Projetos)", () => {
  const vendas = NAV_ITEMS.find((i) => i.quadro === "vendas")!;
  const projetos = NAV_ITEMS.find((i) => i.quadro === "projetos")!;

  it("os dois quadros estão na navegação, para todos os papéis", () => {
    expect(vendas.label).toBe("Vendas");
    expect(projetos.label).toBe("Projetos");
    expect(itensParaPapel("VENDEDOR")).toEqual(expect.arrayContaining([vendas, projetos]));
  });

  it("/kanban sem quadro = Vendas; ?quadro=projetos = Projetos", () => {
    expect(itemAtivo(vendas, "/kanban", null)).toBe(true);
    expect(itemAtivo(projetos, "/kanban", null)).toBe(false);
    expect(itemAtivo(vendas, "/kanban", "projetos")).toBe(false);
    expect(itemAtivo(projetos, "/kanban", "projetos")).toBe(true);
  });

  it("no detalhe vale o ?quadro do link; sem ele nenhum quadro acende", () => {
    expect(itemAtivo(projetos, "/kanban/abc", "projetos")).toBe(true);
    expect(itemAtivo(vendas, "/kanban/abc", "projetos")).toBe(false);
    expect(itemAtivo(vendas, "/kanban/abc", null)).toBe(false);
    expect(itemAtivo(projetos, "/kanban/abc", null)).toBe(false);
  });

  it("fora do Kanban nenhum quadro acende; os outros itens seguem o prefixo", () => {
    expect(itemAtivo(vendas, "/tabela", "vendas")).toBe(false);
    const tabela = NAV_ITEMS.find((i) => i.href === "/tabela")!;
    expect(itemAtivo(tabela, "/tabela", null)).toBe(true);
    expect(itemAtivo(tabela, "/kanban", null)).toBe(false);
  });
});

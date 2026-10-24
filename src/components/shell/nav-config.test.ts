import { describe, expect, it } from "vitest";
import { NAV_ITEMS, isActive, itensParaPapel } from "./nav-config";

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

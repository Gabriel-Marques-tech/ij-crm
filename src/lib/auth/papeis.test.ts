import { describe, expect, it } from "vitest";
import { podeAtribuirPapel, podeGerarRedefinicao, temPapelMinimo } from "./papeis";

describe("temPapelMinimo", () => {
  it("ordem VENDEDOR < GESTOR < ADMIN", () => {
    expect(temPapelMinimo("ADMIN", "GESTOR")).toBe(true);
    expect(temPapelMinimo("GESTOR", "GESTOR")).toBe(true);
    expect(temPapelMinimo("VENDEDOR", "GESTOR")).toBe(false);
    expect(temPapelMinimo("GESTOR", "ADMIN")).toBe(false);
  });
});

describe("podeAtribuirPapel", () => {
  it("vendedor não convida ninguém", () => {
    expect(podeAtribuirPapel("VENDEDOR", "VENDEDOR")).toBe(false);
  });

  it("gestor convida até gestor, nunca admin", () => {
    expect(podeAtribuirPapel("GESTOR", "VENDEDOR")).toBe(true);
    expect(podeAtribuirPapel("GESTOR", "GESTOR")).toBe(true);
    expect(podeAtribuirPapel("GESTOR", "ADMIN")).toBe(false);
  });

  it("admin atribui qualquer papel", () => {
    expect(podeAtribuirPapel("ADMIN", "ADMIN")).toBe(true);
    expect(podeAtribuirPapel("ADMIN", "VENDEDOR")).toBe(true);
  });
});

describe("podeGerarRedefinicao (GAB-43: papel estritamente inferior; admin redefine qualquer um)", () => {
  it("gestor só para vendedor", () => {
    expect(podeGerarRedefinicao("GESTOR", "VENDEDOR")).toBe(true);
    expect(podeGerarRedefinicao("GESTOR", "GESTOR")).toBe(false);
    expect(podeGerarRedefinicao("GESTOR", "ADMIN")).toBe(false);
  });

  it("admin para gestor, vendedor e outros admins", () => {
    expect(podeGerarRedefinicao("ADMIN", "VENDEDOR")).toBe(true);
    expect(podeGerarRedefinicao("ADMIN", "GESTOR")).toBe(true);
    expect(podeGerarRedefinicao("ADMIN", "ADMIN")).toBe(true);
  });

  it("vendedor para ninguém", () => {
    expect(podeGerarRedefinicao("VENDEDOR", "VENDEDOR")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { PAPEIS, podeAtribuirPapel, podeEscrever, podeGerarRedefinicao, temPapelMinimo } from "./papeis";

describe("temPapelMinimo", () => {
  it("ordem VENDEDOR < GESTOR < ADMIN", () => {
    expect(temPapelMinimo("ADMIN", "GESTOR")).toBe(true);
    expect(temPapelMinimo("GESTOR", "GESTOR")).toBe(true);
    expect(temPapelMinimo("VENDEDOR", "GESTOR")).toBe(false);
    expect(temPapelMinimo("GESTOR", "ADMIN")).toBe(false);
  });

  it("VISUALIZADOR fica abaixo do vendedor", () => {
    expect(temPapelMinimo("VISUALIZADOR", "VENDEDOR")).toBe(false);
    expect(temPapelMinimo("VISUALIZADOR", "VISUALIZADOR")).toBe(true);
    expect(temPapelMinimo("VENDEDOR", "VISUALIZADOR")).toBe(true);
    expect(PAPEIS).toEqual(["VISUALIZADOR", "VENDEDOR", "PROJETOS", "GESTOR", "ADMIN"]);
  });

  it("PROJETOS (GAB-82) tem o mesmo nível do vendedor", () => {
    expect(temPapelMinimo("PROJETOS", "VENDEDOR")).toBe(true);
    expect(temPapelMinimo("VENDEDOR", "PROJETOS")).toBe(true);
    expect(temPapelMinimo("PROJETOS", "GESTOR")).toBe(false);
    expect(temPapelMinimo("VISUALIZADOR", "PROJETOS")).toBe(false);
  });
});

describe("podeEscrever", () => {
  it("todo papel menos VISUALIZADOR", () => {
    expect(podeEscrever("VISUALIZADOR")).toBe(false);
    expect(podeEscrever("VENDEDOR")).toBe(true);
    expect(podeEscrever("PROJETOS")).toBe(true);
    expect(podeEscrever("GESTOR")).toBe(true);
    expect(podeEscrever("ADMIN")).toBe(true);
  });
});

describe("podeAtribuirPapel", () => {
  it("vendedor e visualizador não convidam ninguém", () => {
    expect(podeAtribuirPapel("VENDEDOR", "VENDEDOR")).toBe(false);
    expect(podeAtribuirPapel("VENDEDOR", "VISUALIZADOR")).toBe(false);
    expect(podeAtribuirPapel("PROJETOS", "PROJETOS")).toBe(false);
    expect(podeAtribuirPapel("PROJETOS", "VENDEDOR")).toBe(false);
    expect(podeAtribuirPapel("VISUALIZADOR", "VISUALIZADOR")).toBe(false);
  });

  it("gestor convida até gestor, nunca admin", () => {
    expect(podeAtribuirPapel("GESTOR", "VISUALIZADOR")).toBe(true);
    expect(podeAtribuirPapel("GESTOR", "VENDEDOR")).toBe(true);
    expect(podeAtribuirPapel("GESTOR", "PROJETOS")).toBe(true);
    expect(podeAtribuirPapel("GESTOR", "GESTOR")).toBe(true);
    expect(podeAtribuirPapel("GESTOR", "ADMIN")).toBe(false);
  });

  it("admin atribui qualquer papel", () => {
    expect(podeAtribuirPapel("ADMIN", "ADMIN")).toBe(true);
    expect(podeAtribuirPapel("ADMIN", "VENDEDOR")).toBe(true);
    expect(podeAtribuirPapel("ADMIN", "VISUALIZADOR")).toBe(true);
  });
});

describe("podeGerarRedefinicao (GAB-43: papel estritamente inferior; admin redefine qualquer um)", () => {
  it("gestor só para vendedor e visualizador", () => {
    expect(podeGerarRedefinicao("GESTOR", "VENDEDOR")).toBe(true);
    expect(podeGerarRedefinicao("GESTOR", "VISUALIZADOR")).toBe(true);
    expect(podeGerarRedefinicao("GESTOR", "PROJETOS")).toBe(true);
    expect(podeGerarRedefinicao("GESTOR", "GESTOR")).toBe(false);
    expect(podeGerarRedefinicao("GESTOR", "ADMIN")).toBe(false);
  });

  it("admin para gestor, vendedor e outros admins", () => {
    expect(podeGerarRedefinicao("ADMIN", "VENDEDOR")).toBe(true);
    expect(podeGerarRedefinicao("ADMIN", "GESTOR")).toBe(true);
    expect(podeGerarRedefinicao("ADMIN", "ADMIN")).toBe(true);
    expect(podeGerarRedefinicao("ADMIN", "VISUALIZADOR")).toBe(true);
  });

  it("vendedor e visualizador para ninguém", () => {
    expect(podeGerarRedefinicao("VENDEDOR", "VENDEDOR")).toBe(false);
    expect(podeGerarRedefinicao("VENDEDOR", "VISUALIZADOR")).toBe(false);
    expect(podeGerarRedefinicao("PROJETOS", "VENDEDOR")).toBe(false);
    expect(podeGerarRedefinicao("VENDEDOR", "PROJETOS")).toBe(false);
    expect(podeGerarRedefinicao("VISUALIZADOR", "VISUALIZADOR")).toBe(false);
  });
});

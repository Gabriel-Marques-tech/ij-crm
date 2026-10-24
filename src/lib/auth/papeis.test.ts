import { describe, expect, it } from "vitest";
import { podeAtribuirPapel, temPapelMinimo } from "./papeis";

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

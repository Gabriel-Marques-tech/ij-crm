import { describe, expect, it, vi } from "vitest";
import { PREFERENCIAS_PADRAO, type Preferencias } from "./preferencias";
import { resolverInicio } from "./inicio";

const com = (inicio?: Preferencias["inicio"]): Preferencias => ({ ...PREFERENCIAS_PADRAO, ...(inicio ? { inicio } : {}) });

describe("resolverInicio (destino do logo e de /)", () => {
  it.each([
    [undefined, "/semana"],
    ["semana", "/semana"],
    ["vendas", "/kanban"],
    ["projetos", "/kanban?quadro=projetos"],
  ] as const)("preferência %s → %s", async (inicio, destino) => {
    expect(await resolverInicio(async () => com(inicio))).toBe(destino);
  });

  it("banco fora: não derruba o layout — loga com ref e cai na Minha Semana", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await resolverInicio(async () => { throw new Error("banco fora"); })).toBe("/semana");
    expect(erro.mock.calls.some((c) => String(c[0]).includes("layout.inicio") && String(c[0]).includes("ref="))).toBe(true);
    erro.mockRestore();
  });
});

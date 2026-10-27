// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { estadoSegredos } from "./segredos";

const envOriginal = { ...process.env };
afterEach(() => {
  process.env = { ...envOriginal };
});

const estado = (nome: string) => estadoSegredos().find((s) => s.nome === nome)?.estado;

describe("estadoSegredos (Admin → Configuração, só leitura)", () => {
  it("GEMINI_API_KEY aparece como configurada/ausente, sem expor o valor", () => {
    process.env.GEMINI_API_KEY = "AIza-segredo";
    expect(estado("GEMINI_API_KEY")).toBe("configurada");
    expect(JSON.stringify(estadoSegredos())).not.toContain("AIza-segredo");
    delete process.env.GEMINI_API_KEY;
    expect(estado("GEMINI_API_KEY")).toBe("ausente");
  });

  it("lista as chaves dos três provedores", () => {
    expect(estadoSegredos().map((s) => s.nome)).toEqual(expect.arrayContaining(["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]));
  });
});

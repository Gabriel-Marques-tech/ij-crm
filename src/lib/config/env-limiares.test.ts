// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { limiarClassificador, limiarConfianca, limiarSemTag, modeloClassificacao, reiniciarAvisosConfig, validarConfigLlm } from "./env";

const envOriginal = { ...process.env };
let warn: MockInstance<typeof console.warn>;

function avisos(): string[] {
  return warn.mock.calls.map((c) => c.map(String).join(" "));
}

beforeEach(() => {
  for (const k of ["LLM_LIMIAR_CONFIANCA", "LLM_LIMIAR_CLASSIFICADOR", "LLM_LIMIAR_SEM_TAG", "LLM_CLASSIFICACAO_MODELO", "LLM_PROVEDOR"]) delete process.env[k];
  reiniciarAvisosConfig();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...envOriginal };
});

describe("limiares LLM_LIMIAR_* (GAB-39)", () => {
  it("padrões sem aviso", () => {
    expect([limiarConfianca(), limiarClassificador(), limiarSemTag()]).toEqual([0.7, 0.7, 0.85]);
    expect(avisos()).toEqual([]);
  });

  it("inválido ou fora de [0,1] → padrão + aviso UMA vez por variável/valor", () => {
    process.env.LLM_LIMIAR_CLASSIFICADOR = "1.5";
    process.env.LLM_LIMIAR_SEM_TAG = "abc";
    expect(limiarClassificador()).toBe(0.7);
    expect(limiarClassificador()).toBe(0.7);
    expect(limiarSemTag()).toBe(0.85);
    expect(limiarSemTag()).toBe(0.85);
    const a = avisos();
    expect(a).toHaveLength(2);
    expect(a[0]).toMatch(/\[config\] LLM_LIMIAR_CLASSIFICADOR=1\.5 inválido.*0\.7/);
    expect(a[1]).toMatch(/\[config\] LLM_LIMIAR_SEM_TAG=abc inválido.*0\.85/);
  });

  it("LLM_LIMIAR_SEM_TAG menor que LLM_LIMIAR_CONFIANCA → usa o mais exigente e avisa uma vez", () => {
    process.env.LLM_LIMIAR_CONFIANCA = "0.9";
    process.env.LLM_LIMIAR_SEM_TAG = "0.8";
    expect(limiarSemTag()).toBe(0.9);
    expect(limiarSemTag()).toBe(0.9);
    expect(avisos()).toHaveLength(1);
    expect(avisos()[0]).toMatch(/LLM_LIMIAR_SEM_TAG=0\.8 < LLM_LIMIAR_CONFIANCA=0\.9/);
  });

  it("validarConfigLlm (boot) lê tudo e avisa o que estiver errado", () => {
    process.env.LLM_LIMIAR_CONFIANCA = "-1";
    process.env.LLM_PROVEDOR = "openai";
    process.env.LLM_CLASSIFICACAO_MODELO = "claude-haiku-5-5";
    validarConfigLlm();
    const a = avisos().join("\n");
    expect(a).toContain("LLM_LIMIAR_CONFIANCA=-1");
    expect(a).toContain("LLM_CLASSIFICACAO_MODELO=claude-haiku-5-5 ignorado");
  });
});

describe("modeloClassificacao", () => {
  it("modelo de outro provedor é ignorado com aviso uma vez", () => {
    process.env.LLM_CLASSIFICACAO_MODELO = "claude-haiku-5-5";
    expect(modeloClassificacao("openai")).toBe("gpt-6.1-sol");
    expect(modeloClassificacao("openai")).toBe("gpt-6.1-sol");
    expect(modeloClassificacao("anthropic")).toBe("claude-haiku-5-5");
    expect(avisos()).toHaveLength(1);
    expect(avisos()[0]).toMatch(/LLM_CLASSIFICACAO_MODELO=claude-haiku-5-5 ignorado.*openai/);
  });
});

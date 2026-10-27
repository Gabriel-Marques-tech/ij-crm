// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chaveOpenAI, grupoJid, limiarConfianca, modeloExtracao, notificacoesAtivas, provedorLlm, timeoutEnvioMs } from "./env";
import { definirSobrescritas } from "./sobrescritas";
import { paraSobrescritas, resolverConfigTecnica, validarCombinacao, type ConfigTecnica } from "./tecnica";

const envOriginal = { ...process.env };
const VARS = [
  "GRUPO_JID",
  "LLM_PROVEDOR",
  "LLM_EXTRACAO_MODELO",
  "LLM_CLASSIFICACAO_MODELO",
  "LLM_LIMIAR_CONFIANCA",
  "LLM_LIMIAR_SEM_TAG",
  "LLM_LIMIAR_CLASSIFICADOR",
  "EVOLUTION_TIMEOUT_ENVIO_MS",
];

beforeEach(() => {
  for (const v of VARS) delete process.env[v];
  definirSobrescritas(undefined);
});

afterEach(() => {
  process.env = { ...envOriginal };
  definirSobrescritas(undefined);
});

function efetivo(cfg: ConfigTecnica) {
  return resolverConfigTecnica(cfg);
}

describe("precedência config > env > padrão", () => {
  it("sem nada: padrões do código", () => {
    const r = efetivo({});
    expect(r.provedor).toEqual({ valor: "openai", origem: "padrao" });
    expect(r.modeloExtracao).toEqual({ valor: "gpt-6.1-sol", origem: "padrao" });
    expect(r.limiarConfianca).toEqual({ valor: 0.7, origem: "padrao" });
    expect(r.limiarSemTag).toEqual({ valor: 0.85, origem: "padrao" });
    expect(r.limiarClassificador).toEqual({ valor: 0.7, origem: "padrao" });
    expect(r.timeoutEnvioMs).toEqual({ valor: 60000, origem: "padrao" });
    expect(r.grupoJid).toEqual({ valor: null, origem: "padrao" });
  });

  it("env vale quando a config não define; config vence o env", () => {
    process.env.GRUPO_JID = "111@g.us";
    process.env.LLM_LIMIAR_CONFIANCA = "0,6";
    expect(efetivo({}).grupoJid).toEqual({ valor: "111@g.us", origem: "env" });
    expect(efetivo({}).limiarConfianca).toEqual({ valor: 0.6, origem: "env" });
    expect(efetivo({ grupoJid: "222@g.us", limiarConfianca: 0.5 }).grupoJid).toEqual({ valor: "222@g.us", origem: "config" });
    expect(efetivo({ limiarConfianca: 0.5 }).limiarConfianca).toEqual({ valor: 0.5, origem: "config" });
  });

  it("env ilegível cai no padrão", () => {
    process.env.LLM_LIMIAR_CONFIANCA = "muito";
    process.env.EVOLUTION_TIMEOUT_ENVIO_MS = "10";
    expect(efetivo({}).limiarConfianca).toEqual({ valor: 0.7, origem: "padrao" });
    expect(efetivo({}).timeoutEnvioMs).toEqual({ valor: 60000, origem: "padrao" });
  });

  it("modelo padrão segue o provedor efetivo; classificação sem valor = o da extração", () => {
    const r = efetivo({ provedor: "anthropic" });
    expect(r.modeloExtracao).toEqual({ valor: "claude-haiku-5-5", origem: "padrao" });
    expect(r.modeloClassificacao).toEqual({ valor: "claude-haiku-5-5", origem: "padrao" });
  });

  it("as funções de env.ts leem a config aplicada antes do process.env", () => {
    process.env.GRUPO_JID = "111@g.us";
    process.env.LLM_PROVEDOR = "anthropic";
    process.env.LLM_LIMIAR_CONFIANCA = "0.6";
    process.env.OPENAI_API_KEY = "sk-env";
    definirSobrescritas(paraSobrescritas({ grupoJid: "222@g.us", provedor: "openai", modeloExtracao: "gpt-x", limiarConfianca: 0.4, timeoutEnvioMs: 15000 }));
    expect(grupoJid()).toBe("222@g.us");
    expect(provedorLlm()).toBe("openai");
    expect(modeloExtracao("openai")).toBe("gpt-x");
    expect(limiarConfianca()).toBe(0.4);
    expect(timeoutEnvioMs()).toBe(15000);
    // Segredos e safe mode nunca vêm da config.
    expect(chaveOpenAI()).toBe("sk-env");
    expect(Object.keys(paraSobrescritas({ grupoJid: "x@g.us" }))).toEqual(["GRUPO_JID"]);
    process.env.NOTIFICATIONS_ENABLED = "false";
    expect(notificacoesAtivas()).toBe(false);

    definirSobrescritas(undefined);
    expect(grupoJid()).toBe("111@g.us");
    expect(limiarConfianca()).toBe(0.6);
  });
});

describe("validarCombinacao", () => {
  it("aceita a combinação padrão", () => {
    expect(validarCombinacao(efetivo({}))).toBeNull();
    expect(validarCombinacao(efetivo({ provedor: "anthropic", modeloExtracao: "claude-sonnet-5-5" }))).toBeNull();
  });

  it("gemini: aceita modelo gemini-* (ou o padrão) e recusa gpt-*/claude-*", () => {
    expect(efetivo({ provedor: "gemini" }).modeloExtracao).toEqual({ valor: "gemini-3.8-flash", origem: "padrao" });
    expect(validarCombinacao(efetivo({ provedor: "gemini" }))).toBeNull();
    expect(validarCombinacao(efetivo({ provedor: "gemini", modeloExtracao: "gemini-3.6-flash" }))).toBeNull();
    expect(validarCombinacao(efetivo({ provedor: "gemini", modeloExtracao: "gpt-6.1-sol" }))).toMatch(/modelo de extração.*não é do provedor gemini.*gemini-/);
    expect(validarCombinacao(efetivo({ provedor: "gemini", modeloExtracao: "claude-haiku-5-5" }))).toMatch(/não é do provedor gemini/);
    expect(validarCombinacao(efetivo({ provedor: "openai", modeloExtracao: "gemini-3.8-flash" }))).toMatch(/não é do provedor openai/);
    expect(validarCombinacao(efetivo({ provedor: "gemini", modeloClassificacao: "gpt-6.1-sol" }))).toMatch(/modelo de classificação.*não é do provedor gemini/);
    // Classificação gpt-* herdada do env com gemini é ignorada (usa a da extração).
    process.env.LLM_CLASSIFICACAO_MODELO = "gpt-6.1-sol";
    expect(efetivo({ provedor: "gemini" }).modeloClassificacao).toEqual({ valor: "gemini-3.8-flash", origem: "padrao" });
  });

  it("provedor no env com nome de propriedade de objeto (constructor, toString) é inválido, sem modelo padrão", () => {
    for (const p of ["constructor", "toString", "__proto__"]) {
      process.env.LLM_PROVEDOR = p;
      const r = efetivo({});
      expect(r.modeloExtracao, p).toEqual({ valor: null, origem: "padrao" });
      expect(validarCombinacao(r), p).toMatch(/LLM_PROVEDOR/);
    }
  });

  it("gemma-* não passa como modelo da OpenAI nem do Gemini", () => {
    expect(validarCombinacao(efetivo({ provedor: "openai", modeloExtracao: "gemma-4-31b-it" }))).toMatch(/não é do provedor openai/);
    expect(validarCombinacao(efetivo({ provedor: "gemini", modeloExtracao: "gemma-4-31b-it" }))).toMatch(/não é do provedor gemini/);
    expect(validarCombinacao(efetivo({ provedor: "gemini", modeloExtracao: "models/gemini-3.8-flash" }))).toBeNull();
  });

  it("recusa modelo de outro provedor (config ou env herdado)", () => {
    expect(validarCombinacao(efetivo({ provedor: "anthropic", modeloExtracao: "gpt-6.1-sol" }))).toMatch(/modelo de extração.*não é do provedor anthropic/);
    process.env.LLM_EXTRACAO_MODELO = "gpt-6.1-sol";
    expect(validarCombinacao(efetivo({ provedor: "anthropic" }))).toMatch(/modelo de extração/);
    expect(validarCombinacao(efetivo({ provedor: "openai", modeloClassificacao: "claude-haiku-5-5" }))).toMatch(/modelo de classificação.*não é do provedor openai/);
  });

  it("modelo de classificação errado vindo do env é ignorado (usa o da extração), não bloqueia", () => {
    process.env.LLM_CLASSIFICACAO_MODELO = "claude-haiku-5-5";
    const r = efetivo({});
    expect(r.modeloClassificacao).toEqual({ valor: "gpt-6.1-sol", origem: "padrao" });
    expect(validarCombinacao(r)).toBeNull();
  });

  it("recusa limiar sem #crm abaixo do limiar com #crm", () => {
    expect(validarCombinacao(efetivo({ limiarConfianca: 0.9, limiarSemTag: 0.8 }))).toMatch(/sem #crm.*maior ou igual/);
    process.env.LLM_LIMIAR_SEM_TAG = "0.75";
    expect(validarCombinacao(efetivo({ limiarConfianca: 0.8 }))).toMatch(/sem #crm/);
    expect(validarCombinacao(efetivo({ limiarConfianca: 0.75 }))).toBeNull();
  });

  it("recusa mock em produção e provedor inválido no env", () => {
    const original = process.env.NODE_ENV;
    try {
      (process.env as Record<string, string>).NODE_ENV = "production";
      expect(validarCombinacao(efetivo({ provedor: "mock" }))).toMatch(/mock não é permitido em produção/);
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = original;
    }
    expect(validarCombinacao(efetivo({ provedor: "mock" }))).toBeNull();
    process.env.LLM_PROVEDOR = "cohere";
    expect(validarCombinacao(efetivo({}))).toMatch(/LLM_PROVEDOR/);
    expect(validarCombinacao(efetivo({ provedor: "openai" }))).toBeNull();
  });
});

describe("leitores do classificador (GAB-39) seguem a config do Admin", () => {
  it("LLM_CLASSIFICACAO_MODELO, LLM_LIMIAR_CLASSIFICADOR e LLM_LIMIAR_SEM_TAG vêm das sobrescritas, com a regra de ordem", async () => {
    const { limiarClassificador, limiarSemTag, modeloClassificacao, reiniciarAvisosConfig } = await import("./env");
    reiniciarAvisosConfig();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.LLM_CLASSIFICACAO_MODELO = "gpt-env";
    process.env.LLM_LIMIAR_CLASSIFICADOR = "0.6";
    process.env.LLM_LIMIAR_SEM_TAG = "0.9";
    definirSobrescritas(paraSobrescritas({ modeloClassificacao: "gpt-admin", limiarClassificador: 0.55, limiarSemTag: 0.95 }));
    expect(modeloClassificacao("openai")).toBe("gpt-admin");
    expect(limiarClassificador()).toBe(0.55);
    expect(limiarSemTag()).toBe(0.95);
    // Ordem: sem #crm nunca abaixo de com #crm, mesmo vindo da config.
    definirSobrescritas(paraSobrescritas({ limiarConfianca: 0.8, limiarSemTag: 0.5 }));
    expect(limiarSemTag()).toBe(0.8);
    definirSobrescritas(undefined);
    expect(modeloClassificacao("openai")).toBe("gpt-env");
    expect(limiarClassificador()).toBe(0.6);
    vi.restoreAllMocks();
  });
});

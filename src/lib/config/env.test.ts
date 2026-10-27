import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chaveApiEvolution,
  ConfigAusente,
  ConfigFraca,
  configEvolution,
  diagnosticarSegredo,
  grupoJid,
  chaveGemini,
  modeloDoProvedor,
  modeloDoProvedorConfigurado,
  modeloExtracao,
  notificacoesAtivas,
  provedorLlm,
  segredoWebhook,
} from "./env";

const envOriginal = { ...process.env };
const FORTE = "a".repeat(32);

beforeEach(() => {
  for (const k of Object.keys(process.env)) if (k.startsWith("EVOLUTION_") || k === "GRUPO_JID" || k === "NOTIFICATIONS_ENABLED") delete process.env[k];
});

afterEach(() => {
  process.env = { ...envOriginal };
});

describe("diagnosticarSegredo", () => {
  it.each([
    [undefined, "AUSENTE"],
    ["", "AUSENTE"],
    ["   ", "AUSENTE"],
    ["troque-me-openssl-rand-hex-32-xxxxxxxxxx", "PLACEHOLDER"],
    ["troque-me", "PLACEHOLDER"],
    ["curto-demais", "CURTO"],
    ["a".repeat(31), "CURTO"],
  ] as const)("%j → %s", (valor, motivo) => {
    if (valor === undefined) delete process.env.EVOLUTION_WEBHOOK_SECRET;
    else process.env.EVOLUTION_WEBHOOK_SECRET = valor;
    expect(diagnosticarSegredo("EVOLUTION_WEBHOOK_SECRET")).toEqual({ ok: false, motivo });
  });

  it("32+ chars sem placeholder → ok", () => {
    process.env.EVOLUTION_WEBHOOK_SECRET = FORTE;
    expect(diagnosticarSegredo("EVOLUTION_WEBHOOK_SECRET")).toEqual({ ok: true, valor: FORTE });
  });
});

describe("env", () => {
  it("segredoWebhook: ausente, placeholder ou curto → undefined (quem chama falha fechado)", () => {
    expect(segredoWebhook()).toBeUndefined();
    process.env.EVOLUTION_WEBHOOK_SECRET = "troque-me-openssl-rand-hex-32-xxxxxxxxxx";
    expect(segredoWebhook()).toBeUndefined();
    process.env.EVOLUTION_WEBHOOK_SECRET = "s3gr3do";
    expect(segredoWebhook()).toBeUndefined();
    process.env.EVOLUTION_WEBHOOK_SECRET = FORTE;
    expect(segredoWebhook()).toBe(FORTE);
  });

  it("chaveApiEvolution segue a mesma regra", () => {
    expect(chaveApiEvolution()).toBeUndefined();
    process.env.EVOLUTION_API_KEY = "curta";
    expect(chaveApiEvolution()).toBeUndefined();
    process.env.EVOLUTION_API_KEY = FORTE;
    expect(chaveApiEvolution()).toBe(FORTE);
  });

  it("grupoJid: vazio → undefined", () => {
    expect(grupoJid()).toBeUndefined();
    process.env.GRUPO_JID = "120363000000000001@g.us";
    expect(grupoJid()).toBe("120363000000000001@g.us");
  });

  it("configEvolution lança ConfigAusente nomeando a variável", () => {
    process.env.EVOLUTION_API_URL = "http://localhost:8080";
    process.env.EVOLUTION_INSTANCE = "ij-crm";
    expect(() => configEvolution()).toThrow(ConfigAusente);
    expect(() => configEvolution()).toThrow(/EVOLUTION_API_KEY/);
    process.env.EVOLUTION_API_KEY = FORTE;
    expect(configEvolution()).toEqual({ apiUrl: "http://localhost:8080", apiKey: FORTE, instancia: "ij-crm" });
  });

  it("configEvolution lança ConfigFraca para chave placeholder ou curta", () => {
    process.env.EVOLUTION_API_URL = "http://localhost:8080";
    process.env.EVOLUTION_INSTANCE = "ij-crm";
    process.env.EVOLUTION_API_KEY = "troque-me-openssl-rand-hex-32-xxxxxxxxxx";
    expect(() => configEvolution()).toThrow(ConfigFraca);
    expect(() => configEvolution()).toThrow(/PLACEHOLDER/);
    process.env.EVOLUTION_API_KEY = "curta";
    expect(() => configEvolution()).toThrow(/CURTO/);
  });

  it("configEvolution remove barra final da URL", () => {
    process.env.EVOLUTION_API_URL = "http://localhost:8080/";
    process.env.EVOLUTION_API_KEY = FORTE;
    process.env.EVOLUTION_INSTANCE = "ij-crm";
    expect(configEvolution().apiUrl).toBe("http://localhost:8080");
  });

  it("notificacoesAtivas só com a string exata 'true'", () => {
    expect(notificacoesAtivas()).toBe(false);
    process.env.NOTIFICATIONS_ENABLED = "TRUE";
    expect(notificacoesAtivas()).toBe(false);
    process.env.NOTIFICATIONS_ENABLED = "true";
    expect(notificacoesAtivas()).toBe(true);
  });
});

describe("provedorLlm", () => {
  it("mock em produção é recusado com erro claro (falha fechada)", () => {
    process.env.LLM_PROVEDOR = "mock";
    (process.env as Record<string, string>).NODE_ENV = "production";
    expect(() => provedorLlm()).toThrow(/LLM_PROVEDOR=mock não é permitido em produção/);
    (process.env as Record<string, string>).NODE_ENV = "test";
    expect(provedorLlm()).toBe("mock");
  });

  it("padrão é openai; modelo padrão por provedor (GPT-6.1 Sol / Claude Haiku 5.5), env sobrepõe", () => {
    delete process.env.LLM_PROVEDOR;
    delete process.env.LLM_EXTRACAO_MODELO;
    expect(provedorLlm()).toBe("openai");
    expect(modeloExtracao("openai")).toBe("gpt-6.1-sol");
    expect(modeloExtracao("anthropic")).toBe("claude-haiku-5-5");
    expect(modeloExtracao("gemini")).toBe("gemini-3.8-flash");
    process.env.LLM_EXTRACAO_MODELO = "gpt-6-sol";
    expect(modeloExtracao("openai")).toBe("gpt-6-sol");
  });

  it("modeloDoProvedorConfigurado: modelo do provedor escolhido; null para mock/inválido, sem lançar", () => {
    delete process.env.LLM_EXTRACAO_MODELO;
    process.env.LLM_PROVEDOR = "anthropic";
    expect(modeloDoProvedorConfigurado()).toBe("claude-haiku-5-5");
    process.env.LLM_PROVEDOR = "openai";
    expect(modeloDoProvedorConfigurado()).toBe("gpt-6.1-sol");
    process.env.LLM_PROVEDOR = "gemini";
    expect(modeloDoProvedorConfigurado()).toBe("gemini-3.8-flash");
    process.env.LLM_PROVEDOR = "cohere";
    expect(modeloDoProvedorConfigurado()).toBeNull();
    process.env.LLM_PROVEDOR = "mock";
    (process.env as Record<string, string>).NODE_ENV = "production";
    expect(modeloDoProvedorConfigurado()).toBeNull();
  });

  it("anthropic e gemini em produção seguem valendo; maiúsculas valem", () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.LLM_PROVEDOR = "anthropic";
    expect(provedorLlm()).toBe("anthropic");
    process.env.LLM_PROVEDOR = "Gemini";
    expect(provedorLlm()).toBe("gemini");
  });

  it("chaveGemini lê GEMINI_API_KEY (vazio = ausente)", () => {
    process.env.GEMINI_API_KEY = "  ";
    expect(chaveGemini()).toBeUndefined();
    process.env.GEMINI_API_KEY = "AIza-x";
    expect(chaveGemini()).toBe("AIza-x");
  });

  it("modeloDoProvedor: prefixo decide de quem é o modelo", () => {
    expect(modeloDoProvedor("gemini-3.8-flash", "gemini")).toBe(true);
    expect(modeloDoProvedor("gpt-6.1-sol", "gemini")).toBe(false);
    expect(modeloDoProvedor("claude-haiku-5-5", "anthropic")).toBe(true);
    expect(modeloDoProvedor("gemini-3.8-flash", "anthropic")).toBe(false);
    expect(modeloDoProvedor("gpt-6.1-sol", "openai")).toBe(true);
    expect(modeloDoProvedor("gemini-3.8-flash", "openai")).toBe(false);
    expect(modeloDoProvedor("claude-haiku-5-5", "openai")).toBe(false);
  });
});

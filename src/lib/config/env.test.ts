import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigAusente, configEvolution, grupoJid, notificacoesAtivas, segredoWebhook } from "./env";

const envOriginal = { ...process.env };

beforeEach(() => {
  for (const k of Object.keys(process.env)) if (k.startsWith("EVOLUTION_") || k === "GRUPO_JID" || k === "NOTIFICATIONS_ENABLED") delete process.env[k];
});

afterEach(() => {
  process.env = { ...envOriginal };
});

describe("env", () => {
  it("segredoWebhook e grupoJid: vazio/ausente → undefined (quem chama falha fechado)", () => {
    expect(segredoWebhook()).toBeUndefined();
    process.env.EVOLUTION_WEBHOOK_SECRET = "   ";
    expect(segredoWebhook()).toBeUndefined();
    process.env.EVOLUTION_WEBHOOK_SECRET = "s3gr3do";
    expect(segredoWebhook()).toBe("s3gr3do");
    expect(grupoJid()).toBeUndefined();
    process.env.GRUPO_JID = "120363000000000001@g.us";
    expect(grupoJid()).toBe("120363000000000001@g.us");
  });

  it("configEvolution lança ConfigAusente nomeando a variável", () => {
    process.env.EVOLUTION_API_URL = "http://localhost:8080";
    process.env.EVOLUTION_INSTANCE = "ij-crm";
    expect(() => configEvolution()).toThrow(ConfigAusente);
    expect(() => configEvolution()).toThrow(/EVOLUTION_API_KEY/);
    process.env.EVOLUTION_API_KEY = "k";
    expect(configEvolution()).toEqual({ apiUrl: "http://localhost:8080", apiKey: "k", instancia: "ij-crm" });
  });

  it("configEvolution remove barra final da URL", () => {
    process.env.EVOLUTION_API_URL = "http://localhost:8080/";
    process.env.EVOLUTION_API_KEY = "k";
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

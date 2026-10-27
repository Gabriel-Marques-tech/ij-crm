// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { LIMITE_LOG_LLM, LIMITE_LOG_WEBHOOK, listarLogsLlm, listarLogsWebhook, registrarLogLlm, registrarLogWebhook } from "./tecnicos";

const dbT = dbTeste();

beforeEach(async () => {
  await limparBanco(["log_webhook", "log_llm"]);
  vi.restoreAllMocks();
});

describe("log_webhook (anel)", () => {
  it("mascara o chat e só aceita identificadores em tipo/resultado", async () => {
    await registrarLogWebhook({ tipo: "messages.upsert", chat: "120363000000000001@g.us", status: 200, resultado: "persistida", ms: 12.6 });
    await registrarLogWebhook({ tipo: "oi tudo bem? +55 11 99999-8888", chat: "5511999998888@s.whatsapp.net", status: 200, resultado: "texto livre com espaço", ms: 3 });
    const [segundo, primeiro] = await listarLogsWebhook();
    expect(primeiro).toMatchObject({ tipo: "messages.upsert", chat: "12**************01@g.us", status: 200, resultado: "persistida", ms: 13 });
    expect(segundo).toMatchObject({ tipo: "?", chat: "+55*********88@s.whatsapp.net", resultado: "?" });
  });

  it(`mantém só as últimas ${LIMITE_LOG_WEBHOOK} linhas`, async () => {
    for (let i = 0; i < LIMITE_LOG_WEBHOOK + 5; i++) {
      await registrarLogWebhook({ tipo: "messages.upsert", chat: null, status: 200, resultado: `r${i}`, ms: i });
    }
    expect(await dbT.logWebhook.count()).toBe(LIMITE_LOG_WEBHOOK);
    const linhas = await listarLogsWebhook();
    expect(linhas).toHaveLength(LIMITE_LOG_WEBHOOK);
    expect(linhas[0].resultado).toBe(`r${LIMITE_LOG_WEBHOOK + 4}`);
    expect(linhas.at(-1)!.resultado).toBe("r5");
  });

  it("falha no banco não lança (o webhook segue) e não loga nada do evento", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(registrarLogWebhook({ tipo: "x", chat: null, status: 200, resultado: "ok", ms: Number.NaN })).resolves.toBeUndefined();
    void erro;
  });
});

describe("log_llm (anel)", () => {
  it("grava modelo, tokens (incl. raciocínio), ms e status", async () => {
    await registrarLogLlm({
      operacao: "extracao",
      uso: { provedor: "openai", modelo: "gpt-6.1-sol", tokensEntrada: 900, tokensSaida: 120, tokensRaciocinio: 64, ms: 1830 },
      status: "ok",
      ref: "cmsg123",
    });
    await registrarLogLlm({ operacao: "extracao", status: "SEM_CHAVE", ref: null });
    const [semUso, comUso] = await listarLogsLlm();
    expect(comUso).toMatchObject({ operacao: "extracao", provedor: "openai", modelo: "gpt-6.1-sol", tokensEntrada: 900, tokensSaida: 120, tokensRaciocinio: 64, ms: 1830, status: "ok", ref: "cmsg123" });
    expect(semUso).toMatchObject({ status: "SEM_CHAVE", provedor: null, modelo: null, tokensEntrada: null });
  });

  it(`mantém só as últimas ${LIMITE_LOG_LLM} linhas`, async () => {
    for (let i = 0; i < LIMITE_LOG_LLM + 3; i++) await registrarLogLlm({ operacao: "extracao", status: "ok", ref: `m${i}` });
    expect(await dbT.logLlm.count()).toBe(LIMITE_LOG_LLM);
    expect((await listarLogsLlm())[0].ref).toBe(`m${LIMITE_LOG_LLM + 2}`);
  });
});

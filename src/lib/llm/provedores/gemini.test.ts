// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { FIXTURES_EXTRACAO } from "../fixtures/extracao";
import { JSON_SCHEMA_CLASSIFICACAO } from "../prompts/classificacao.v1";
import { JSON_SCHEMA_EXTRACAO } from "../prompts/extracao.v2";
import { JSON_SCHEMA_RESUMO } from "../prompts/resumo.v1";
import { ErroLlm } from "../tipos";
import { MAX_TOKENS_EXTRACAO } from "./comum";
import { MODELO_GEMINI_PADRAO, criarProvedorGemini, paraSchemaGemini } from "./gemini";

const SAIDA = FIXTURES_EXTRACAO[0].saida;
const PEDIDO = { sistema: "sistema", usuario: "usuario", schema: JSON_SCHEMA_EXTRACAO as unknown as Record<string, unknown> };
const USO = { promptTokenCount: 1500, candidatesTokenCount: 200, thoughtsTokenCount: 64, totalTokenCount: 1764 };

function http(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

function resposta(texto: string | null, extra: Record<string, unknown> = {}, candidato: Record<string, unknown> = {}) {
  return {
    candidates: [{ content: { role: "model", parts: texto === null ? [] : [{ text: texto }] }, finishReason: "STOP", index: 0, ...candidato }],
    usageMetadata: USO,
    modelVersion: "gemini-3.8-flash",
    responseId: "r1",
    ...extra,
  };
}

/** Corpo de erro no formato google.rpc.Status (o que a API do Gemini devolve). */
function erroApi(code: number, status: string, details: unknown[] = []) {
  return http(code, { error: { code, status, message: "detalhe com texto do usuário", details } });
}

function provedor(fetch: ReturnType<typeof vi.fn>, timeoutMs?: number, modelo = "gemini-3.8-flash") {
  return criarProvedorGemini({ apiKey: "AIza-teste", modelo, fetch: fetch as unknown as typeof globalThis.fetch, timeoutMs });
}

const corpoDe = (fetch: ReturnType<typeof vi.fn>, i = 0) => JSON.parse((fetch.mock.calls[i] as [string, RequestInit])[1].body as string);

describe("provedor Gemini (SDK @google/genai, fetch falso)", () => {
  it("modelo padrão é o Gemini 3.8 Flash", () => {
    expect(MODELO_GEMINI_PADRAO).toBe("gemini-3.8-flash");
  });

  it("manda modelo, system, JSON schema convertido, teto e thinking LOW; devolve JSON parseado + uso", async () => {
    const fetch = vi.fn().mockResolvedValue(http(200, resposta(JSON.stringify(SAIDA))));
    const r = await provedor(fetch).extrair(PEDIDO);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
    expect(new Headers(init.headers).get("x-goog-api-key")).toBe("AIza-teste");
    expect(corpoDe(fetch)).toEqual({
      contents: [{ role: "user", parts: [{ text: "usuario" }] }],
      systemInstruction: { role: "user", parts: [{ text: "sistema" }] },
      generationConfig: {
        maxOutputTokens: MAX_TOKENS_EXTRACAO,
        responseMimeType: "application/json",
        responseJsonSchema: paraSchemaGemini(JSON_SCHEMA_EXTRACAO),
        thinkingConfig: { thinkingLevel: "LOW" },
      },
    });
    expect(r.bruto).toEqual(SAIDA);
    expect(r.uso).toMatchObject({ provedor: "gemini", modelo: "gemini-3.8-flash", tokensEntrada: 1500, tokensSaida: 264, tokensRaciocinio: 64 });
    expect(r.uso.ms).toBeGreaterThanOrEqual(0);
  });

  it("não manda sampling (temperature/topP/topK) nem pede os pensamentos", async () => {
    const fetch = vi.fn().mockResolvedValue(http(200, resposta(JSON.stringify(SAIDA))));
    await provedor(fetch).extrair(PEDIDO);
    const gc = corpoDe(fetch).generationConfig;
    for (const proibido of ["temperature", "topP", "topK"]) expect(gc).not.toHaveProperty(proibido);
    expect(gc.thinkingConfig).not.toHaveProperty("includeThoughts");
  });

  it("modelos 2.x (sem thinkingLevel) usam thinkingBudget baixo", async () => {
    const fetch = vi.fn().mockResolvedValue(http(200, resposta(JSON.stringify(SAIDA))));
    await provedor(fetch, undefined, "gemini-2.5-flash").extrair(PEDIDO);
    expect(corpoDe(fetch).generationConfig.thinkingConfig).toEqual({ thinkingBudget: 1024 });
  });

  it("maxTokens do pedido vira maxOutputTokens (classificação/resumo)", async () => {
    const fetch = vi.fn().mockResolvedValue(http(200, resposta('{"relevante":true,"confianca":0.9}')));
    await provedor(fetch).extrair({ nome: "classificacao", sistema: "s", usuario: "u", schema: JSON_SCHEMA_CLASSIFICACAO, maxTokens: 900 });
    expect(corpoDe(fetch).generationConfig.maxOutputTokens).toBe(900);
  });

  it("ignora partes de pensamento (thought: true) ao montar o JSON", async () => {
    const corpo = resposta(null);
    (corpo.candidates[0].content.parts as unknown[]).push({ text: "pensando no texto do usuário", thought: true }, { text: JSON.stringify(SAIDA) });
    const fetch = vi.fn().mockResolvedValue(http(200, corpo));
    await expect(provedor(fetch).extrair(PEDIDO)).resolves.toMatchObject({ bruto: SAIDA });
  });

  it("4xx (400, 401, 403, 404, 429 de rate limit) não re-tenta e não copia a mensagem da API", async () => {
    const casos: [number, string, unknown[]][] = [
      [400, "INVALID_ARGUMENT", []],
      [401, "UNAUTHENTICATED", []],
      [403, "PERMISSION_DENIED", []],
      [404, "NOT_FOUND", []],
      // Limite por minuto: RESOURCE_EXHAUSTED, mas a quota é de minuto → não é falta de crédito.
      [429, "RESOURCE_EXHAUSTED", [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel" }] }]],
    ];
    for (const [status, nome, details] of casos) {
      const fetch = vi.fn().mockResolvedValue(erroApi(status, nome, details));
      const e = await provedor(fetch).extrair(PEDIDO).catch((x) => x);
      expect(e, nome).toBeInstanceOf(ErroLlm);
      expect(e).toMatchObject({ codigo: "HTTP", status });
      expect(e.message).toContain(nome);
      expect(e.message).not.toContain("texto do usuário");
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it("402 (crédito pré-pago esgotado) → SEM_CREDITO 'sem crédito na API do Gemini', sem re-tentar", async () => {
    const fetch = vi.fn().mockResolvedValue(erroApi(402, "PAYMENT_REQUIRED"));
    const e = await provedor(fetch).extrair(PEDIDO).catch((x) => x);
    expect(e).toMatchObject({ codigo: "SEM_CREDITO", status: 402 });
    expect(e.message).toContain("sem crédito na API do Gemini");
    expect(e.message).not.toContain("texto do usuário");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("RESOURCE_EXHAUSTED com quota diária ou detalhe de billing → SEM_CREDITO; só pelo status/detalhes, nunca pela mensagem", async () => {
    const casos: unknown[][] = [
      [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests", quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }],
      [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "BILLING_DISABLED", domain: "googleapis.com" }],
      [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "CREDITS_EXHAUSTED" }],
    ];
    for (const details of casos) {
      const fetch = vi.fn().mockResolvedValue(erroApi(429, "RESOURCE_EXHAUSTED", details));
      const e = await provedor(fetch).extrair(PEDIDO).catch((x) => x);
      expect(e, JSON.stringify(details)).toMatchObject({ codigo: "SEM_CREDITO", status: 429 });
      expect(e.message).not.toContain("texto do usuário");
      expect(fetch).toHaveBeenCalledTimes(1);
    }
    // A palavra "billing"/"quota" só na mensagem não vale.
    const soTexto = vi.fn().mockResolvedValue(http(429, { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "billing quota exceeded per day" } }));
    await expect(provedor(soTexto).extrair(PEDIDO)).rejects.toMatchObject({ codigo: "HTTP", status: 429 });
  });

  it("billing desativado em 400/403 (FAILED_PRECONDITION/PERMISSION_DENIED com ErrorInfo BILLING_DISABLED) → SEM_CREDITO", async () => {
    for (const [code, status] of [
      [400, "FAILED_PRECONDITION"],
      [403, "PERMISSION_DENIED"],
    ] as const) {
      const fetch = vi.fn().mockResolvedValue(erroApi(code, status, [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "BILLING_DISABLED" }]));
      await expect(provedor(fetch).extrair(PEDIDO), status).rejects.toMatchObject({ codigo: "SEM_CREDITO", status: code });
    }
  });

  it("corpo de erro que não é JSON → HTTP com o status (sem copiar o texto)", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("texto do usuário", { status: 400, headers: { "content-type": "text/plain" } }));
    const e = await provedor(fetch).extrair(PEDIDO).catch((x) => x);
    expect(e).toMatchObject({ codigo: "HTTP", status: 400 });
    expect(e.message).not.toContain("texto do usuário");
  });

  it("5xx re-tenta uma vez e então funciona", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(erroApi(503, "UNAVAILABLE")).mockResolvedValueOnce(http(200, resposta(JSON.stringify(SAIDA))));
    await expect(provedor(fetch).extrair(PEDIDO)).resolves.toMatchObject({ bruto: SAIDA });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("5xx duas vezes → ErroLlm HTTP (no máximo 2 tentativas; o SDK não re-tenta sozinho)", async () => {
    const fetch = vi.fn().mockImplementation(async () => erroApi(500, "INTERNAL"));
    await expect(provedor(fetch).extrair(PEDIDO)).rejects.toMatchObject({ codigo: "HTTP", status: 500 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("erro de rede → REDE após 2 tentativas", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(provedor(fetch).extrair(PEDIDO)).rejects.toMatchObject({ codigo: "REDE" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("timeout → TIMEOUT após 2 tentativas", async () => {
    const fetch = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_, rejeitar) => init.signal?.addEventListener("abort", () => rejeitar(new DOMException("aborted", "AbortError")))),
    );
    await expect(provedor(fetch, 20).extrair(PEDIDO)).rejects.toMatchObject({ codigo: "TIMEOUT" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("bloqueio do prompt, finish de segurança, MAX_TOKENS e saída que não é JSON viram códigos próprios (com uso)", async () => {
    const casos: [Record<string, unknown>, string, string?][] = [
      [{ candidates: [], promptFeedback: { blockReason: "SAFETY" }, usageMetadata: USO }, "RECUSA", "SAFETY"],
      [{ promptFeedback: { blockReason: "PROHIBITED_CONTENT" }, usageMetadata: USO }, "RECUSA", "PROHIBITED_CONTENT"],
      [resposta(null, {}, { finishReason: "SAFETY" }), "RECUSA", "SAFETY"],
      [resposta(null, {}, { finishReason: "RECITATION" }), "RECUSA", "RECITATION"],
      [resposta(null, {}, { finishReason: "BLOCKLIST" }), "RECUSA", "BLOCKLIST"],
      [resposta(null, {}, { finishReason: "SPII" }), "RECUSA", "SPII"],
      [resposta('{"intencao":', {}, { finishReason: "MAX_TOKENS" }), "TRUNCADA", "MAX_TOKENS"],
      [resposta(null, {}, { finishReason: "OTHER" }), "FALHA_PROVEDOR", "OTHER"],
      [resposta("não é json"), "SEM_JSON"],
      [resposta(null), "SEM_JSON"],
      [{ candidates: [], usageMetadata: USO }, "SEM_JSON"],
    ];
    for (const [corpo, codigo, detalhe] of casos) {
      const fetch = vi.fn().mockResolvedValue(http(200, corpo));
      const e = await provedor(fetch).extrair(PEDIDO).catch((x) => x);
      expect(e, `${codigo} ${detalhe}`).toBeInstanceOf(ErroLlm);
      expect(e).toMatchObject({ codigo });
      if (detalhe) expect(e.message).toContain(detalhe);
      expect(e.uso).toMatchObject({ provedor: "gemini", tokensEntrada: 1500, tokensRaciocinio: 64 });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
});

describe("paraSchemaGemini (subconjunto de JSON Schema do responseJsonSchema)", () => {
  const PERMITIDAS = new Set(["type", "description", "enum", "anyOf", "properties", "additionalProperties", "required", "items", "minimum", "maximum", "title", "format"]);

  function chaves(no: unknown, saida = new Set<string>()): Set<string> {
    if (Array.isArray(no)) no.forEach((x) => chaves(x, saida));
    else if (no && typeof no === "object") {
      for (const [k, v] of Object.entries(no)) {
        saida.add(k);
        // Dentro de `properties` as chaves são nomes de campo, não palavras-chave.
        if (k === "properties") Object.values(v as object).forEach((x) => chaves(x, saida));
        else chaves(v, saida);
      }
    }
    return saida;
  }

  it("nulo simples vira type [T, 'null']; enum anulável continua anyOf; nada fora do subconjunto", () => {
    const s = paraSchemaGemini(JSON_SCHEMA_EXTRACAO) as { properties: Record<string, Record<string, unknown>> };
    expect(s.properties.oportunidade_id).toEqual({ type: ["string", "null"], description: JSON_SCHEMA_EXTRACAO.properties.oportunidade_id.description });
    expect(s.properties.campos.properties).toMatchObject({
      origem: { anyOf: [{ type: "string", enum: ["COLD_CALL", "RD", "INDICACAO", "EVENTO", "OUTRO"] }, { type: "null" }] },
    });
    for (const k of chaves(s)) expect(PERMITIDAS.has(k), k).toBe(true);
  });

  it("não altera o schema original (é usado pela OpenAI/Anthropic)", () => {
    const antes = JSON.stringify(JSON_SCHEMA_EXTRACAO);
    paraSchemaGemini(JSON_SCHEMA_EXTRACAO);
    expect(JSON.stringify(JSON_SCHEMA_EXTRACAO)).toBe(antes);
  });

  it("palavra-chave fora do subconjunto é descartada (ex.: pattern, $schema)", () => {
    expect(paraSchemaGemini({ $schema: "x", type: "object", properties: { a: { type: "string", pattern: "^x$", minLength: 1 } } })).toEqual({
      type: "object",
      properties: { a: { type: "string" } },
    });
  });

  it("trava os schemas convertidos (extração v2, classificação, resumo)", () => {
    expect(paraSchemaGemini(JSON_SCHEMA_EXTRACAO)).toMatchSnapshot("extracao");
    expect(paraSchemaGemini(JSON_SCHEMA_CLASSIFICACAO)).toMatchSnapshot("classificacao");
    expect(paraSchemaGemini(JSON_SCHEMA_RESUMO)).toMatchSnapshot("resumo");
  });
});

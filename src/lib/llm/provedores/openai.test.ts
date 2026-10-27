// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { FIXTURES_EXTRACAO } from "../fixtures/extracao";
import { JSON_SCHEMA_EXTRACAO } from "../prompts/extracao.v1";
import { ErroLlm } from "../tipos";
import { MAX_TOKENS_EXTRACAO, TIMEOUT_LLM_MS } from "./comum";
import { MODELO_OPENAI_PADRAO, criarProvedorOpenAI } from "./openai";

const PEDIDO = { sistema: "sistema", usuario: "usuario", schema: JSON_SCHEMA_EXTRACAO as unknown as Record<string, unknown> };
const SAIDA = FIXTURES_EXTRACAO[0].saida;

/** Corpo de `POST /v1/responses` no formato do SDK (`Response`). */
function resposta(conteudo: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  return {
    id: "resp_1",
    object: "response",
    created_at: 1_790_000_000,
    model: "gpt-6.1-sol",
    status: "completed",
    incomplete_details: null,
    error: null,
    output: [
      { id: "rs_1", type: "reasoning", summary: [] },
      { id: "msg_1", type: "message", role: "assistant", status: "completed", content: conteudo },
    ],
    usage: {
      input_tokens: 1500,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens: 260,
      output_tokens_details: { reasoning_tokens: 64 },
      total_tokens: 1760,
    },
    ...extra,
  };
}

const texto = (t: string) => ({ type: "output_text", text: t, annotations: [] });

function http(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json", "x-request-id": "req_1" } });
}

function erroApi(status: number, erro: { type: string; code: string | null; message: string }) {
  return http(status, { error: { ...erro, param: null } });
}

function provedor(fetch: ReturnType<typeof vi.fn>, timeoutMs?: number) {
  return criarProvedorOpenAI({
    apiKey: "sk-teste",
    modelo: "gpt-6.1-sol",
    fetch: fetch as unknown as typeof globalThis.fetch,
    ...(timeoutMs ? { timeoutMs } : {}),
  });
}

function corpoEnviado(fetch: ReturnType<typeof vi.fn>, i = 0) {
  return JSON.parse((fetch.mock.calls[i] as [string, RequestInit])[1].body as string);
}

describe("provedor OpenAI (SDK oficial, Responses API, fetch falso)", () => {
  it("o modelo padrão é o GPT-6.1 Sol (id conferido no SDK)", () => {
    expect(MODELO_OPENAI_PADRAO).toBe("gpt-6.1-sol");
  });

  it("manda model, instructions, input, structured output estrito, reasoning low e store false; devolve JSON + uso", async () => {
    const fetch = vi.fn().mockResolvedValue(http(200, resposta([texto(JSON.stringify(SAIDA))])));
    const r = await provedor(fetch).extrair(PEDIDO);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe("https://api.openai.com/v1/responses");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer sk-teste");
    expect(corpoEnviado(fetch)).toEqual({
      model: "gpt-6.1-sol",
      instructions: "sistema",
      input: "usuario",
      max_output_tokens: MAX_TOKENS_EXTRACAO,
      reasoning: { effort: "low" },
      text: { format: { type: "json_schema", name: "extracao", strict: true, schema: JSON_SCHEMA_EXTRACAO } },
      store: false,
    });
    expect(r.bruto).toEqual(SAIDA);
    expect(r.uso).toMatchObject({ provedor: "openai", modelo: "gpt-6.1-sol", tokensEntrada: 1500, tokensSaida: 260, tokensRaciocinio: 64 });
    expect(r.uso.ms).toBeGreaterThanOrEqual(0);
    expect(TIMEOUT_LLM_MS).toBe(30_000);
  });

  it("não manda parâmetros de sampling que modelo de raciocínio recusa", async () => {
    const fetch = vi.fn().mockResolvedValue(http(200, resposta([texto(JSON.stringify(SAIDA))])));
    await provedor(fetch).extrair(PEDIDO);
    const corpo = corpoEnviado(fetch);
    for (const proibido of ["temperature", "top_p", "top_logprobs", "max_tokens", "response_format", "tools", "stream"]) {
      expect(corpo).not.toHaveProperty(proibido);
    }
  });

  it("4xx (400, 401, 429 rate limit) não re-tenta e não copia o corpo da API", async () => {
    const casos: [number, string, string | null][] = [
      [400, "invalid_request_error", null],
      [401, "invalid_request_error", "invalid_api_key"],
      [429, "requests", "rate_limit_exceeded"],
    ];
    for (const [status, type, code] of casos) {
      const fetch = vi.fn().mockResolvedValue(erroApi(status, { type, code, message: "detalhe com texto do usuário" }));
      const e = await provedor(fetch).extrair(PEDIDO).catch((x) => x);
      expect(e).toBeInstanceOf(ErroLlm);
      expect(e).toMatchObject({ codigo: "HTTP", status });
      expect(String(e.message)).not.toContain("texto do usuário");
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it("429 insufficient_quota → SEM_CREDITO com motivo em português, sem re-tentar nem copiar a mensagem", async () => {
    const fetch = vi.fn().mockResolvedValue(
      erroApi(429, { type: "insufficient_quota", code: "insufficient_quota", message: "You exceeded your current quota, texto do usuário" }),
    );
    const e = await provedor(fetch).extrair(PEDIDO).catch((x) => x);
    expect(e).toBeInstanceOf(ErroLlm);
    expect(e).toMatchObject({ codigo: "SEM_CREDITO", status: 429 });
    expect(e.message).toContain("sem crédito na API da OpenAI");
    expect(e.message).not.toContain("quota");
    expect(e.message).not.toContain("texto do usuário");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("crédito é reconhecido pelo code OU pelo type (credit_balance_exhausted), nunca pela mensagem", async () => {
    const porCode = vi.fn().mockResolvedValue(erroApi(400, { type: "invalid_request_error", code: "credit_balance_exhausted", message: "x" }));
    await expect(provedor(porCode).extrair(PEDIDO)).rejects.toMatchObject({ codigo: "SEM_CREDITO", status: 400 });
    const porType = vi.fn().mockResolvedValue(erroApi(429, { type: "insufficient_quota", code: null, message: "x" }));
    await expect(provedor(porType).extrair(PEDIDO)).rejects.toMatchObject({ codigo: "SEM_CREDITO", status: 429 });
    // Frase de quota só na mensagem não vale.
    const soTexto = vi.fn().mockResolvedValue(erroApi(429, { type: "requests", code: "rate_limit_exceeded", message: "insufficient_quota" }));
    await expect(provedor(soTexto).extrair(PEDIDO)).rejects.toMatchObject({ codigo: "HTTP", status: 429 });
  });

  it("todos os códigos de saldo/limite de gasto documentados → SEM_CREDITO, sem re-tentar", async () => {
    const codigos = [
      "credit_balance_exhausted",
      "organization_spend_limit_exceeded",
      "project_spend_limit_exceeded",
      "organization_usage_limit_exceeded",
      "usage_limit_exceeded",
      "billing_not_active",
    ];
    for (const code of codigos) {
      const fetch = vi.fn().mockResolvedValue(erroApi(429, { type: "insufficient_quota", code, message: "texto do usuário" }));
      const e = await provedor(fetch).extrair(PEDIDO).catch((x) => x);
      expect(e, code).toMatchObject({ codigo: "SEM_CREDITO", status: 429 });
      expect(e.message).not.toContain("texto do usuário");
      expect(fetch).toHaveBeenCalledTimes(1);
      // Pelo code sozinho também (type genérico).
      const soCode = vi.fn().mockResolvedValue(erroApi(429, { type: "requests", code, message: "x" }));
      await expect(provedor(soCode).extrair(PEDIDO), code).rejects.toMatchObject({ codigo: "SEM_CREDITO" });
    }
  });

  it("5xx re-tenta uma vez e então funciona", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(erroApi(503, { type: "server_error", code: null, message: "x" }))
      .mockResolvedValueOnce(http(200, resposta([texto(JSON.stringify(SAIDA))])));
    await expect(provedor(fetch).extrair(PEDIDO)).resolves.toMatchObject({ bruto: SAIDA });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("5xx duas vezes → ErroLlm HTTP (no máximo 2 tentativas)", async () => {
    const fetch = vi.fn().mockImplementation(async () => erroApi(500, { type: "server_error", code: null, message: "x" }));
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

  it("status failed transitório (server_error, rate_limit_exceeded) re-tenta uma vez e então funciona", async () => {
    for (const code of ["server_error", "rate_limit_exceeded"]) {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(http(200, resposta([], { status: "failed", error: { code, message: "texto do usuário" } })))
        .mockResolvedValueOnce(http(200, resposta([texto(JSON.stringify(SAIDA))])));
      await expect(provedor(fetch).extrair(PEDIDO), code).resolves.toMatchObject({ bruto: SAIDA });
      expect(fetch).toHaveBeenCalledTimes(2);
    }
  });

  it("status failed transitório duas vezes → FALHA_PROVEDOR com o código (2 tentativas, com uso)", async () => {
    const fetch = vi.fn().mockImplementation(async () => http(200, resposta([], { status: "failed", error: { code: "server_error", message: "texto do usuário" } })));
    const e = await provedor(fetch).extrair(PEDIDO).catch((x) => x);
    expect(e).toBeInstanceOf(ErroLlm);
    expect(e).toMatchObject({ codigo: "FALHA_PROVEDOR" });
    expect(e.message).toContain("server_error");
    expect(e.message).not.toContain("texto do usuário");
    expect(e.uso).toMatchObject({ tokensEntrada: 1500 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("status failed com outro código → FALHA_PROVEDOR com o código, sem re-tentar; sem código → 'desconhecido'", async () => {
    const fetch = vi.fn().mockResolvedValue(http(200, resposta([], { status: "failed", error: { code: "invalid_prompt", message: "texto do usuário" } })));
    const e = await provedor(fetch).extrair(PEDIDO).catch((x) => x);
    expect(e).toMatchObject({ codigo: "FALHA_PROVEDOR" });
    expect(e.message).toContain("invalid_prompt");
    expect(e.message).not.toContain("texto do usuário");
    expect(fetch).toHaveBeenCalledTimes(1);
    const semCodigo = vi.fn().mockResolvedValue(http(200, resposta([], { status: "failed", error: null })));
    const e2 = await provedor(semCodigo).extrair(PEDIDO).catch((x) => x);
    expect(e2).toMatchObject({ codigo: "FALHA_PROVEDOR" });
    expect(e2.message).toContain("desconhecido");
    expect(semCodigo).toHaveBeenCalledTimes(1);
  });

  it("incompleta (max_output_tokens), recusa e saída que não é JSON viram códigos próprios (com uso)", async () => {
    const casos: [Record<string, unknown>, string][] = [
      [resposta([texto('{"intencao":')], { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }), "TRUNCADA"],
      [resposta([], { status: "incomplete", incomplete_details: { reason: "content_filter" } }), "RECUSA"],
      [resposta([{ type: "refusal", refusal: "não posso ajudar com texto do usuário" }]), "RECUSA"],
      [resposta([texto("não é json")]), "SEM_JSON"],
      [resposta([]), "SEM_JSON"],
    ];
    for (const [corpo, codigo] of casos) {
      const fetch = vi.fn().mockResolvedValue(http(200, corpo));
      const e = await provedor(fetch).extrair(PEDIDO).catch((x) => x);
      expect(e, codigo).toBeInstanceOf(ErroLlm);
      expect(e).toMatchObject({ codigo });
      expect(e.message).not.toContain("texto do usuário");
      expect(e.uso).toMatchObject({ tokensEntrada: 1500, tokensRaciocinio: 64 });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
});

type No = Record<string, unknown> & { properties?: Record<string, No>; anyOf?: No[] };

/** Subconjunto de JSON Schema que o strict mode da OpenAI aceita e que o schema usa. */
const CHAVES_ACEITAS = new Set(["type", "properties", "required", "additionalProperties", "anyOf", "enum", "description"]);

function nos(no: No, profundidade = 1): { no: No; profundidade: number }[] {
  const filhos = [...Object.values(no.properties ?? {}), ...(no.anyOf ?? [])];
  return [{ no, profundidade }, ...filhos.flatMap((f) => nos(f, profundidade + 1))];
}

describe("schema extracao.v1 no strict mode da OpenAI", () => {
  it("raiz é objeto, todo objeto estrito, nulos por anyOf e só palavras-chave aceitas", () => {
    const raiz = JSON_SCHEMA_EXTRACAO as unknown as No;
    expect(raiz.type).toBe("object");
    expect(raiz).not.toHaveProperty("anyOf");
    for (const { no, profundidade } of nos(raiz)) {
      expect(profundidade).toBeLessThanOrEqual(10);
      for (const chave of Object.keys(no)) expect(CHAVES_ACEITAS.has(chave), chave).toBe(true);
      if (no.type === "object") {
        expect(no.additionalProperties).toBe(false);
        expect([...((no.required as string[]) ?? [])].sort()).toEqual(Object.keys(no.properties ?? {}).sort());
      }
    }
  });
});

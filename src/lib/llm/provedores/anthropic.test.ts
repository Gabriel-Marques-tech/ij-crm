// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { FIXTURES_EXTRACAO } from "../fixtures/extracao";
import { JSON_SCHEMA_EXTRACAO } from "../prompts/extracao.v1";
import { ErroLlm } from "../tipos";
import { MAX_TOKENS_EXTRACAO, TIMEOUT_LLM_MS, criarProvedorAnthropic } from "./anthropic";

const PEDIDO = { sistema: "sistema", usuario: "usuario", schema: JSON_SCHEMA_EXTRACAO as unknown as Record<string, unknown> };

function mensagem(texto: string, extra: Record<string, unknown> = {}) {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: [{ type: "text", text: texto }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1200, output_tokens: 180, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    ...extra,
  };
}

function resposta(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json", "request-id": "req_1" } });
}

function provedor(fetch: ReturnType<typeof vi.fn>) {
  return criarProvedorAnthropic({ apiKey: "sk-ant-teste", modelo: "claude-haiku-5-5", fetch: fetch as unknown as typeof globalThis.fetch });
}

describe("provedor Anthropic (SDK oficial, fetch falso)", () => {
  it("manda model, system, structured output estrito e effort; devolve JSON parseado + uso", async () => {
    const fetch = vi.fn().mockResolvedValue(resposta(200, mensagem(JSON.stringify(FIXTURES_EXTRACAO[0].saida))));
    const r = await provedor(fetch).extrair(PEDIDO);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
    const corpo = JSON.parse(init.body as string);
    expect(corpo).toMatchObject({
      model: "claude-haiku-5-5",
      max_tokens: MAX_TOKENS_EXTRACAO,
      system: "sistema",
      messages: [{ role: "user", content: "usuario" }],
      output_config: { effort: "low", format: { type: "json_schema", schema: JSON_SCHEMA_EXTRACAO } },
    });
    expect(r.bruto).toEqual(FIXTURES_EXTRACAO[0].saida);
    expect(r.uso).toMatchObject({ provedor: "anthropic", modelo: "claude-haiku-5-5", tokensEntrada: 1200, tokensSaida: 180 });
    expect(TIMEOUT_LLM_MS).toBe(30_000);
  });

  it("4xx (400, 401, 429) não re-tenta", async () => {
    for (const status of [400, 401, 429]) {
      const fetch = vi.fn().mockResolvedValue(resposta(status, { type: "error", error: { type: "x", message: "detalhe com texto do usuário" } }));
      const e = await provedor(fetch).extrair(PEDIDO).catch((x) => x);
      expect(e).toBeInstanceOf(ErroLlm);
      expect(e).toMatchObject({ codigo: "HTTP", status });
      // O corpo da API nunca entra na mensagem do erro (que vai para log).
      expect(String(e.message)).not.toContain("texto do usuário");
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it("não manda parâmetros que o Haiku 5.5 recusa (sampling, budget_tokens, prefill)", async () => {
    const fetch = vi.fn().mockResolvedValue(resposta(200, mensagem(JSON.stringify(FIXTURES_EXTRACAO[0].saida))));
    await provedor(fetch).extrair(PEDIDO);
    const corpo = JSON.parse((fetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    for (const proibido of ["temperature", "top_p", "top_k", "thinking"]) expect(corpo).not.toHaveProperty(proibido);
    expect(corpo.messages.at(-1).role).toBe("user");
  });

  it("sem crédito (402 billing_error) → SEM_CREDITO com motivo em português, sem re-tentar", async () => {
    const fetch = vi.fn().mockResolvedValue(
      resposta(402, { type: "error", error: { type: "billing_error", message: "detalhe com texto do usuário" } }),
    );
    const e = await provedor(fetch).extrair(PEDIDO).catch((x) => x);
    expect(e).toBeInstanceOf(ErroLlm);
    expect(e).toMatchObject({ codigo: "SEM_CREDITO", status: 402 });
    expect(e.message).toContain("sem crédito na API da Anthropic");
    expect(e.message).not.toContain("texto do usuário");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("billing_error é reconhecido pelo tipo do corpo, mesmo com outro status", async () => {
    const fetch = vi.fn().mockResolvedValue(resposta(400, { type: "error", error: { type: "billing_error", message: "x" } }));
    await expect(provedor(fetch).extrair(PEDIDO)).rejects.toMatchObject({ codigo: "SEM_CREDITO", status: 400 });
  });

  it("400 invalid_request_error de saldo baixo (formato antigo) → SEM_CREDITO; outro 400 continua HTTP", async () => {
    const saldo = vi.fn().mockResolvedValue(
      resposta(400, { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } }),
    );
    const e = await provedor(saldo).extrair(PEDIDO).catch((x) => x);
    expect(e).toMatchObject({ codigo: "SEM_CREDITO", status: 400 });
    expect(e.message).not.toContain("credit balance");
    expect(saldo).toHaveBeenCalledTimes(1);

    const outro = vi.fn().mockResolvedValue(resposta(400, { type: "error", error: { type: "invalid_request_error", message: "max_tokens: too large" } }));
    await expect(provedor(outro).extrair(PEDIDO)).rejects.toMatchObject({ codigo: "HTTP", status: 400 });
    // Mesma frase com outro tipo/status não vale.
    const naoBate = vi.fn().mockResolvedValue(resposta(403, { type: "error", error: { type: "permission_error", message: "Your credit balance is too low" } }));
    await expect(provedor(naoBate).extrair(PEDIDO)).rejects.toMatchObject({ codigo: "HTTP", status: 403 });
  });

  it("5xx re-tenta uma vez e então funciona", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(resposta(529, { type: "error", error: { type: "overloaded_error", message: "x" } }))
      .mockResolvedValueOnce(resposta(200, mensagem(JSON.stringify(FIXTURES_EXTRACAO[0].saida))));
    await expect(provedor(fetch).extrair(PEDIDO)).resolves.toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("5xx duas vezes → ErroLlm HTTP (no máximo 2 tentativas)", async () => {
    const fetch = vi.fn().mockImplementation(async () => resposta(500, { type: "error", error: { type: "api_error", message: "x" } }));
    await expect(provedor(fetch).extrair(PEDIDO)).rejects.toMatchObject({ codigo: "HTTP", status: 500 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("erro de rede → REDE após 2 tentativas", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(provedor(fetch).extrair(PEDIDO)).rejects.toMatchObject({ codigo: "REDE" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("refusal, max_tokens e texto que não é JSON viram códigos próprios (com uso)", async () => {
    const casos: [Record<string, unknown>, string][] = [
      [mensagem("", { stop_reason: "refusal" }), "RECUSA"],
      [mensagem("{\"intencao\":", { stop_reason: "max_tokens" }), "TRUNCADA"],
      [mensagem("não é json"), "SEM_JSON"],
    ];
    for (const [corpo, codigo] of casos) {
      const fetch = vi.fn().mockResolvedValue(resposta(200, corpo));
      const e = await provedor(fetch).extrair(PEDIDO).catch((x) => x);
      expect(e).toMatchObject({ codigo });
      expect(e.uso).toMatchObject({ tokensEntrada: 1200 });
    }
  });
});

/**
 * Provedor Anthropic (SDK oficial `@anthropic-ai/sdk`), structured outputs
 * via `output_config.format` (JSON schema estrito).
 *
 * - Timeout por tentativa: 30s. O SDK roda com `maxRetries: 0`; a política é
 *   daqui: UMA nova tentativa só para 5xx, timeout e erro de rede. 4xx
 *   (inclusive 429) não re-tenta — a mensagem vai para `FALHA` e o
 *   reprocessamento (GAB-41) cuida depois. Saldo esgotado (`billing_error`)
 *   vira `SEM_CREDITO` ("sem crédito na API da Anthropic").
 * - Alternativa à OpenAI (padrão de produção, `openai.ts`), por
 *   `LLM_PROVEDOR=anthropic`. Modelo padrão: Claude Haiku 5.5 (Sonnet 5.5 por env).
 *   Não manda `temperature`/`top_p`/`top_k`, `thinking.budget_tokens` nem
 *   prefill de assistant (400 no Haiku 5.5); thinking adaptativo fica no padrão.
 * - `stop_reason` é checado antes do conteúdo: `refusal` (Haiku não tem
 *   fallback no servidor) e `max_tokens` viram `FALHA` com ref.
 * - `effort: "low"`: extração curta, latência de segundos no grupo. O
 *   benchmark (GAB-40) decide se sobe.
 * - Erros viram `ErroLlm` só com código/status: o corpo da resposta da API
 *   nunca vai para log.
 */
import Anthropic from "@anthropic-ai/sdk";
import { ErroLlm, type PedidoExtracao, type ProvedorLlm, type RespostaProvedor } from "../tipos";
import { MAX_TOKENS_EXTRACAO, TIMEOUT_LLM_MS, comRetentativa, type TraducaoErro } from "./comum";

export { MAX_TOKENS_EXTRACAO, TIMEOUT_LLM_MS } from "./comum";

type Opcoes = { apiKey: string; modelo: string; fetch?: typeof fetch };

/**
 * A API já respondeu saldo esgotado como 400 `invalid_request_error` (sem
 * `billing_error`). Fallback estreito: só esse status + tipo + a frase
 * conhecida. A mensagem é só testada, nunca logada nem copiada no erro.
 */
function saldoBaixoFormatoAntigo(e: InstanceType<typeof Anthropic.APIError>, status: number | undefined): boolean {
  if (status !== 400 || e.type !== "invalid_request_error") return false;
  const corpo = e.error as { error?: { message?: unknown } } | undefined;
  const msg = corpo?.error?.message;
  return typeof msg === "string" && /credit balance is too low/i.test(msg);
}

function traduzirErro(e: unknown): TraducaoErro {
  if (e instanceof Anthropic.APIConnectionTimeoutError) return { erro: new ErroLlm("TIMEOUT"), retentavel: true };
  if (e instanceof Anthropic.APIConnectionError) return { erro: new ErroLlm("REDE"), retentavel: true };
  if (e instanceof Anthropic.APIError) {
    const status = typeof e.status === "number" ? e.status : undefined;
    // Saldo esgotado: identificado pelo tipo do corpo (`billing_error`, 402),
    // nunca pela mensagem humana. Não re-tenta; reprocessa após recarga.
    if (e.type === "billing_error" || status === 402 || saldoBaixoFormatoAntigo(e, status)) {
      return { erro: new ErroLlm("SEM_CREDITO", { status, detalhe: "sem crédito na API da Anthropic" }), retentavel: false };
    }
    return { erro: new ErroLlm("HTTP", { status }), retentavel: status !== undefined && status >= 500 };
  }
  return { erro: new ErroLlm("REDE", { detalhe: { codigo: e instanceof Error ? e.name : typeof e } }), retentavel: false };
}

export function criarProvedorAnthropic({ apiKey, modelo, fetch }: Opcoes): ProvedorLlm {
  const cliente = new Anthropic({ apiKey, timeout: TIMEOUT_LLM_MS, maxRetries: 0, ...(fetch ? { fetch } : {}) });

  function chamar(pedido: PedidoExtracao): Promise<Anthropic.Message> {
    return comRetentativa(
      () =>
        cliente.messages.create({
          model: modelo,
          max_tokens: pedido.maxTokens ?? MAX_TOKENS_EXTRACAO,
          system: pedido.sistema,
          messages: [{ role: "user", content: pedido.usuario }],
          output_config: { effort: "low", format: { type: "json_schema", schema: pedido.schema } },
        }),
      traduzirErro,
    );
  }

  return {
    nome: "anthropic",
    async extrair(pedido): Promise<RespostaProvedor> {
      const inicio = performance.now();
      const resposta = await chamar(pedido);
      const uso = {
        provedor: "anthropic",
        modelo: resposta.model ?? modelo,
        tokensEntrada: resposta.usage.input_tokens + (resposta.usage.cache_read_input_tokens ?? 0) + (resposta.usage.cache_creation_input_tokens ?? 0),
        tokensSaida: resposta.usage.output_tokens,
        ms: Math.round(performance.now() - inicio),
      };
      if (resposta.stop_reason === "refusal") throw new ErroLlm("RECUSA", { uso });
      if (resposta.stop_reason === "max_tokens") throw new ErroLlm("TRUNCADA", { uso });
      const texto = resposta.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      if (!texto) throw new ErroLlm("SEM_JSON", { uso });
      try {
        return { bruto: JSON.parse(texto), uso };
      } catch {
        throw new ErroLlm("SEM_JSON", { uso });
      }
    },
  };
}

/**
 * Provedor OpenAI (SDK oficial `openai`, Responses API) — padrão de produção
 * (GAB-45): GPT-6.1 Sol com `reasoning.effort: "low"`. Espelha `anthropic.ts`:
 *
 * - Structured outputs estrito: `text.format = { type: "json_schema", strict:
 *   true }` com o MESMO `JSON_SCHEMA_EXTRACAO` (já no subconjunto que o strict
 *   mode aceita: todo objeto com `additionalProperties: false`, todos os campos
 *   em `required`, nulos por `anyOf` — `openai.test.ts` garante).
 * - Timeout/retentativa de `comum.ts`: 30s por tentativa, SDK com
 *   `maxRetries: 0`, uma nova tentativa só para 5xx, timeout e rede. 4xx
 *   (inclusive 429 de rate limit) não re-tenta.
 * - Sem crédito: códigos de saldo/limite de gasto (`SEM_CREDITO` abaixo) no
 *   `code` ou no `type` do corpo de erro → `SEM_CREDITO` ("sem crédito na API
 *   da OpenAI"). Nunca pela mensagem humana, que não é lida nem logada.
 * - Não manda `temperature`/`top_p` (modelo de raciocínio recusa); o
 *   raciocínio `low` é explícito. `store: false`: a OpenAI não guarda a
 *   resposta (texto do WhatsApp é dado pessoal).
 * - `status: "failed"` → `FALHA_PROVEDOR` com o `error.code`; `server_error`
 *   e `rate_limit_exceeded` re-tentam uma vez, como 5xx.
 * - `status: "incomplete"` (estourou `max_output_tokens`) → `TRUNCADA`;
 *   `content_filter` ou item `refusal` → `RECUSA`; texto que não é JSON →
 *   `SEM_JSON`. Todos levam o `uso` (tokens incl. raciocínio) para o log.
 */
import OpenAI from "openai";
import { ErroLlm, type PedidoExtracao, type ProvedorLlm, type RespostaProvedor, type UsoLlm } from "../tipos";
import { MAX_TOKENS_EXTRACAO, TIMEOUT_LLM_MS, comRetentativa, type TraducaoErro } from "./comum";

/** GPT-6.1 Sol — id conferido em `ChatModel` do SDK `openai` 7.43 (`resources/shared.d.ts`). */
export const MODELO_OPENAI_PADRAO = "gpt-6.1-sol";

/**
 * Saldo/limite de gasto esgotado: só `code`/`type` estruturados, nunca o texto.
 * Fontes (conferidas em 2026-10-26; códigos não confirmados, como
 * `billing_hard_limit_reached`, ficam de fora):
 * - https://developers.openai.com/api/docs/guides/error-codes — 429 com
 *   `credit_balance_exhausted`, `organization_spend_limit_exceeded`,
 *   `project_spend_limit_exceeded`, `organization_usage_limit_exceeded`;
 *   `insufficient_quota` como `error.type` dos erros de cobrança.
 * - SDK `openai` 7.43, `resources/beta/agents/agents.d.ts` (enum de códigos de
 *   erro): `billing_not_active`, `usage_limit_exceeded`, mesma família.
 */
const SEM_CREDITO = new Set([
  "insufficient_quota",
  "credit_balance_exhausted",
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
  "usage_limit_exceeded",
  "billing_not_active",
]);

/**
 * `status: "failed"` com estes `error.code` (enum de `ResponseError` no SDK) é
 * transitório: tratado como 5xx (uma nova tentativa). Os demais não re-tentam.
 */
const FALHA_TRANSITORIA = new Set(["server_error", "rate_limit_exceeded"]);

/** Resposta 200 com `status: "failed"`: vira erro dentro do laço de retentativa. */
class RespostaFalhou extends Error {
  constructor(
    readonly codigo: string,
    readonly resposta: OpenAI.Responses.Response,
  ) {
    super(`resposta failed ${codigo}`);
  }
}

type Opcoes = { apiKey: string; modelo: string; fetch?: typeof fetch; timeoutMs?: number };

function traduzirErro(e: unknown, uso: (r: OpenAI.Responses.Response) => UsoLlm): TraducaoErro {
  if (e instanceof RespostaFalhou) {
    // Só o código; `error.message` da resposta não é copiado.
    return { erro: new ErroLlm("FALHA_PROVEDOR", { detalhe: e.codigo, uso: uso(e.resposta) }), retentavel: FALHA_TRANSITORIA.has(e.codigo) };
  }
  if (e instanceof OpenAI.APIConnectionTimeoutError) return { erro: new ErroLlm("TIMEOUT"), retentavel: true };
  if (e instanceof OpenAI.APIConnectionError) return { erro: new ErroLlm("REDE"), retentavel: true };
  if (e instanceof OpenAI.APIError) {
    const status = typeof e.status === "number" ? e.status : undefined;
    // Só os campos estruturados do corpo; `e.message` carrega o texto da API.
    if ((e.code && SEM_CREDITO.has(e.code)) || (e.type && SEM_CREDITO.has(e.type))) {
      return { erro: new ErroLlm("SEM_CREDITO", { status, detalhe: "sem crédito na API da OpenAI" }), retentavel: false };
    }
    return { erro: new ErroLlm("HTTP", { status }), retentavel: status !== undefined && status >= 500 };
  }
  return { erro: new ErroLlm("REDE", { detalhe: e instanceof Error ? e.name : typeof e }), retentavel: false };
}

export function criarProvedorOpenAI({ apiKey, modelo, fetch, timeoutMs }: Opcoes): ProvedorLlm {
  const cliente = new OpenAI({ apiKey, timeout: timeoutMs ?? TIMEOUT_LLM_MS, maxRetries: 0, ...(fetch ? { fetch } : {}) });

  function chamar(pedido: PedidoExtracao, uso: (r: OpenAI.Responses.Response) => UsoLlm): Promise<OpenAI.Responses.Response> {
    return comRetentativa(
      async () => {
        const r = await cliente.responses.create({
          model: modelo,
          instructions: pedido.sistema,
          input: pedido.usuario,
          max_output_tokens: MAX_TOKENS_EXTRACAO,
          reasoning: { effort: "low" },
          text: { format: { type: "json_schema", name: "extracao", strict: true, schema: pedido.schema } },
          store: false,
        });
        if (r.status === "failed") throw new RespostaFalhou(r.error?.code ?? "desconhecido", r);
        return r;
      },
      (e) => traduzirErro(e, uso),
    );
  }

  return {
    nome: "openai",
    async extrair(pedido): Promise<RespostaProvedor> {
      const inicio = performance.now();
      const medir = (r: OpenAI.Responses.Response): UsoLlm => ({
        provedor: "openai",
        modelo: r.model ?? modelo,
        // `input_tokens` já inclui os em cache; `output_tokens` já inclui os de raciocínio.
        tokensEntrada: r.usage?.input_tokens ?? 0,
        tokensSaida: r.usage?.output_tokens ?? 0,
        tokensRaciocinio: r.usage?.output_tokens_details?.reasoning_tokens ?? 0,
        ms: Math.round(performance.now() - inicio),
      });
      const resposta = await chamar(pedido, medir);
      const uso = medir(resposta);
      if (resposta.status === "incomplete") {
        const motivo = resposta.incomplete_details?.reason;
        if (motivo === "content_filter") throw new ErroLlm("RECUSA", { uso, detalhe: motivo });
        throw new ErroLlm("TRUNCADA", { uso, detalhe: motivo ?? "incomplete" });
      }
      if (resposta.status && resposta.status !== "completed") throw new ErroLlm("FALHA_PROVEDOR", { uso, detalhe: `status=${resposta.status}` });
      let texto = "";
      for (const item of resposta.output ?? []) {
        if (item.type !== "message") continue;
        for (const parte of item.content) {
          // O texto da recusa pode ecoar a mensagem do usuário: não é copiado.
          if (parte.type === "refusal") throw new ErroLlm("RECUSA", { uso });
          if (parte.type === "output_text") texto += parte.text;
        }
      }
      if (!texto) throw new ErroLlm("SEM_JSON", { uso });
      try {
        return { bruto: JSON.parse(texto), uso };
      } catch {
        throw new ErroLlm("SEM_JSON", { uso });
      }
    },
  };
}

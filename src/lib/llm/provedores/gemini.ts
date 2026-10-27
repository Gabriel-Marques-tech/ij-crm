/**
 * Provedor Gemini (SDK oficial `@google/genai`, Gemini Developer API com
 * chave do Google AI Studio em `GEMINI_API_KEY`). Escolhido por
 * `LLM_PROVEDOR=gemini`; espelha `openai.ts`/`anthropic.ts`:
 *
 * - Structured output: `responseMimeType: "application/json"` +
 *   `responseJsonSchema` com o MESMO schema dos outros provedores, passado por
 *   `paraSchemaGemini` (subconjunto que a API aceita; ver abaixo).
 * - Raciocínio baixo só para quem pensa (`raciocinio`): 3.x →
 *   `thinkingLevel = LOW` (o 3.8 Flash não tem MINIMAL); 2.5 →
 *   `thinkingBudget` pequeno; 2.0 e aliases (`gemini-flash-latest`) → sem
 *   `thinkingConfig` (padrão do modelo). Sem `temperature`/`topP`/`topK`.
 * - Timeout/retentativa de `comum.ts`: 30s por tentativa (`httpOptions.timeout`
 *   é por tentativa no SDK), retentativa do SDK desligada explicitamente
 *   (`retryOptions.attempts = 1`) e uma nova tentativa só para 5xx, timeout e
 *   rede. 4xx (inclusive 429) não re-tenta.
 * - Sem crédito → `SEM_CREDITO` ("sem crédito na API do Gemini"); cota
 *   diária → `COTA_DIARIA`. Só por status HTTP / `error.status` / `details`
 *   estruturados do corpo — nunca pela `error.message`, que não é lida nem
 *   logada (ver `classificarCota`).
 * - A Gemini API (`generateContent`) não guarda a conversa para consulta: não
 *   existe equivalente ao `store: false` da OpenAI (o `store` do SDK é só da
 *   Interactions API, que não usamos). Retenção do lado do Google: runbook §10.
 * - `promptFeedback.blockReason` e finish de segurança → `RECUSA`;
 *   `MAX_TOKENS` → `TRUNCADA`; outro finish anormal → `FALHA_PROVEDOR`;
 *   texto que não é JSON → `SEM_JSON`. Todos levam o `uso` para o log.
 */
import { ApiError, GoogleGenAI, ThinkingLevel, type GenerateContentResponse, type ThinkingConfig } from "@google/genai";
import { ErroLlm, type PedidoExtracao, type ProvedorLlm, type RespostaProvedor, type UsoLlm } from "../tipos";
import { MAX_TOKENS_EXTRACAO, TIMEOUT_LLM_MS, comRetentativa, type TraducaoErro } from "./comum";

/**
 * Gemini 3.8 Flash. Id conferido em 2026-10-27 no union `Model` do SDK
 * `@google/genai` 2.31 (`dist/genai.d.ts`) e na lista oficial
 * https://ai.google.dev/gemini-api/docs/models ("stable", Flash mais recente).
 */
export const MODELO_GEMINI_PADRAO = "gemini-3.8-flash";

/** Orçamento de raciocínio dos modelos 2.5 (sem `thinkingLevel`). */
const ORCAMENTO_RACIOCINIO_25 = 1024;

// ------------------------------------------------------------------ schema

/**
 * Palavras-chave que o `responseJsonSchema` aceita (lista do próprio SDK,
 * `GenerateContentConfig.responseJsonSchema` em `genai.d.ts`). As que não
 * usamos ($ref, $defs, prefixItems...) ficam de fora de propósito.
 */
const PERMITIDAS = new Set(["type", "format", "title", "description", "enum", "items", "minItems", "maxItems", "minimum", "maximum", "anyOf", "properties", "additionalProperties", "required"]);

type No = Record<string, unknown>;
const ehNo = (v: unknown): v is No => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Converte o JSON schema estrito dos prompts (formato OpenAI/Anthropic) para
 * o subconjunto do Gemini, sem mexer no original: só descarta palavras-chave
 * fora da lista acima. Campo anulável continua `anyOf: [{ type: T }, { type:
 * "null" }]`: `anyOf` e `type` estão na lista do `responseJsonSchema` no SDK,
 * e a forma `type: [T, "null"]` só está documentada pelo Google para o
 * `response_format` da Interactions API, não para o `generateContent`. Sem
 * chave ainda, `pnpm llm:smoke` (runbook §10) confere os três schemas na API
 * real.
 */
export function paraSchemaGemini(schema: unknown): No {
  return converter(schema) as No;
}

function converter(no: unknown): unknown {
  if (Array.isArray(no)) return no.map(converter);
  if (!ehNo(no)) return no;
  const saida: No = {};
  for (const [k, v] of Object.entries(no)) {
    if (!PERMITIDAS.has(k)) continue;
    if (k === "properties" && ehNo(v)) saida.properties = Object.fromEntries(Object.entries(v).map(([campo, s]) => [campo, converter(s)]));
    else saida[k] = converter(v);
  }
  return saida;
}

// ------------------------------------------------------------------ erros

/**
 * Falta de crédito/billing (`SEM_CREDITO`), só por campos estruturados:
 * - HTTP 402: crédito pré-pago esgotado. Documentado pelo Google em
 *   https://ai.google.dev/gemini-api/docs/api-errors (`payment_required`, 402,
 *   "Prepay credit balance is depleted") e em
 *   https://ai.google.dev/gemini-api/docs/troubleshooting (402 para Prepay);
 * - `ErrorInfo.reason` de billing em qualquer status (`BILLING_DISABLED` é o
 *   motivo padrão do Google Cloud para billing desligado; os outros são
 *   defensivos, não documentados para esta API).
 *
 * Cota diária (`COTA_DIARIA`): 429 `RESOURCE_EXHAUSTED` com um detalhe
 * `google.rpc.QuotaFailure` cuja violação tem `quotaId` de período diário
 * (`...PerDay...`). Não é saldo: volta sozinha no dia seguinte. Quota por
 * minuto é rate limit comum → `HTTP 429`.
 */
const MOTIVOS_BILLING = new Set(["BILLING_DISABLED", "BILLING_NOT_ACTIVE", "CREDITS_EXHAUSTED", "PREPAY_CREDITS_EXHAUSTED"]);

type CorpoErro = { status?: string; details?: unknown[] };

/** O SDK põe o corpo JSON inteiro na `message` do `ApiError`; lemos só `status`/`details`. */
function corpoErro(e: ApiError): CorpoErro {
  try {
    const c = JSON.parse(e.message) as { error?: CorpoErro };
    return ehNo(c?.error) ? { status: typeof c.error.status === "string" ? c.error.status : undefined, details: Array.isArray(c.error.details) ? c.error.details : [] } : {};
  } catch {
    return {};
  }
}

const TIPO_QUOTA_FAILURE = "type.googleapis.com/google.rpc.QuotaFailure";
/** `quotaId` de cota diária, ex.: `GenerateRequestsPerDayPerProjectPerModel-FreeTier`. */
const QUOTA_ID_DIARIA = /^[A-Za-z]+PerDay(?:Per[A-Za-z]+)?(?:-[A-Za-z]+)?$/;

function classificarCota(status: number, corpo: CorpoErro): "SEM_CREDITO" | "COTA_DIARIA" | null {
  if (status === 402) return "SEM_CREDITO";
  const detalhes = (corpo.details ?? []).filter(ehNo);
  if (detalhes.some((d) => typeof d.reason === "string" && MOTIVOS_BILLING.has(d.reason))) return "SEM_CREDITO";
  if (status !== 429 || corpo.status !== "RESOURCE_EXHAUSTED") return null;
  const diaria = detalhes.some(
    (d) =>
      d["@type"] === TIPO_QUOTA_FAILURE &&
      Array.isArray(d.violations) &&
      d.violations.some((v) => ehNo(v) && typeof v.quotaId === "string" && QUOTA_ID_DIARIA.test(v.quotaId)),
  );
  return diaria ? "COTA_DIARIA" : null;
}

function traduzirErro(e: unknown): TraducaoErro {
  if (e instanceof ApiError) {
    const status = e.status;
    const corpo = corpoErro(e);
    const cota = classificarCota(status, corpo);
    if (cota === "SEM_CREDITO") return { erro: new ErroLlm("SEM_CREDITO", { status, detalhe: "sem crédito na API do Gemini" }), retentavel: false };
    if (cota === "COTA_DIARIA")
      return { erro: new ErroLlm("COTA_DIARIA", { status, detalhe: "cota diária do Gemini esgotada; volta no próximo dia ou aumente o limite no AI Studio" }), retentavel: false };
    return { erro: new ErroLlm("HTTP", { status, ...(corpo.status ? { detalhe: { codigo: corpo.status } } : {}) }), retentavel: status >= 500 };
  }
  const nome = e instanceof Error ? e.name : typeof e;
  // `httpOptions.timeout` aborta o fetch (AbortError/TimeoutError); fetch sem rede lança TypeError.
  if (nome === "AbortError" || nome === "TimeoutError") return { erro: new ErroLlm("TIMEOUT"), retentavel: true };
  if (e instanceof TypeError) return { erro: new ErroLlm("REDE"), retentavel: true };
  return { erro: new ErroLlm("REDE", { detalhe: { codigo: nome } }), retentavel: false };
}

// ------------------------------------------------------------------ provedor

/** Finish de bloqueio/segurança → RECUSA (enum `FinishReason` do SDK). */
const FINISH_RECUSA = new Set(["SAFETY", "RECITATION", "LANGUAGE", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY", "IMAGE_PROHIBITED_CONTENT", "IMAGE_RECITATION"]);

type Opcoes = { apiKey: string; modelo: string; fetch?: typeof fetch; timeoutMs?: number };

/**
 * `thinkingConfig` por família (doc "Thinking" do Gemini): 3.x aceita
 * `thinkingLevel`; 2.5 só `thinkingBudget`; 2.0 não pensa (mandar a config
 * daria 400). Alias sem versão (`gemini-flash-latest`) fica no padrão do modelo.
 */
function raciocinio(modelo: string): ThinkingConfig | undefined {
  const m = modelo.toLowerCase().replace(/^models\//, "");
  if (/^gemini-(?:[3-9]|\d{2,})(?:[.-]|$)/.test(m)) return { thinkingLevel: ThinkingLevel.LOW };
  if (/^gemini-2\.5-/.test(m)) return { thinkingBudget: ORCAMENTO_RACIOCINIO_25 };
  return undefined;
}

/**
 * Retentativa do SDK desligada de forma explícita: `attempts: 1` = só a
 * chamada original (`HttpRetryOptions` em `genai.d.ts`: "If 0 or 1, it means
 * no retries"; no código, `pRetry` com `retries: attempts - 1 = 0`). Sem
 * `retryOptions` o SDK 2.31 também não re-tenta (`apiCall`: `if
 * (!retryOptions) return runFetch()`), mas o padrão documentado é 5
 * tentativas — não dependemos disso. A política é a de `comum.ts`.
 */
const SEM_RETENTATIVA_SDK = { attempts: 1 } as const;

export function criarProvedorGemini({ apiKey, modelo, fetch, timeoutMs }: Opcoes): ProvedorLlm {
  const cliente = new GoogleGenAI({
    apiKey,
    httpOptions: { timeout: timeoutMs ?? TIMEOUT_LLM_MS, retryOptions: SEM_RETENTATIVA_SDK, ...(fetch ? { fetch } : {}) },
  });
  const pensar = raciocinio(modelo);

  return {
    nome: "gemini",
    async extrair(pedido: PedidoExtracao): Promise<RespostaProvedor> {
      const inicio = performance.now();
      const resposta: GenerateContentResponse = await comRetentativa(
        () =>
          cliente.models.generateContent({
            model: modelo,
            contents: pedido.usuario,
            config: {
              systemInstruction: pedido.sistema,
              maxOutputTokens: pedido.maxTokens ?? MAX_TOKENS_EXTRACAO,
              responseMimeType: "application/json",
              responseJsonSchema: paraSchemaGemini(pedido.schema),
              ...(pensar ? { thinkingConfig: pensar } : {}),
            },
          }),
        traduzirErro,
      );
      const u = resposta.usageMetadata;
      const pensamento = u?.thoughtsTokenCount ?? 0;
      const uso: UsoLlm = {
        provedor: "gemini",
        modelo: resposta.modelVersion ?? modelo,
        tokensEntrada: u?.promptTokenCount ?? 0,
        // Como na OpenAI: saída inclui o raciocínio (o Gemini conta `thoughtsTokenCount` à parte de `candidatesTokenCount`).
        tokensSaida: (u?.candidatesTokenCount ?? 0) + pensamento,
        tokensRaciocinio: pensamento,
        ms: Math.round(performance.now() - inicio),
      };

      const bloqueio = resposta.promptFeedback?.blockReason;
      if (bloqueio) throw new ErroLlm("RECUSA", { uso, detalhe: { codigo: bloqueio } });
      const candidato = resposta.candidates?.[0];
      const fim = candidato?.finishReason;
      if (fim && FINISH_RECUSA.has(fim)) throw new ErroLlm("RECUSA", { uso, detalhe: { codigo: fim } });
      if (fim === "MAX_TOKENS") throw new ErroLlm("TRUNCADA", { uso, detalhe: { codigo: fim } });
      if (fim && fim !== "STOP" && fim !== "FINISH_REASON_UNSPECIFIED") throw new ErroLlm("FALHA_PROVEDOR", { uso, detalhe: { codigo: fim } });

      // Partes `thought` (resumo do raciocínio) não são a resposta.
      const texto = (candidato?.content?.parts ?? [])
        .filter((p) => !p.thought && typeof p.text === "string")
        .map((p) => p.text)
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

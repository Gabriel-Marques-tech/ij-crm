/**
 * Provedor Gemini (SDK oficial `@google/genai`, Gemini Developer API com
 * chave do Google AI Studio em `GEMINI_API_KEY`). Escolhido por
 * `LLM_PROVEDOR=gemini`; espelha `openai.ts`/`anthropic.ts`:
 *
 * - Structured output: `responseMimeType: "application/json"` +
 *   `responseJsonSchema` com o MESMO schema dos outros provedores, passado por
 *   `paraSchemaGemini` (subconjunto que a API aceita; ver abaixo).
 * - Raciocínio baixo: `thinkingConfig.thinkingLevel = LOW` (família 3.x; o
 *   3.8 Flash não tem MINIMAL). Modelos 2.x não têm `thinkingLevel` e usam
 *   `thinkingBudget` pequeno. Sem `temperature`/`topP`/`topK`.
 * - Timeout/retentativa de `comum.ts`: 30s por tentativa (`httpOptions.timeout`
 *   é por tentativa no SDK), sem `retryOptions` (o SDK não re-tenta) e uma nova
 *   tentativa só para 5xx, timeout e rede. 4xx (inclusive 429) não re-tenta.
 * - Sem crédito → `SEM_CREDITO` ("sem crédito na API do Gemini"), só por
 *   status HTTP / `error.status` / `details` estruturados do corpo — nunca
 *   pela `error.message`, que não é lida nem logada (ver `semCredito`).
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

/** Orçamento de raciocínio dos modelos 2.x (sem `thinkingLevel`). */
const ORCAMENTO_RACIOCINIO_2X = 1024;

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
 * o subconjunto do Gemini, sem mexer no original:
 * - `anyOf: [{ type: T }, { type: "null" }]` → `type: [T, "null"]` (forma
 *   documentada pelo Google para campo anulável, evita `anyOf` em massa, que
 *   a API recusa em schemas grandes). Com `enum` (ex.: `origem`) continua
 *   `anyOf` — `type: [string, null]` + `enum` sem null rejeitaria o null.
 * - Palavras-chave fora do subconjunto são descartadas.
 */
export function paraSchemaGemini(schema: unknown): No {
  return converter(schema) as No;
}

function converter(no: unknown): unknown {
  if (Array.isArray(no)) return no.map(converter);
  if (!ehNo(no)) return no;
  const anulavel = anulavelSimples(no.anyOf);
  const saida: No = {};
  for (const [k, v] of Object.entries(no)) {
    if (!PERMITIDAS.has(k)) continue;
    if (k === "anyOf" && anulavel) {
      saida.type = [anulavel, "null"];
      continue;
    }
    if (k === "properties" && ehNo(v)) saida.properties = Object.fromEntries(Object.entries(v).map(([campo, s]) => [campo, converter(s)]));
    else saida[k] = converter(v);
  }
  return saida;
}

/** `[{ type: "string" }, { type: "null" }]` (só `type`, em qualquer ordem) → "string"; senão null. */
function anulavelSimples(anyOf: unknown): string | null {
  if (!Array.isArray(anyOf) || anyOf.length !== 2 || !anyOf.every(ehNo)) return null;
  const outro = anyOf.find((s) => s.type !== "null");
  const temNulo = anyOf.some((s) => s.type === "null" && Object.keys(s).length === 1);
  if (!temNulo || !outro || Object.keys(outro).length !== 1 || typeof outro.type !== "string") return null;
  return outro.type;
}

// ------------------------------------------------------------------ erros

/**
 * Falta de crédito/billing, só por campos estruturados:
 * - HTTP 402 (`payment_required`: crédito pré-pago do AI Studio esgotado —
 *   https://ai.google.dev/gemini-api/docs/api-errors);
 * - `ErrorInfo.reason` de billing em qualquer status (`BILLING_DISABLED` é o
 *   motivo padrão do Google Cloud para billing desligado; `CREDITS_EXHAUSTED`
 *   cobre o pré-pago se vier como 429);
 * - 429 `RESOURCE_EXHAUSTED` com `QuotaFailure` de quota DIÁRIA (`quotaId`
 *   com "PerDay": o free tier acabou e só volta amanhã). Quota por minuto é
 *   rate limit comum → `HTTP 429`.
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

function semCredito(status: number, corpo: CorpoErro): boolean {
  if (status === 402) return true;
  const detalhes = (corpo.details ?? []).filter(ehNo);
  if (detalhes.some((d) => typeof d.reason === "string" && MOTIVOS_BILLING.has(d.reason))) return true;
  if (corpo.status !== "RESOURCE_EXHAUSTED") return false;
  return detalhes.some(
    (d) => Array.isArray(d.violations) && d.violations.some((v) => ehNo(v) && typeof v.quotaId === "string" && v.quotaId.includes("PerDay")),
  );
}

function traduzirErro(e: unknown): TraducaoErro {
  if (e instanceof ApiError) {
    const status = e.status;
    const corpo = corpoErro(e);
    if (semCredito(status, corpo)) return { erro: new ErroLlm("SEM_CREDITO", { status, detalhe: "sem crédito na API do Gemini" }), retentavel: false };
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

function raciocinio(modelo: string): ThinkingConfig {
  return /^gemini-2\./.test(modelo) ? { thinkingBudget: ORCAMENTO_RACIOCINIO_2X } : { thinkingLevel: ThinkingLevel.LOW };
}

export function criarProvedorGemini({ apiKey, modelo, fetch, timeoutMs }: Opcoes): ProvedorLlm {
  const cliente = new GoogleGenAI({ apiKey, httpOptions: { timeout: timeoutMs ?? TIMEOUT_LLM_MS, ...(fetch ? { fetch } : {}) } });

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
              thinkingConfig: raciocinio(modelo),
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

/**
 * Camada única de LLM (design doc §4.4):
 * - `extrairAtualizacao(texto, contexto)` → saída estruturada validada;
 * - `classificar(texto)` → `{ relevante, confianca }` (stub nesta fatia: só
 *   mensagens com `#crm` chegam aqui; o classificador real é GAB-39).
 *
 * Provedor por `LLM_PROVEDOR` (`openai` padrão | `anthropic` | `mock`). Cada
 * chamada loga provedor, modelo, versão do prompt, latência e tokens (incl.
 * raciocínio) — NUNCA o texto.
 */
import { ConfigInvalida, chaveAnthropic, chaveOpenAI, modeloExtracao, provedorLlm } from "@/lib/config/env";
import {
  JSON_SCHEMA_EXTRACAO,
  PROMPT_SISTEMA,
  VERSAO_EXTRACAO,
  esquemaExtracao,
  montarMensagemUsuario,
  type ContextoExtracao,
  type Extracao,
} from "./prompts/extracao.v2";
import { criarProvedorAnthropic } from "./provedores/anthropic";
import { criarProvedorMock } from "./provedores/mock";
import { criarProvedorOpenAI } from "./provedores/openai";
import { ErroLlm, type ProvedorLlm, type UsoLlm } from "./tipos";

export { ErroLlm } from "./tipos";
export type { ContextoExtracao, Extracao } from "./prompts/extracao.v2";

export type ResultadoExtracao = { extracao: Extracao; bruto: unknown; uso: UsoLlm; versao: string };

/** Provedor configurado no ambiente. Lança `ErroLlm` (PROVEDOR_INVALIDO / SEM_CHAVE). */
export function provedorConfigurado(): ProvedorLlm {
  let nome: ReturnType<typeof provedorLlm>;
  try {
    nome = provedorLlm();
  } catch (e) {
    if (e instanceof ConfigInvalida) throw new ErroLlm("PROVEDOR_INVALIDO", { detalhe: e.message });
    throw e;
  }
  if (nome === "mock") return criarProvedorMock();
  if (nome === "openai") {
    const apiKey = chaveOpenAI();
    if (!apiKey) throw new ErroLlm("SEM_CHAVE", { detalhe: "OPENAI_API_KEY ausente" });
    const modelo = modeloExtracao("openai");
    if (modelo.startsWith("claude-")) throw modeloTrocado(modelo, "openai");
    return criarProvedorOpenAI({ apiKey, modelo });
  }
  if (nome === "anthropic") {
    const apiKey = chaveAnthropic();
    if (!apiKey) throw new ErroLlm("SEM_CHAVE", { detalhe: "ANTHROPIC_API_KEY ausente" });
    const modelo = modeloExtracao("anthropic");
    if (!modelo.startsWith("claude-")) throw modeloTrocado(modelo, "anthropic");
    return criarProvedorAnthropic({ apiKey, modelo });
  }
  throw new ErroLlm("PROVEDOR_INVALIDO", { detalhe: "LLM_PROVEDOR deve ser openai, anthropic ou mock" });
}

/** `.env` trocou o provedor e esqueceu o modelo: falha clara em vez de um 404 da API por mensagem. */
function modeloTrocado(modelo: string, provedor: string): ErroLlm {
  return new ErroLlm("PROVEDOR_INVALIDO", { detalhe: `LLM_EXTRACAO_MODELO=${modelo} não é modelo do provedor ${provedor}` });
}

function logUso(uso: UsoLlm | undefined, ref: string, resultado: string) {
  if (!uso) return console.info(`[llm] extracao ref=${ref} versao=${VERSAO_EXTRACAO} ${resultado}`);
  console.info(
    `[llm] extracao ref=${ref} provedor=${uso.provedor} modelo=${uso.modelo} versao=${VERSAO_EXTRACAO} ms=${uso.ms} tokens_in=${uso.tokensEntrada} tokens_out=${uso.tokensSaida}${uso.tokensRaciocinio === undefined ? "" : ` tokens_reasoning=${uso.tokensRaciocinio}`} ${resultado}`,
  );
}

/**
 * Uma chamada, saída validada pelo zod. `ref` (id da MensagemBruta) só para
 * correlacionar o log. Lança `ErroLlm`: SAIDA_INVALIDA leva o `bruto` junto
 * (para gravar em `resultado_llm` e depurar).
 */
export async function extrairAtualizacao(
  texto: string,
  contexto: ContextoExtracao,
  opts: { ref?: string; provedor?: ProvedorLlm } = {},
): Promise<ResultadoExtracao> {
  const ref = opts.ref ?? "-";
  let provedor: ProvedorLlm;
  try {
    provedor = opts.provedor ?? provedorConfigurado();
  } catch (e) {
    logUso(undefined, ref, `erro=${e instanceof ErroLlm ? e.codigo : "INESPERADO"}`);
    throw e;
  }
  let resposta;
  try {
    resposta = await provedor.extrair({ sistema: PROMPT_SISTEMA, usuario: montarMensagemUsuario(texto, contexto), schema: JSON_SCHEMA_EXTRACAO });
  } catch (e) {
    logUso(e instanceof ErroLlm ? e.uso : undefined, ref, `erro=${e instanceof ErroLlm ? e.codigo : "INESPERADO"}`);
    throw e;
  }
  const r = esquemaExtracao.safeParse(resposta.bruto);
  if (!r.success) {
    // Só os caminhos dos campos (nunca valores) vão para o detalhe/log.
    const caminhos = [...new Set(r.error.issues.map((i) => i.path.join(".") || "(raiz)"))].slice(0, 5).join(",");
    logUso(resposta.uso, ref, `erro=SAIDA_INVALIDA campos=${caminhos}`);
    throw new ErroLlm("SAIDA_INVALIDA", { bruto: resposta.bruto, uso: resposta.uso, detalhe: caminhos });
  }
  logUso(resposta.uso, ref, "ok");
  return { extracao: r.data, bruto: resposta.bruto, uso: resposta.uso, versao: VERSAO_EXTRACAO };
}

/**
 * Classificador barato (passo 4 do §4.3). Stub desta fatia: a ingestão só
 * persiste mensagens com `#crm`, então tudo que chega é relevante. GAB-39
 * pluga o modelo real atrás desta mesma assinatura.
 */
export async function classificar(texto: string): Promise<{ relevante: boolean; confianca: number }> {
  void texto;
  return { relevante: true, confianca: 1 };
}

/**
 * Classificador de mensagens SEM `#crm` (GAB-39; design doc §4.3 passo 4, §4.4).
 *
 * `classificar(texto, contextoCurto) → { relevante, confianca }` sobre o
 * mesmo provedor da extração (`LLM_PROVEDOR`; produção: GPT-6.1 Sol com
 * raciocínio `low`), prompt curto e JSON schema estrito de 2 campos. Mesmo
 * timeout/retentativa/mapeamento de erro (`provedores/comum.ts`). O mock é
 * um stub determinístico pelas fixtures (`fixtures/classificacao.ts`).
 *
 * Loga provedor, modelo, versão, latência, tokens e a decisão — NUNCA o texto.
 * Lança `ErroLlm`; quem decide o que fazer com a falha é `whatsapp/sem-tag.ts`.
 */
import { limiarClassificador } from "@/lib/config/env";
import { registrarLogLlm } from "@/lib/logs/tecnicos";
import { provedorConfigurado } from "./extracao";
import {
  JSON_SCHEMA_CLASSIFICACAO,
  MAX_TOKENS_CLASSIFICACAO,
  PROMPT_SISTEMA_CLASSIFICACAO,
  VERSAO_CLASSIFICACAO,
  esquemaClassificacao,
  montarMensagemClassificacao,
  type Classificacao,
} from "./prompts/classificacao.v1";
import { ErroLlm, type ProvedorLlm, type UsoLlm } from "./tipos";

export type ContextoClassificacao = { respondendoA: string | null };
export type ResultadoClassificacao = Classificacao & { uso: UsoLlm; versao: string };

/** Log do servidor + linha em `log_llm` (Admin → Logs, GAB-42). `status` = "ok" ou o código. Nunca o texto. */
async function log(uso: UsoLlm | undefined, ref: string, resultado: string, status: string) {
  const base = `[llm] classificacao ref=${ref}`;
  if (!uso) console.info(`${base} versao=${VERSAO_CLASSIFICACAO} ${resultado}`);
  else
    console.info(
      `${base} provedor=${uso.provedor} modelo=${uso.modelo} versao=${VERSAO_CLASSIFICACAO} ms=${uso.ms} tokens_in=${uso.tokensEntrada} tokens_out=${uso.tokensSaida}${uso.tokensRaciocinio === undefined ? "" : ` tokens_reasoning=${uso.tokensRaciocinio}`} max_out=${MAX_TOKENS_CLASSIFICACAO} ${resultado}`,
    );
  await registrarLogLlm({ operacao: "classificacao", uso, status, ref: ref === "-" ? null : ref });
}

/** TRUNCADA ganha uma nova tentativa (5xx/timeout/rede já re-tentam no provedor). */
const TENTATIVAS_TRUNCADA = 2;

const codigo = (e: unknown) => (e instanceof ErroLlm ? e.codigo : "INESPERADO");

export async function classificar(
  texto: string,
  contexto: ContextoClassificacao,
  opts: { ref?: string; provedor?: ProvedorLlm } = {},
): Promise<ResultadoClassificacao> {
  const ref = opts.ref ?? "-";
  let provedor: ProvedorLlm;
  try {
    provedor = opts.provedor ?? provedorConfigurado("classificacao");
  } catch (e) {
    await log(undefined, ref, `erro=${codigo(e)}`, codigo(e));
    throw e;
  }
  const pedido = {
    nome: "classificacao",
    sistema: PROMPT_SISTEMA_CLASSIFICACAO,
    usuario: montarMensagemClassificacao(texto, contexto),
    schema: JSON_SCHEMA_CLASSIFICACAO,
    maxTokens: MAX_TOKENS_CLASSIFICACAO,
  };
  let resposta;
  for (let tentativa = 1; ; tentativa++) {
    try {
      resposta = await provedor.extrair(pedido);
      break;
    } catch (e) {
      await log(e instanceof ErroLlm ? e.uso : undefined, ref, `erro=${codigo(e)}`, codigo(e));
      // Raciocínio variável pode estourar o teto uma vez; a 2ª costuma caber.
      if (e instanceof ErroLlm && e.codigo === "TRUNCADA" && tentativa < TENTATIVAS_TRUNCADA) continue;
      throw e;
    }
  }
  const r = esquemaClassificacao.safeParse(resposta.bruto);
  if (!r.success) {
    await log(resposta.uso, ref, "erro=SAIDA_INVALIDA", "SAIDA_INVALIDA");
    throw new ErroLlm("SAIDA_INVALIDA", { uso: resposta.uso });
  }
  await log(resposta.uso, ref, `relevante=${r.data.relevante} confianca=${r.data.confianca}`, "ok");
  return { ...r.data, uso: resposta.uso, versao: VERSAO_CLASSIFICACAO };
}

/** Abaixo do limiar (ou não relevante) → descarta sem persistir. */
export function deveDescartar(c: Classificacao): boolean {
  return !c.relevante || c.confianca < limiarClassificador();
}

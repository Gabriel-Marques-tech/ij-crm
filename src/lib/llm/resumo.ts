/**
 * Resumo da janela de 12 h de um vendedor (GAB-49) — uma chamada ao mesmo
 * provedor da extração (`provedorConfigurado`; produção: GPT-6.1 Sol com
 * raciocínio `low`, JSON schema estrito de 1 campo). Mesmo timeout,
 * retentativa e tradução de erro dos provedores (`provedores/comum.ts`).
 *
 * Loga provedor, modelo, versão, latência e tokens — NUNCA o texto. Lança
 * `ErroLlm`; quem decide o que fazer com a falha (seguir sem resumo) é
 * `contexto/resumo.ts`.
 */
import { provedorConfigurado } from "./extracao";
import {
  JSON_SCHEMA_RESUMO,
  MAX_TOKENS_RESUMO,
  PROMPT_SISTEMA_RESUMO,
  VERSAO_RESUMO,
  esquemaResumo,
  montarMensagemResumo,
  resumoFinal,
  type CardResumo,
} from "./prompts/resumo.v1";
import type { EntradaHistorico } from "./prompts/extracao.v2";
import { ErroLlm, type ProvedorLlm, type UsoLlm } from "./tipos";

export type ResultadoResumo = { resumo: string; uso: UsoLlm; versao: string };

function log(uso: UsoLlm | undefined, ref: string, resultado: string) {
  const base = `[llm] resumo ref=${ref}`;
  if (!uso) return console.info(`${base} versao=${VERSAO_RESUMO} ${resultado}`);
  console.info(
    `${base} provedor=${uso.provedor} modelo=${uso.modelo} versao=${VERSAO_RESUMO} ms=${uso.ms} tokens_in=${uso.tokensEntrada} tokens_out=${uso.tokensSaida}${uso.tokensRaciocinio === undefined ? "" : ` tokens_reasoning=${uso.tokensRaciocinio}`} ${resultado}`,
  );
}

const codigo = (e: unknown) => (e instanceof ErroLlm ? e.codigo : "INESPERADO");

export async function resumirJanela(
  entrada: { vendedor: string; mensagens: EntradaHistorico[]; cards: CardResumo[] },
  opts: { ref?: string; provedor?: ProvedorLlm } = {},
): Promise<ResultadoResumo> {
  const ref = opts.ref ?? "-";
  let provedor: ProvedorLlm;
  try {
    provedor = opts.provedor ?? provedorConfigurado();
  } catch (e) {
    log(undefined, ref, `erro=${codigo(e)}`);
    throw e;
  }
  let resposta;
  try {
    resposta = await provedor.extrair({
      nome: "resumo",
      sistema: PROMPT_SISTEMA_RESUMO,
      usuario: montarMensagemResumo(entrada),
      schema: JSON_SCHEMA_RESUMO,
      maxTokens: MAX_TOKENS_RESUMO,
    });
  } catch (e) {
    log(e instanceof ErroLlm ? e.uso : undefined, ref, `erro=${codigo(e)}`);
    throw e;
  }
  const r = esquemaResumo.safeParse(resposta.bruto);
  if (!r.success) {
    log(resposta.uso, ref, "erro=SAIDA_INVALIDA");
    throw new ErroLlm("SAIDA_INVALIDA", { uso: resposta.uso });
  }
  const resumo = resumoFinal(r.data.resumo);
  log(resposta.uso, ref, `ok chars=${resumo.length}`);
  return { resumo, uso: resposta.uso, versao: VERSAO_RESUMO };
}

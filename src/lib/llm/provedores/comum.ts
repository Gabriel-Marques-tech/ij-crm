/**
 * Política de chamada comum aos provedores reais (Anthropic, OpenAI):
 * timeout de 30s por tentativa, SDK com `maxRetries: 0` e no máximo 2
 * tentativas — a segunda só quando o erro traduzido é `retentavel` (5xx,
 * timeout, rede). 4xx (inclusive 429) e falta de crédito não re-tentam.
 */
import { ErroLlm } from "../tipos";

export const TIMEOUT_LLM_MS = 30_000;
export const MAX_TOKENS_EXTRACAO = 8_000;
export const TENTATIVAS_LLM = 2;

/** Saída do tradutor de erro de cada SDK. `erro.message` só tem código/status. */
export type TraducaoErro = { erro: ErroLlm; retentavel: boolean };

export async function comRetentativa<T>(chamada: () => Promise<T>, traduzir: (e: unknown) => TraducaoErro): Promise<T> {
  let ultimo: ErroLlm | undefined;
  for (let i = 0; i < TENTATIVAS_LLM; i++) {
    try {
      return await chamada();
    } catch (e) {
      const { erro, retentavel } = traduzir(e);
      ultimo = erro;
      if (!retentavel) throw erro;
    }
  }
  throw ultimo ?? new ErroLlm("REDE");
}

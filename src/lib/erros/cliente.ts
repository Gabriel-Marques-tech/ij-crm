/**
 * Lado cliente das falhas de server action. Duas origens, mensagens distintas:
 * - a action RESPONDEU com erro: de regra (texto específico) ou `INESPERADO`
 *   (exceção no servidor, já logada lá com a `ref` que mostramos);
 * - a CHAMADA falhou no cliente (offline, servidor fora): "sem conexão".
 * Como as actions capturam toda exceção (`comTratamento`), uma rejeição aqui
 * só pode ser de transporte.
 */

export type FalhaUI = { texto: string; ref?: string };

export type RespostaAcao = { ok?: boolean; erro?: string; ref?: string } | undefined | void;

export const FALHA_CONEXAO: FalhaUI = { texto: "Sem conexão com o servidor. Verifique a rede e tente de novo." };

/** `acao` no infinitivo, minúsculo: "criar o card", "salvar", "registrar a nota". */
export function falhaDe(r: RespostaAcao, acao: string): FalhaUI | null {
  if (!r || !r.erro) return null;
  if (r.erro === "INESPERADO") return { texto: `Não foi possível ${acao}. Erro no servidor.`, ref: r.ref };
  return { texto: r.erro };
}

export async function executarAcao(chamar: () => Promise<RespostaAcao>, acao: string): Promise<FalhaUI | null> {
  let r: RespostaAcao;
  try {
    r = await chamar();
  } catch {
    return FALHA_CONEXAO;
  }
  return falhaDe(r, acao);
}

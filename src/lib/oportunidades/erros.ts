/** Erros de regra do serviço de oportunidades (viram texto em português na action). */
import type { ErroDadosTerminal } from "./terminal-regras";

export type ErroOportunidade =
  | "CARD_NAO_ENCONTRADO"
  | "PIPELINE_NAO_ENCONTRADO"
  | "FASE_NAO_ENCONTRADA"
  | "FASE_ARQUIVADA"
  | "FASE_DE_OUTRO_PIPELINE"
  | "FASE_TERMINAL"
  | "CONFLITO_CONCORRENTE"
  | "TITULO_INVALIDO"
  | "RESPONSAVEL_INVALIDO"
  | "NOTA_INVALIDA"
  | "FASE_INICIAL_PROJETOS_INDISPONIVEL"
  | ErroDadosTerminal;

/** Lançado dentro da transação: aborta (rollback) e vira `{ ok: false, erro }`. */
export class ErroDeRegra extends Error {
  constructor(readonly erro: ErroOportunidade) {
    super(erro);
  }
}

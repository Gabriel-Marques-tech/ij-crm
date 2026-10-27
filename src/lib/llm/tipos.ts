/**
 * Contrato dos provedores de LLM (design doc §4.4): o pipeline só conhece
 * esta interface; OpenAI (padrão de produção, GAB-45), Anthropic e mock
 * ficam atrás dela, escolhidos por `LLM_PROVEDOR`.
 */

export type UsoLlm = {
  provedor: string;
  modelo: string;
  tokensEntrada: number;
  /** Inclui os de raciocínio, quando o provedor os cobra como saída (OpenAI). */
  tokensSaida: number;
  /** Parte de `tokensSaida` gasta em raciocínio (só quem informa: OpenAI). */
  tokensRaciocinio?: number;
  ms: number;
};

export type PedidoExtracao = {
  sistema: string;
  usuario: string;
  /** JSON schema estrito da saída (structured outputs). */
  schema: Record<string, unknown>;
  /** Nome do formato (OpenAI `text.format.name`) e o que o mock usa para escolher a resposta. Padrão "extracao". */
  nome?: string;
  /** Teto de tokens de saída (inclui raciocínio na OpenAI). Padrão `MAX_TOKENS_EXTRACAO`. */
  maxTokens?: number;
};

/** `bruto` = JSON já parseado, ainda NÃO validado (a validação é do chamador). */
export type RespostaProvedor = { bruto: unknown; uso: UsoLlm };

export interface ProvedorLlm {
  readonly nome: string;
  extrair(pedido: PedidoExtracao): Promise<RespostaProvedor>;
}

export type CodigoErroLlm =
  | "PROVEDOR_INVALIDO"
  | "SEM_CHAVE"
  | "HTTP"
  | "SEM_CREDITO"
  | "TIMEOUT"
  | "REDE"
  | "RECUSA"
  | "TRUNCADA"
  /** A API respondeu, mas a geração falhou do lado dela (OpenAI `status: "failed"`); detalhe = código. */
  | "FALHA_PROVEDOR"
  | "SEM_JSON"
  | "SAIDA_INVALIDA";

/**
 * Erro da camada de LLM. A `message` é só código/status — nunca corpo de
 * resposta nem texto da mensagem — porque vai para o log via `registrarErro`.
 * `bruto`/`uso` acompanham para o pipeline gravar em `resultado_llm`.
 */
/**
 * Motivo legível padrão por código (vai para `mensagem_bruta.erro`). Só os
 * que o operador precisa entender sem abrir o log.
 */
const DETALHE_PADRAO: Partial<Record<CodigoErroLlm, string>> = {
  // Reprocessável (GAB-41) depois de recarregar o saldo. Os provedores
  // passam o próprio `detalhe` ("... da OpenAI"/"... da Anthropic").
  SEM_CREDITO: "sem crédito na API da Anthropic",
};

export class ErroLlm extends Error {
  constructor(
    readonly codigo: CodigoErroLlm,
    opts: { status?: number; bruto?: unknown; uso?: UsoLlm; detalhe?: string } = {},
  ) {
    const detalhe = opts.detalhe ?? DETALHE_PADRAO[codigo];
    super(`LLM ${codigo}${opts.status ? ` HTTP ${opts.status}` : ""}${detalhe ? ` (${detalhe})` : ""}`);
    this.name = "ErroLlm";
    this.status = opts.status;
    this.bruto = opts.bruto;
    this.uso = opts.uso;
  }
  readonly status?: number;
  readonly bruto?: unknown;
  readonly uso?: UsoLlm;
}

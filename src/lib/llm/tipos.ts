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
/** Frases fixas de `detalhe` (legíveis para o operador). */
export type DetalheFixo =
  | "sem crédito na API da OpenAI"
  | "sem crédito na API da Anthropic"
  | "sem crédito na API de LLM"
  | "OPENAI_API_KEY ausente"
  | "ANTHROPIC_API_KEY ausente"
  | "LLM_PROVEDOR deve ser openai, anthropic ou mock"
  | "LLM_PROVEDOR=mock não é permitido em produção";

/**
 * `detalhe` é fechado: texto livre (corpo de resposta, mensagem de exceção)
 * nunca chega à `message`, que vai ao log e a `mensagem_bruta.erro`.
 * - `codigo`: código/enum do provedor, nome de classe, `status=...`;
 * - `campos`: caminhos do zod (nomes de campo, nunca valores);
 * - `modelo`/`provedor`: config do `.env`.
 * Os identificadores são validados: o que não parece código vira `?`.
 */
export type DetalheLlm = DetalheFixo | { codigo: string } | { campos: string[] } | { modelo: string; provedor: string };

const IDENTIFICADOR = /^[\w.:=\-()[\]]{1,80}$/;
const ident = (s: string) => (IDENTIFICADOR.test(s) ? s : "?");

function textoDetalhe(d: DetalheLlm): string {
  if (typeof d === "string") return d;
  if ("codigo" in d) return ident(d.codigo);
  if ("campos" in d) return d.campos.map(ident).join(",");
  return `LLM_EXTRACAO_MODELO=${ident(d.modelo)} não é modelo do provedor ${ident(d.provedor)}`;
}

/**
 * Motivo legível padrão por código (vai para `mensagem_bruta.erro`). Só os
 * que o operador precisa entender sem abrir o log.
 */
const DETALHE_PADRAO: Partial<Record<CodigoErroLlm, DetalheFixo>> = {
  // Reprocessável (GAB-41) depois de recarregar o saldo. Os provedores
  // passam o próprio `detalhe` ("... da OpenAI"/"... da Anthropic"); o
  // padrão é neutro para não apontar o provedor errado.
  SEM_CREDITO: "sem crédito na API de LLM",
};

export class ErroLlm extends Error {
  constructor(
    readonly codigo: CodigoErroLlm,
    opts: { status?: number; bruto?: unknown; uso?: UsoLlm; detalhe?: DetalheLlm } = {},
  ) {
    const d = opts.detalhe ?? DETALHE_PADRAO[codigo];
    const detalhe = d === undefined ? undefined : textoDetalhe(d);
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

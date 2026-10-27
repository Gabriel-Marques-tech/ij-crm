/**
 * Acesso às variáveis de ambiente do WhatsApp/Evolution (design doc §4.3/§4.6).
 * Leitura é sempre preguiçosa (na chamada, não no import): o webhook decide
 * por request se falha fechado, e os testes trocam `process.env` à vontade.
 *
 * Segredos (`EVOLUTION_WEBHOOK_SECRET`, `EVOLUTION_API_KEY`) só valem se forem
 * FORTES: ≥ 32 caracteres e sem o prefixo de placeholder `troque-me`. Um
 * segredo fraco conta como ausente — o webhook recusa tudo (401) e o envio
 * falha com `ConfigFraca`. (GAB-41 deve aplicar a mesma regra a CRON_SECRET.)
 */

export const TAMANHO_MINIMO_SEGREDO = 32;
const PREFIXO_PLACEHOLDER = "troque-me";

export class ConfigAusente extends Error {
  constructor(public readonly variavel: string) {
    super(`Variável de ambiente ausente ou vazia: ${variavel}`);
    this.name = "ConfigAusente";
  }
}

export class ConfigInvalida extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = "ConfigInvalida";
  }
}

export class ConfigFraca extends Error {
  constructor(
    public readonly variavel: string,
    public readonly motivo: MotivoSegredoInvalido,
  ) {
    super(`Segredo fraco em ${variavel} (${motivo}): use openssl rand -hex 32`);
    this.name = "ConfigFraca";
  }
}

export type MotivoSegredoInvalido = "AUSENTE" | "PLACEHOLDER" | "CURTO";

export type DiagnosticoSegredo = { ok: true; valor: string } | { ok: false; motivo: MotivoSegredoInvalido };

function ler(nome: string): string | undefined {
  const v = process.env[nome]?.trim();
  return v ? v : undefined;
}

function exigir(nome: string): string {
  const v = ler(nome);
  if (!v) throw new ConfigAusente(nome);
  return v;
}

/** Avalia um segredo sem lançar: quem chama decide entre 401, log ou exceção. */
export function diagnosticarSegredo(nome: string): DiagnosticoSegredo {
  const v = ler(nome);
  if (!v) return { ok: false, motivo: "AUSENTE" };
  if (v.startsWith(PREFIXO_PLACEHOLDER)) return { ok: false, motivo: "PLACEHOLDER" };
  if (v.length < TAMANHO_MINIMO_SEGREDO) return { ok: false, motivo: "CURTO" };
  return { ok: true, valor: v };
}

function exigirSegredo(nome: string): string {
  const d = diagnosticarSegredo(nome);
  if (d.ok) return d.valor;
  if (d.motivo === "AUSENTE") throw new ConfigAusente(nome);
  throw new ConfigFraca(nome, d.motivo);
}

/** URL, chave global e nome da instância para chamar a Evolution. Lança `ConfigAusente`/`ConfigFraca`. */
export function configEvolution(): { apiUrl: string; apiKey: string; instancia: string } {
  return {
    apiUrl: exigir("EVOLUTION_API_URL").replace(/\/+$/, ""),
    apiKey: exigirSegredo("EVOLUTION_API_KEY"),
    instancia: exigir("EVOLUTION_INSTANCE"),
  };
}

/** Segredo esperado no header do webhook. `undefined` (ausente OU fraco) ⇒ o webhook recusa tudo. */
export function segredoWebhook(): string | undefined {
  const d = diagnosticarSegredo("EVOLUTION_WEBHOOK_SECRET");
  return d.ok ? d.valor : undefined;
}

/** Chave global da Evolution, aceita como fallback no campo `apikey` do corpo do webhook. */
export function chaveApiEvolution(): string | undefined {
  const d = diagnosticarSegredo("EVOLUTION_API_KEY");
  return d.ok ? d.valor : undefined;
}

/** JID do único grupo aceito. `undefined` ⇒ webhook responde 503. */
export function grupoJid(): string | undefined {
  return ler("GRUPO_JID");
}

/** Safe mode (padrão LocPay): só a string exata "true" libera envio real. */
export function notificacoesAtivas(): boolean {
  return process.env.NOTIFICATIONS_ENABLED === "true";
}

// ---------------------------------------------------------------- LLM (GAB-34)

export type NomeProvedorLlm = "openai" | "anthropic" | "mock";

/**
 * Modelo padrão por provedor (GAB-45): produção usa GPT-6.1 Sol com
 * raciocínio `low`; Claude Haiku 5.5 fica como alternativa por env
 * (`claude-sonnet-5-5` se precisar de mais qualidade).
 */
export const MODELOS_EXTRACAO_PADRAO = { openai: "gpt-6.1-sol", anthropic: "claude-haiku-5-5" } as const;
export const LIMIAR_CONFIANCA_PADRAO = 0.7;

/**
 * `LLM_PROVEDOR`: `openai` (padrão), `anthropic` ou `mock` (dev/testes, sem rede).
 * Qualquer outro valor → `null`: o pipeline marca a mensagem `FALHA`.
 * `mock` com `NODE_ENV=production` → lança `ConfigInvalida` (idem, `FALHA`).
 */
export function provedorLlm(): NomeProvedorLlm | null {
  const v = (ler("LLM_PROVEDOR") ?? "openai").toLowerCase();
  // Falha fechada: em produção o mock criaria cards com dados de fixture.
  if (v === "mock" && process.env.NODE_ENV === "production") throw new ConfigInvalida("LLM_PROVEDOR=mock não é permitido em produção");
  return v === "openai" || v === "anthropic" || v === "mock" ? v : null;
}

/**
 * Modelo da extração: `LLM_EXTRACAO_MODELO` (nome que já está no
 * compose/.env.prod) ou o padrão do provedor.
 */
export function modeloExtracao(provedor: keyof typeof MODELOS_EXTRACAO_PADRAO = "openai"): string {
  return ler("LLM_EXTRACAO_MODELO") ?? MODELOS_EXTRACAO_PADRAO[provedor];
}

/** Modelo que o provedor configurado usaria; `null` para mock/inválido. Nunca lança (serve de rótulo no registro de falha). */
export function modeloDoProvedorConfigurado(): string | null {
  try {
    const p = provedorLlm();
    return p === "openai" || p === "anthropic" ? modeloExtracao(p) : null;
  } catch {
    return null;
  }
}

/**
 * Chaves das APIs. Não passam pela regra de segredo forte (o formato é do
 * provedor). Ausente → extração falha com `SEM_CHAVE`: a mensagem vai
 * para `FALHA` com motivo claro e nada quebra.
 */
export function chaveAnthropic(): string | undefined {
  return ler("ANTHROPIC_API_KEY");
}

export function chaveOpenAI(): string | undefined {
  return ler("OPENAI_API_KEY");
}

/** Abaixo disto o card nasce com `revisar = true`. `LLM_LIMIAR_CONFIANCA` fora de [0, 1] ou ilegível → 0.7. */
export function limiarConfianca(): number {
  const bruto = ler("LLM_LIMIAR_CONFIANCA");
  if (bruto === undefined) return LIMIAR_CONFIANCA_PADRAO;
  const n = Number(bruto.replace(",", "."));
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : LIMIAR_CONFIANCA_PADRAO;
}

// ------------------------------------------------- classificador sem #crm (GAB-39)

/** Limiares do classificador; GAB-42 os leva para a config do admin. */
export const LIMIAR_CLASSIFICADOR_PADRAO = 0.7;
export const LIMIAR_SEM_TAG_PADRAO = 0.85;

function limiar(nome: string, padrao: number): number {
  const bruto = ler(nome);
  if (bruto === undefined) return padrao;
  const n = Number(bruto.replace(",", "."));
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : padrao;
}

/** Mensagem sem #crm com `confianca` do classificador abaixo disto (ou `relevante=false`) é descartada. */
export function limiarClassificador(): number {
  return limiar("LLM_LIMIAR_CLASSIFICADOR", LIMIAR_CLASSIFICADOR_PADRAO);
}

/**
 * Mensagem sem #crm só age (cria/atualiza card) se a confiança da EXTRAÇÃO
 * for ≥ isto — mais exigente que `LLM_LIMIAR_CONFIANCA`. Abaixo → `PENDENTE_REVISAO`.
 */
export function limiarSemTag(): number {
  return limiar("LLM_LIMIAR_SEM_TAG", LIMIAR_SEM_TAG_PADRAO);
}

/**
 * Modelo do classificador: `LLM_CLASSIFICACAO_MODELO` se for do provedor
 * configurado; senão o mesmo da extração. Modelo de outro provedor (o
 * antigo padrão `claude-haiku-5-5` com `openai`) é ignorado, não derruba o
 * classificador.
 */
export function modeloClassificacao(provedor: keyof typeof MODELOS_EXTRACAO_PADRAO): string {
  const v = ler("LLM_CLASSIFICACAO_MODELO");
  if (v && v.startsWith("claude-") === (provedor === "anthropic")) return v;
  return modeloExtracao(provedor);
}

/**
 * Acesso às variáveis de ambiente do WhatsApp/Evolution (design doc §4.3/§4.6).
 * Leitura é sempre preguiçosa (na chamada, não no import): o webhook decide
 * por request se falha fechado, e os testes trocam `process.env` à vontade.
 *
 * Segredos (`EVOLUTION_WEBHOOK_SECRET`, `EVOLUTION_API_KEY`) só valem se forem
 * FORTES: ≥ 32 caracteres e sem o prefixo de placeholder `troque-me`. Um
 * segredo fraco conta como ausente — o webhook recusa tudo (401) e o envio
 * falha com `ConfigFraca`. `CRON_SECRET` segue a mesma regra (GAB-41).
 */

import { sobrescrita } from "./sobrescritas";

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

/** Config técnica do Admin (GAB-42, `tecnica.ts`) vence o env; segredos nunca são sobrescritos. */
function ler(nome: string): string | undefined {
  const v = (sobrescrita(nome) ?? process.env[nome])?.trim();
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

/** Segredo do header `x-cron-secret` de `/api/cron/*` (GAB-41). `undefined` (ausente OU fraco) ⇒ 401 para tudo. */
export function segredoCron(): string | undefined {
  const d = diagnosticarSegredo("CRON_SECRET");
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

export const TIMEOUT_ENVIO_PADRAO_MS = 60_000;
export const TIMEOUT_ENVIO_MIN_MS = 5_000;
export const TIMEOUT_ENVIO_MAX_MS = 120_000;

/** Timeout do envio à Evolution (`EVOLUTION_TIMEOUT_ENVIO_MS`, 5–120 s); fora disso → 60 s. */
export function timeoutEnvioMs(): number {
  const n = Number(ler("EVOLUTION_TIMEOUT_ENVIO_MS"));
  return Number.isInteger(n) && n >= TIMEOUT_ENVIO_MIN_MS && n <= TIMEOUT_ENVIO_MAX_MS ? n : TIMEOUT_ENVIO_PADRAO_MS;
}

// ---------------------------------------------------------------- LLM (GAB-34)

export type NomeProvedorLlm = "openai" | "anthropic" | "gemini" | "mock";
/** Provedores reais (com chave e modelo). */
export type ProvedorReal = Exclude<NomeProvedorLlm, "mock">;

/**
 * Modelo padrão por provedor (GAB-45): o padrão do código é GPT-6.1 Sol com
 * raciocínio `low`; Claude Haiku 5.5 (`claude-sonnet-5-5` se precisar de mais
 * qualidade) e Gemini 3.8 Flash (`provedores/gemini.ts`) são alternativas por
 * `LLM_PROVEDOR`.
 */
export const MODELOS_EXTRACAO_PADRAO = { openai: "gpt-6.1-sol", anthropic: "claude-haiku-5-5", gemini: "gemini-3.8-flash" } as const;

const ehProvedorReal = (p: unknown): p is ProvedorReal => p === "openai" || p === "anthropic" || p === "gemini";

/**
 * O modelo é do provedor? Pelo prefixo: Anthropic `claude-`, Gemini
 * `gemini-`; OpenAI é o resto (gpt-*, o*...), nunca os outros dois. Evita o
 * `.env` trocar o provedor e esquecer o modelo (404 a cada mensagem).
 */
export function modeloDoProvedor(modelo: string, provedor: ProvedorReal): boolean {
  if (provedor === "anthropic") return modelo.startsWith("claude-");
  if (provedor === "gemini") return modelo.startsWith("gemini-");
  return !modelo.startsWith("claude-") && !modelo.startsWith("gemini-");
}
export const LIMIAR_CONFIANCA_PADRAO = 0.7;

/**
 * `LLM_PROVEDOR`: `openai` (padrão), `anthropic`, `gemini` ou `mock` (dev/testes, sem rede).
 * Qualquer outro valor → `null`: o pipeline marca a mensagem `FALHA`.
 * `mock` com `NODE_ENV=production` → lança `ConfigInvalida` (idem, `FALHA`).
 */
export function provedorLlm(): NomeProvedorLlm | null {
  const v = (ler("LLM_PROVEDOR") ?? "openai").toLowerCase();
  // Falha fechada: em produção o mock criaria cards com dados de fixture.
  if (v === "mock" && process.env.NODE_ENV === "production") throw new ConfigInvalida("LLM_PROVEDOR=mock não é permitido em produção");
  return ehProvedorReal(v) || v === "mock" ? v : null;
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
    return ehProvedorReal(p) ? modeloExtracao(p) : null;
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

/** Chave do Google AI Studio (Gemini Developer API). */
export function chaveGemini(): string | undefined {
  return ler("GEMINI_API_KEY");
}

/** Abaixo disto o card nasce com `revisar = true`. `LLM_LIMIAR_CONFIANCA` fora de [0, 1] ou ilegível → 0.7 (com aviso). */
export function limiarConfianca(): number {
  return limiar("LLM_LIMIAR_CONFIANCA", LIMIAR_CONFIANCA_PADRAO);
}

// ------------------------------------------------- classificador sem #crm (GAB-39)

/** Limiares do classificador; GAB-42 os leva para a config do admin. */
export const LIMIAR_CLASSIFICADOR_PADRAO = 0.7;
export const LIMIAR_SEM_TAG_PADRAO = 0.85;

const gAvisos = globalThis as unknown as { __ijAvisosConfig?: Set<string> };

/** Config errada vira `console.warn` uma vez por processo (por variável + valor), não a cada mensagem. */
function avisarUmaVez(chave: string, texto: string) {
  const vistos = (gAvisos.__ijAvisosConfig ??= new Set());
  if (vistos.has(chave)) return;
  vistos.add(chave);
  console.warn(`[config] ${texto}`);
}

/** Só para testes. */
export function reiniciarAvisosConfig() {
  gAvisos.__ijAvisosConfig = undefined;
}

/** Limiar 0–1 (aceita vírgula). Ilegível ou fora da faixa → padrão + aviso. */
function limiar(nome: string, padrao: number): number {
  const bruto = ler(nome);
  if (bruto === undefined) return padrao;
  const n = Number(bruto.replace(",", "."));
  if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
  avisarUmaVez(`${nome}=${bruto}`, `${nome}=${bruto} inválido (precisa ser um número de 0 a 1); usando ${padrao}`);
  return padrao;
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
  const semTag = limiar("LLM_LIMIAR_SEM_TAG", LIMIAR_SEM_TAG_PADRAO);
  const comTag = limiarConfianca();
  if (semTag >= comTag) return semTag;
  // Sem tag nunca pode ser MAIS permissivo que com tag: vale o mais exigente.
  avisarUmaVez(
    `LLM_LIMIAR_SEM_TAG<${semTag}<${comTag}`,
    `LLM_LIMIAR_SEM_TAG=${semTag} < LLM_LIMIAR_CONFIANCA=${comTag}; usando ${comTag} para mensagens sem #crm`,
  );
  return comTag;
}

/**
 * Modelo do classificador: `LLM_CLASSIFICACAO_MODELO` se for do provedor
 * configurado; senão o mesmo da extração. Modelo de outro provedor (o
 * antigo padrão `claude-haiku-5-5` com `openai`, um `gpt-*` com `gemini`) é
 * ignorado, não derruba o classificador.
 */
export function modeloClassificacao(provedor: keyof typeof MODELOS_EXTRACAO_PADRAO): string {
  const v = ler("LLM_CLASSIFICACAO_MODELO");
  if (v && modeloDoProvedor(v, provedor)) return v;
  if (v) {
    avisarUmaVez(
      `LLM_CLASSIFICACAO_MODELO=${v}@${provedor}`,
      `LLM_CLASSIFICACAO_MODELO=${v} ignorado: não é modelo do provedor ${provedor}; o classificador usa o modelo da extração`,
    );
  }
  return modeloExtracao(provedor);
}

/**
 * Lê a config de LLM uma vez no boot (`src/instrumentation.ts`) para os
 * avisos de `[config]` aparecerem logo ao subir, não só na 1ª mensagem.
 * Nunca lança.
 */
export function validarConfigLlm() {
  try {
    limiarConfianca();
    limiarClassificador();
    limiarSemTag();
    const p = provedorLlm();
    if (ehProvedorReal(p)) modeloClassificacao(p);
  } catch {
    // provedor inválido/mock em produção: o pipeline já registra como FALHA.
  }
}

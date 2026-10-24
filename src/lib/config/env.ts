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

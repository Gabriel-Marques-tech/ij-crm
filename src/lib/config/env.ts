/**
 * Acesso às variáveis de ambiente do WhatsApp/Evolution (design doc §4.3/§4.6).
 * Leitura é sempre preguiçosa (na chamada, não no import): o webhook decide
 * por request se falha fechado, e os testes trocam `process.env` à vontade.
 */

export class ConfigAusente extends Error {
  constructor(public readonly variavel: string) {
    super(`Variável de ambiente ausente ou vazia: ${variavel}`);
    this.name = "ConfigAusente";
  }
}

function ler(nome: string): string | undefined {
  const v = process.env[nome]?.trim();
  return v ? v : undefined;
}

function exigir(nome: string): string {
  const v = ler(nome);
  if (!v) throw new ConfigAusente(nome);
  return v;
}

/** URL, chave global e nome da instância para chamar a Evolution. Lança `ConfigAusente`. */
export function configEvolution(): { apiUrl: string; apiKey: string; instancia: string } {
  return {
    apiUrl: exigir("EVOLUTION_API_URL").replace(/\/+$/, ""),
    apiKey: exigir("EVOLUTION_API_KEY"),
    instancia: exigir("EVOLUTION_INSTANCE"),
  };
}

/** Segredo esperado no header do webhook. `undefined` ⇒ o webhook recusa tudo (401). */
export function segredoWebhook(): string | undefined {
  return ler("EVOLUTION_WEBHOOK_SECRET");
}

/** JID do único grupo aceito. `undefined` ⇒ webhook responde 503. */
export function grupoJid(): string | undefined {
  return ler("GRUPO_JID");
}

/** Safe mode (padrão LocPay): só a string exata "true" libera envio real. */
export function notificacoesAtivas(): boolean {
  return process.env.NOTIFICATIONS_ENABLED === "true";
}

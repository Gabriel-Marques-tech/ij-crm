/**
 * Camada de envio para a Evolution API v2 (`POST /message/sendText/{instancia}`).
 * Padrões herdados do LocPay (design doc §7): safe mode por `NOTIFICATIONS_ENABLED`,
 * timeout de 60s cobrindo request E leitura do corpo, JID de grupo. O bot nunca
 * inicia conversa — só quem já tem uma mensagem para citar chama isto.
 */
import { db } from "@/lib/db";
import { configEvolution, notificacoesAtivas, TIMEOUT_ENVIO_PADRAO_MS, timeoutEnvioMs } from "@/lib/config/env";
import { descreverErro } from "@/lib/erros/registrar";
import { mascararJid } from "./mascarar";

/** Padrão; o valor em uso vem de `timeoutEnvioMs()` (config do Admin > env > padrão). */
export const TIMEOUT_ENVIO_MS = TIMEOUT_ENVIO_PADRAO_MS;

export type Citacao = {
  /** `key.id` da mensagem citada. */
  eventoId: string;
  /** JID do remetente original (obrigatório em grupo para a citação renderizar). */
  participant?: string;
  /**
   * Texto da mensagem citada. Vai em `quoted.message.conversation` para a
   * Evolution não precisar guardar mensagens no banco dela
   * (`DATABASE_SAVE_DATA_NEW_MESSAGE=false` no compose — design doc §2).
   */
  texto?: string;
};

export type EnvioWhatsApp = {
  /** JID destino — no v1 sempre o grupo (`...@g.us`). */
  para: string;
  texto: string;
  citar?: Citacao;
  projetoId?: string | null;
};

export type ResultadoEnvio = { eventoId: string; enviada: boolean };

export class ErroEnvioWhatsApp extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ErroEnvioWhatsApp";
  }
}

/**
 * A Evolution CONFIRMOU a entrega (tem `eventoId`), mas algo depois falhou
 * (gravar MensagemEnviada). Subclasse do genérico: quem já trata
 * `ErroEnvioWhatsApp` não muda; quem precisa saber que a mensagem saiu
 * (ex.: cooldown do alerta de crédito, GAB-46) checa esta classe.
 * A causa vai só descrita por `descreverErro` (Prisma sem argumentos/texto).
 */
export class ErroPosEnvio extends ErroEnvioWhatsApp {
  constructor(
    public readonly eventoId: string,
    causa: unknown,
  ) {
    super(`mensagem entregue (evento ${eventoId}) mas não registrada: ${descreverErro(causa)}`);
    this.name = "ErroPosEnvio";
  }
}

/** Lê o JSON respeitando o mesmo sinal de abort da requisição (corpo que nunca chega também é timeout). */
function lerJson(resposta: Response, sinal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const abortar = () => reject(new DOMException("leitura do corpo abortada", "AbortError"));
    if (sinal.aborted) return abortar();
    sinal.addEventListener("abort", abortar, { once: true });
    resposta
      .json()
      .then(resolve, () => resolve(null))
      .finally(() => sinal.removeEventListener("abort", abortar));
  });
}

export async function enviarWhatsApp({ para, texto, citar, projetoId = null }: EnvioWhatsApp): Promise<ResultadoEnvio> {
  if (!notificacoesAtivas()) {
    console.info(`[SAFE MODE] WhatsApp NÃO enviado para ${mascararJid(para)}`);
    return { eventoId: `safe-${crypto.randomUUID()}`, enviada: false };
  }

  const { apiUrl, apiKey, instancia } = configEvolution();
  const corpo: Record<string, unknown> = { number: para, text: texto };
  if (citar) {
    corpo.quoted = {
      key: { id: citar.eventoId, remoteJid: para, fromMe: false, participant: citar.participant },
      ...(citar.texto ? { message: { conversation: citar.texto } } : {}),
    };
  }

  const timeoutMs = timeoutEnvioMs();
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), timeoutMs);
  let json: unknown;
  let status: number;
  try {
    const resposta = await fetch(`${apiUrl}/message/sendText/${encodeURIComponent(instancia)}`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: apiKey },
      body: JSON.stringify(corpo),
      signal: controlador.signal,
    });
    status = resposta.status;
    if (!resposta.ok) throw new ErroEnvioWhatsApp(`Evolution sendText respondeu HTTP ${status}`, status);
    json = await lerJson(resposta, controlador.signal);
  } catch (e) {
    if (e instanceof ErroEnvioWhatsApp) throw e;
    const motivo = controlador.signal.aborted ? `timeout após ${timeoutMs}ms` : "falha de rede";
    throw new ErroEnvioWhatsApp(`Evolution sendText: ${motivo}`);
  } finally {
    clearTimeout(timer);
  }

  const eventoId = (json as { key?: { id?: unknown } } | null)?.key?.id;
  if (typeof eventoId !== "string" || !eventoId) throw new ErroEnvioWhatsApp("Evolution sendText sem key.id na resposta", status);

  try {
    await db.mensagemEnviada.create({ data: { eventoId, grupoJid: para, texto, projetoId } });
  } catch (e) {
    throw new ErroPosEnvio(eventoId, e);
  }
  console.info(`[whatsapp] enviado para ${mascararJid(para)} (evento ${eventoId})`);
  return { eventoId, enviada: true };
}

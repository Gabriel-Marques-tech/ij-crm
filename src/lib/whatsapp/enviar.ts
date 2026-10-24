/**
 * Camada de envio para a Evolution API v2 (`POST /message/sendText/{instancia}`).
 * Padrões herdados do LocPay (design doc §7): safe mode por `NOTIFICATIONS_ENABLED`,
 * timeout de 60s, JID de grupo. O bot nunca inicia conversa — só quem já tem
 * uma mensagem para citar chama isto.
 */
import { db } from "@/lib/db";
import { configEvolution, notificacoesAtivas } from "@/lib/config/env";
import { mascararJid } from "./mascarar";

export const TIMEOUT_ENVIO_MS = 60_000;

export type Citacao = {
  /** `key.id` da mensagem citada. */
  eventoId: string;
  /** JID do remetente original (obrigatório em grupo para a citação renderizar). */
  participant?: string;
};

export type EnvioWhatsApp = {
  /** JID destino — no v1 sempre o grupo (`...@g.us`). */
  para: string;
  texto: string;
  citar?: Citacao;
  oportunidadeId?: string | null;
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

export async function enviarWhatsApp({ para, texto, citar, oportunidadeId = null }: EnvioWhatsApp): Promise<ResultadoEnvio> {
  if (!notificacoesAtivas()) {
    console.info(`[SAFE MODE] WhatsApp NÃO enviado para ${mascararJid(para)}`);
    return { eventoId: `safe-${crypto.randomUUID()}`, enviada: false };
  }

  const { apiUrl, apiKey, instancia } = configEvolution();
  const corpo: Record<string, unknown> = { number: para, text: texto };
  if (citar) {
    // Só a key: a Evolution busca o conteúdo citado no banco dela
    // (exige DATABASE_SAVE_DATA_NEW_MESSAGE=true, ligado no compose).
    corpo.quoted = { key: { id: citar.eventoId, remoteJid: para, fromMe: false, participant: citar.participant } };
  }

  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), TIMEOUT_ENVIO_MS);
  let resposta: Response;
  try {
    resposta = await fetch(`${apiUrl}/message/sendText/${encodeURIComponent(instancia)}`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: apiKey },
      body: JSON.stringify(corpo),
      signal: controlador.signal,
    });
  } catch (e) {
    const motivo = e instanceof Error && e.name === "AbortError" ? `timeout após ${TIMEOUT_ENVIO_MS}ms` : "falha de rede";
    throw new ErroEnvioWhatsApp(`Evolution sendText: ${motivo}`);
  } finally {
    clearTimeout(timer);
  }

  if (!resposta.ok) throw new ErroEnvioWhatsApp(`Evolution sendText respondeu HTTP ${resposta.status}`, resposta.status);

  const json = (await resposta.json().catch(() => null)) as { key?: { id?: unknown } } | null;
  const eventoId = typeof json?.key?.id === "string" ? json.key.id : null;
  if (!eventoId) throw new ErroEnvioWhatsApp("Evolution sendText sem key.id na resposta", resposta.status);

  await db.mensagemEnviada.create({ data: { eventoId, grupoJid: para, texto, oportunidadeId } });
  console.info(`[whatsapp] enviado para ${mascararJid(para)} (evento ${eventoId})`);
  return { eventoId, enviada: true };
}

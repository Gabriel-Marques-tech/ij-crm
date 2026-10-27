/**
 * Logs técnicos do Admin (GAB-42): webhook e chamadas de LLM, em tabelas
 * pequenas no próprio Postgres — sem serviço externo. Cada uma é um anel:
 * a inserção apaga o que passou das últimas N linhas (uma consulta pelo
 * índice da PK; com N=200 é desprezível).
 *
 * LGPD: nada de texto de mensagem, telefone ou email. O chat entra
 * mascarado (`mascararJid`), e tipo/resultado/status/modelo só passam se
 * parecem identificadores — texto livre vira `?`. Gravar log nunca lança:
 * falha vira uma linha `[logs]` sem dados do evento.
 */
import { db } from "@/lib/db";
import { descreverErro } from "@/lib/erros/registrar";
import type { UsoLlm } from "@/lib/llm/tipos";
import { mascararJid } from "@/lib/whatsapp/mascarar";

export const LIMITE_LOG_WEBHOOK = 200;
export const LIMITE_LOG_LLM = 200;

const IDENTIFICADOR = /^[\w.:\-]{1,60}$/;
const ident = (s: string | null | undefined): string | null => (s == null ? null : IDENTIFICADOR.test(s) ? s : "?");
const inteiro = (n: number | null | undefined): number | null => (n == null ? null : Math.round(n));

export type EventoWebhook = { tipo: string | null; chat: string | null; status: number; resultado: string; ms: number };

export async function registrarLogWebhook(e: EventoWebhook): Promise<void> {
  try {
    await db.logWebhook.create({
      data: { tipo: ident(e.tipo), chat: e.chat ? mascararJid(e.chat) : null, status: e.status, resultado: ident(e.resultado) ?? "?", ms: Math.round(e.ms) },
    });
    await db.$executeRaw`DELETE FROM log_webhook WHERE id <= (SELECT id FROM log_webhook ORDER BY id DESC OFFSET ${LIMITE_LOG_WEBHOOK} LIMIT 1)`;
  } catch (err) {
    console.error(`[logs] falha ao gravar log_webhook: ${descreverErro(err)}`);
  }
}

export type ChamadaLlm = {
  operacao: "extracao" | "classificacao";
  uso?: UsoLlm;
  /** `ok` ou o código do `ErroLlm`. */
  status: string;
  /** id da MensagemBruta. */
  ref: string | null;
};

export async function registrarLogLlm(c: ChamadaLlm): Promise<void> {
  try {
    await db.logLlm.create({
      data: {
        operacao: c.operacao,
        provedor: ident(c.uso?.provedor),
        modelo: ident(c.uso?.modelo),
        tokensEntrada: inteiro(c.uso?.tokensEntrada),
        tokensSaida: inteiro(c.uso?.tokensSaida),
        tokensRaciocinio: inteiro(c.uso?.tokensRaciocinio),
        ms: inteiro(c.uso?.ms),
        status: ident(c.status) ?? "?",
        ref: ident(c.ref),
      },
    });
    await db.$executeRaw`DELETE FROM log_llm WHERE id <= (SELECT id FROM log_llm ORDER BY id DESC OFFSET ${LIMITE_LOG_LLM} LIMIT 1)`;
  } catch (err) {
    console.error(`[logs] falha ao gravar log_llm: ${descreverErro(err)}`);
  }
}

/** Mais recentes primeiro. */
export function listarLogsWebhook(limite = LIMITE_LOG_WEBHOOK) {
  return db.logWebhook.findMany({ orderBy: { id: "desc" }, take: limite });
}

export function listarLogsLlm(limite = LIMITE_LOG_LLM) {
  return db.logLlm.findMany({ orderBy: { id: "desc" }, take: limite });
}

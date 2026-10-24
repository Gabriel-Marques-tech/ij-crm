/**
 * Parser do webhook `messages.upsert` da Evolution API v2 (design doc §4.3,
 * passos 1–2). Forma derivada do `prepareMessage` do serviço Baileys da
 * Evolution: `data.key` chega exatamente como o Baileys emite — por isso
 * `participant` pode ser `xxx@lid` (com `participantAlt` trazendo o telefone
 * em versões recentes). Fixtures em `src/test/fixtures/evolution`.
 */
import { z } from "zod";
import { normalizarTelefoneBr } from "@/lib/normalizacao";

const contextInfoSchema = z
  .object({
    stanzaId: z.string().min(1).optional(),
    participant: z.string().optional(),
  })
  .optional();

/** Conteúdo textual depois de tirar os envelopes (efêmera, view-once, edição). */
const conteudoSchema = z.object({
  conversation: z.string().optional(),
  extendedTextMessage: z.object({ text: z.string().optional(), contextInfo: contextInfoSchema }).optional(),
});

const payloadSchema = z.object({
  event: z.string(),
  instance: z.string().optional(),
  data: z.object({
    key: z.object({
      id: z.string().min(1),
      remoteJid: z.string().min(1),
      fromMe: z.boolean().optional(),
      participant: z.string().optional(),
      participantAlt: z.string().optional(),
    }),
    message: z.record(z.string(), z.unknown()).optional(),
    contextInfo: contextInfoSchema,
    messageType: z.string().optional(),
    messageTimestamp: z.coerce.number().optional(),
    pushName: z.string().optional(),
  }),
});

export type PayloadEvolution = z.infer<typeof payloadSchema>;

export type Remetente = { telefone: string | null; lid: string | null };

export type MensagemRecebida = {
  eventoId: string;
  grupoJid: string;
  remetente: Remetente;
  /** `key.participant` cru — vai de volta na citação da confirmação. */
  participantJid: string | null;
  texto: string;
  respondendoEventoId: string | null;
  recebidaEm: Date;
};

export type MotivoIgnorar = "PAYLOAD_INVALIDO" | "EVENTO_DIFERENTE" | "FROM_ME" | "OUTRO_CHAT" | "SEM_TEXTO";

export type Interpretacao =
  | { tipo: "IGNORAR"; motivo: Exclude<MotivoIgnorar, "PAYLOAD_INVALIDO"> }
  /** `caminhos` = paths do zod (só nomes de campo, nunca valores) para o log. */
  | { tipo: "IGNORAR"; motivo: "PAYLOAD_INVALIDO"; caminhos: string[] }
  | { tipo: "PROCESSAR"; mensagem: MensagemRecebida };

export const EVENTO_MENSAGEM = "messages.upsert";

/**
 * `#crm` como palavra: antes vem início do texto, espaço ou formatação do
 * WhatsApp (`_`, `*`, `~`); depois vem fim, espaço, formatação ou pontuação.
 * Não casa dentro de URL (`/#crm`, `?x#crm`) nem colado em palavra (`foo#crm`).
 */
const TAG_CRM = /(?:^|[\s_*~])#crm(?=$|[\s_*~.,;:!?)\]}"'’”])/iu;

export function temTagCrm(texto: string): boolean {
  return TAG_CRM.test(texto);
}

function telefoneDeJid(jid: string): string | null {
  if (!jid.endsWith("@s.whatsapp.net")) return null;
  const digitos = jid.slice(0, jid.indexOf("@")).replace(/\D/g, "");
  if (!digitos) return null;
  // BR normalizado (E.164); estrangeiro fica como +dígitos para o painel de desconhecidos.
  return normalizarTelefoneBr(`+${digitos}`) ?? `+${digitos}`;
}

/**
 * `participant` → telefone e/ou LID. LID é guardado como JID completo
 * (`123@lid`) — é o que o admin cola no painel de remetentes desconhecidos.
 */
export function identificarParticipante(participant: string | undefined, participantAlt?: string): Remetente {
  const candidatos = [participant, participantAlt].filter((j): j is string => !!j);
  let telefone: string | null = null;
  let lid: string | null = null;
  for (const jid of candidatos) {
    if (jid.endsWith("@lid")) lid ??= jid;
    else telefone ??= telefoneDeJid(jid);
  }
  return { telefone, lid };
}

type Conteudo = Record<string, unknown>;

/** Envelopes do Baileys cujo `.message` carrega o conteúdo real. */
const ENVELOPES = [
  "ephemeralMessage",
  "viewOnceMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
  "editedMessage",
  // Documento com legenda: o interno é `documentMessage` → sem texto na v1 (mídia).
  "documentWithCaptionMessage",
] as const;

/**
 * Tira envelopes até chegar no conteúdo. Edição chega como
 * `editedMessage.message.protocolMessage.editedMessage` — a edição vira uma
 * mensagem nova (key.id próprio); a original já persistida não é alterada na v1.
 */
export function desembrulharConteudo(m: Conteudo | undefined, profundidade = 0): Conteudo | undefined {
  if (!m || profundidade > 6) return m;
  for (const envelope of ENVELOPES) {
    const interno = (m[envelope] as { message?: Conteudo } | undefined)?.message;
    if (interno && typeof interno === "object") return desembrulharConteudo(interno, profundidade + 1);
  }
  const editado = (m.protocolMessage as { editedMessage?: Conteudo } | undefined)?.editedMessage;
  if (editado && typeof editado === "object") return desembrulharConteudo(editado, profundidade + 1);
  return m;
}

function caminhosDe(erro: z.ZodError): string[] {
  return [...new Set(erro.issues.map((i) => i.path.join(".") || "(raiz)"))];
}

export function interpretarPayload(json: unknown, grupoJid: string): Interpretacao {
  const r = payloadSchema.safeParse(json);
  if (!r.success) return { tipo: "IGNORAR", motivo: "PAYLOAD_INVALIDO", caminhos: caminhosDe(r.error) };
  const { event, data } = r.data;

  if (event !== EVENTO_MENSAGEM) return { tipo: "IGNORAR", motivo: "EVENTO_DIFERENTE" };
  if (data.key.fromMe) return { tipo: "IGNORAR", motivo: "FROM_ME" };
  if (data.key.remoteJid !== grupoJid) return { tipo: "IGNORAR", motivo: "OUTRO_CHAT" };

  const conteudo = conteudoSchema.safeParse(desembrulharConteudo(data.message) ?? {});
  if (!conteudo.success) {
    return { tipo: "IGNORAR", motivo: "PAYLOAD_INVALIDO", caminhos: caminhosDe(conteudo.error).map((c) => `data.message.${c}`) };
  }

  // v1 só lê texto. Áudio/imagem/documento ficam para depois (design doc §2, não-objetivos).
  const texto = (conteudo.data.conversation ?? conteudo.data.extendedTextMessage?.text ?? "").trim();
  if (!texto) return { tipo: "IGNORAR", motivo: "SEM_TEXTO" };

  const contexto = conteudo.data.extendedTextMessage?.contextInfo ?? data.contextInfo;
  const ts = data.messageTimestamp;
  return {
    tipo: "PROCESSAR",
    mensagem: {
      eventoId: data.key.id,
      grupoJid: data.key.remoteJid,
      remetente: identificarParticipante(data.key.participant, data.key.participantAlt),
      participantJid: data.key.participant ?? null,
      texto,
      respondendoEventoId: contexto?.stanzaId ?? null,
      recebidaEm: ts && Number.isFinite(ts) ? new Date(ts * 1000) : new Date(),
    },
  };
}

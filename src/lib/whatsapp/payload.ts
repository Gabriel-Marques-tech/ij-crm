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
    message: z
      .object({
        conversation: z.string().optional(),
        extendedTextMessage: z.object({ text: z.string().optional(), contextInfo: contextInfoSchema }).optional(),
      })
      .optional(),
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

export type Interpretacao = { tipo: "IGNORAR"; motivo: MotivoIgnorar } | { tipo: "PROCESSAR"; mensagem: MensagemRecebida };

export const EVENTO_MENSAGEM = "messages.upsert";

/** `#crm` isolado (início/fim ou cercado por não-alfanumérico), sem distinguir caixa. */
const TAG_CRM = /(?<![\p{L}\p{N}_#])#crm(?![\p{L}\p{N}_])/iu;

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

function extrairTexto(message: PayloadEvolution["data"]["message"]): string | null {
  const t = message?.conversation ?? message?.extendedTextMessage?.text ?? null;
  const limpo = t?.trim();
  return limpo ? limpo : null;
}

export function interpretarPayload(json: unknown, grupoJid: string): Interpretacao {
  const r = payloadSchema.safeParse(json);
  if (!r.success) return { tipo: "IGNORAR", motivo: "PAYLOAD_INVALIDO" };
  const { event, data } = r.data;

  if (event !== EVENTO_MENSAGEM) return { tipo: "IGNORAR", motivo: "EVENTO_DIFERENTE" };
  if (data.key.fromMe) return { tipo: "IGNORAR", motivo: "FROM_ME" };
  if (data.key.remoteJid !== grupoJid) return { tipo: "IGNORAR", motivo: "OUTRO_CHAT" };

  // v1 só lê texto. Áudio/imagem ficam para depois (design doc §2, não-objetivos).
  const texto = extrairTexto(data.message);
  if (!texto) return { tipo: "IGNORAR", motivo: "SEM_TEXTO" };

  const contexto = data.message?.extendedTextMessage?.contextInfo ?? data.contextInfo;
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

/**
 * Ingestão de uma mensagem do grupo (design doc §4.3, passos 3–5 desta fatia;
 * classificador e LLM entram no GAB-34/GAB-39).
 *
 * Dedup atômico (padrão LocPay `ConversationIngestService`): o insert em
 * `InboxEvento` e todo o processamento rodam na MESMA transação. Se algo
 * lançar, a linha do inbox some junto e a re-tentativa da Evolution reprocessa.
 * `P2002` no insert ⇒ evento já visto ⇒ `DUPLICADO`, sem efeito.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { MensagemRecebida, Remetente } from "./payload";
import { temTagCrm } from "./payload";

export const TEXTO_CONFIRMACAO = "📥 recebido";

export type ResultadoIngestao =
  | { tipo: "DUPLICADO" }
  | { tipo: "REMETENTE_DESCONHECIDO" }
  | { tipo: "DESCARTADA" }
  | { tipo: "PERSISTIDA"; mensagemId: string };

type Tx = Prisma.TransactionClient;

async function usuarioDoRemetente(tx: Tx, r: Remetente): Promise<{ id: string } | null> {
  const ou: Prisma.UsuarioWhereInput[] = [];
  if (r.telefone) ou.push({ telefoneWhatsapp: r.telefone });
  if (r.lid) ou.push({ whatsappLid: r.lid });
  if (!ou.length) return null;
  return tx.usuario.findFirst({ where: { ativo: true, OR: ou }, select: { id: true } });
}

/** Conta o remetente para o painel admin sem guardar uma palavra do conteúdo. */
async function registrarDesconhecido(tx: Tx, r: Remetente, quando: Date) {
  const chave = r.telefone ? { telefone: r.telefone } : r.lid ? { lid: r.lid } : null;
  if (!chave) return; // sem identificador nenhum: nada a mostrar ao admin
  await tx.remetenteDesconhecido.upsert({
    where: chave,
    create: { ...chave, total: 1, ultimaVez: quando },
    update: { total: { increment: 1 }, ultimaVez: quando },
  });
}

/** Dia em UTC (TZ do processo é UTC no compose e nos testes). */
function diaDe(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function contarDescartada(tx: Tx, quando: Date) {
  const dia = diaDe(quando);
  await tx.contadorDescartadas.upsert({ where: { dia }, create: { dia, total: 1 }, update: { total: { increment: 1 } } });
}

export async function ingerirMensagem(m: MensagemRecebida): Promise<ResultadoIngestao> {
  try {
    return await db.$transaction(async (tx) => {
      await tx.inboxEvento.create({ data: { eventoId: m.eventoId, status: "PROCESSANDO" } });
      const resultado = await processar(tx, m);
      await tx.inboxEvento.update({ where: { eventoId: m.eventoId }, data: { status: "PROCESSADO" } });
      return resultado;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { tipo: "DUPLICADO" };
    throw e;
  }
}

async function processar(tx: Tx, m: MensagemRecebida): Promise<ResultadoIngestao> {
  const usuario = await usuarioDoRemetente(tx, m.remetente);
  if (!usuario) {
    await registrarDesconhecido(tx, m.remetente, m.recebidaEm);
    return { tipo: "REMETENTE_DESCONHECIDO" };
  }

  if (!temTagCrm(m.texto)) {
    await contarDescartada(tx, m.recebidaEm);
    return { tipo: "DESCARTADA" };
  }

  const bruta = await tx.mensagemBruta.create({
    data: {
      eventoId: m.eventoId,
      remetenteTelefone: m.remetente.telefone,
      remetenteLid: m.remetente.lid,
      remetenteUsuarioId: usuario.id,
      grupoJid: m.grupoJid,
      texto: m.texto,
      respondendoEventoId: m.respondendoEventoId,
      recebidaEm: m.recebidaEm,
      status: "RECEBIDA",
    },
    select: { id: true },
  });
  return { tipo: "PERSISTIDA", mensagemId: bruta.id };
}

/**
 * Ingestão de uma mensagem do grupo (design doc §4.3, passos 3–5 desta fatia).
 *
 * Dedup atômico (padrão LocPay `ConversationIngestService`): o insert em
 * `InboxEvento` e todo o processamento rodam na MESMA transação. Se algo
 * lançar, a linha do inbox some junto e a re-tentativa da Evolution reprocessa.
 * Violação de unicidade NO INSERT DO INBOX ⇒ evento já visto ⇒ `DUPLICADO`;
 * qualquer outra violação de unicidade é erro de verdade e sobe.
 *
 * Ordem: tag → remetente. Mensagem sem `#crm` não persiste nada aqui (nem
 * identidade do remetente): ruído óbvio ou número desconhecido só soma no
 * contador do dia; de vendedor conhecido devolve `CLASSIFICAR` e o webhook
 * roda o classificador em `after()` (`sem-tag.ts`, GAB-39) — só ele decide
 * se o texto é gravado (design doc §2: nada de conteúdo fora de venda).
 *
 * GAB-34 (LLM): roda DEPOIS do commit, em `processar.ts`, disparado pelo
 * webhook em `after()` e chaveado em `MensagemBruta.status = RECEBIDA` —
 * nunca dentro desta transação. Motivos: a tx interativa do Prisma expira em
 * 5s, e um retry da Evolution não pode cobrar a LLM duas vezes.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { contarDescartada } from "./contadores";
import { mascararJid, mascararTelefone } from "./mascarar";
import type { MensagemRecebida, Remetente } from "./payload";
import { temTagCrm } from "./payload";
import { ruidoObvio } from "./ruido";

export type ResultadoIngestao =
  | { tipo: "DUPLICADO" }
  | { tipo: "REMETENTE_DESCONHECIDO" }
  | { tipo: "DESCARTADA" }
  /** Sem `#crm`, vendedor conhecido: o classificador decide depois do 200 (nada gravado ainda). */
  | { tipo: "CLASSIFICAR"; usuarioId: string }
  | { tipo: "PERSISTIDA"; mensagemId: string };

type Tx = Prisma.TransactionClient;

class EventoDuplicado extends Error {
  constructor(eventoId: string) {
    super(`evento ${eventoId} já processado`);
    this.name = "EventoDuplicado";
  }
}

function ehViolacaoUnica(e: unknown): e is Prisma.PrismaClientKnownRequestError {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

type Resolucao = { tipo: "OK"; usuarioId: string } | { tipo: "DESCONHECIDO" } | { tipo: "CONFLITO" };

/**
 * LID tem prioridade; telefone é o segundo caminho. Se os dois vierem e
 * apontarem para usuários ativos DIFERENTES, ninguém é escolhido: é conflito
 * de cadastro para o admin resolver, não para o bot adivinhar.
 */
async function resolverRemetente(tx: Tx, r: Remetente): Promise<Resolucao> {
  const porLid = r.lid ? await tx.usuario.findFirst({ where: { ativo: true, whatsappLid: r.lid }, select: { id: true } }) : null;
  const porTelefone = r.telefone
    ? await tx.usuario.findFirst({ where: { ativo: true, telefoneWhatsapp: r.telefone }, select: { id: true } })
    : null;
  if (porLid && porTelefone && porLid.id !== porTelefone.id) return { tipo: "CONFLITO" };
  const usuario = porLid ?? porTelefone;
  return usuario ? { tipo: "OK", usuarioId: usuario.id } : { tipo: "DESCONHECIDO" };
}

/**
 * Conta o remetente para o painel admin sem guardar uma palavra do conteúdo.
 * Chave: LID quando houver, senão telefone. Limitação conhecida: o mesmo
 * humano pode aparecer em duas linhas se a Evolution ora mandar LID, ora
 * telefone — o admin vincula as duas (GAB-41).
 */
async function registrarDesconhecido(tx: Tx, r: Remetente, quando: Date) {
  const chave = r.lid ? { lid: r.lid } : r.telefone ? { telefone: r.telefone } : null;
  if (!chave) return; // sem identificador nenhum: nada a mostrar ao admin
  await tx.remetenteDesconhecido.upsert({
    where: chave,
    create: { ...chave, total: 1, ultimaVez: quando },
    update: { total: { increment: 1 }, ultimaVez: quando },
  });
}

export async function ingerirMensagem(m: MensagemRecebida): Promise<ResultadoIngestao> {
  try {
    return await db.$transaction(async (tx) => {
      try {
        await tx.inboxEvento.create({ data: { eventoId: m.eventoId, status: "PROCESSANDO" } });
      } catch (e) {
        if (ehViolacaoUnica(e)) throw new EventoDuplicado(m.eventoId);
        throw e;
      }
      const resultado = await processar(tx, m);
      await tx.inboxEvento.update({ where: { eventoId: m.eventoId }, data: { status: "PROCESSADO" } });
      return resultado;
    });
  } catch (e) {
    if (e instanceof EventoDuplicado) return { tipo: "DUPLICADO" };
    throw e;
  }
}

async function processar(tx: Tx, m: MensagemRecebida): Promise<ResultadoIngestao> {
  const semTag = !temTagCrm(m.texto);
  if (semTag && ruidoObvio(m.texto)) {
    await contarDescartada(tx, m.recebidaEm);
    return { tipo: "DESCARTADA" };
  }

  const resolucao = await resolverRemetente(tx, m.remetente);
  if (semTag) {
    if (resolucao.tipo !== "OK") {
      await contarDescartada(tx, m.recebidaEm);
      return { tipo: "DESCARTADA" };
    }
    return { tipo: "CLASSIFICAR", usuarioId: resolucao.usuarioId };
  }
  if (resolucao.tipo !== "OK") {
    if (resolucao.tipo === "CONFLITO") {
      console.warn(
        `[ingestao] remetente ambíguo: lid ${mascararJid(m.remetente.lid ?? "")} e telefone ${mascararTelefone(m.remetente.telefone ?? "")} apontam para usuários diferentes; tratado como desconhecido`,
      );
    }
    await registrarDesconhecido(tx, m.remetente, m.recebidaEm);
    return { tipo: "REMETENTE_DESCONHECIDO" };
  }

  const bruta = await tx.mensagemBruta.create({
    data: {
      eventoId: m.eventoId,
      remetenteTelefone: m.remetente.telefone,
      remetenteLid: m.remetente.lid,
      remetenteUsuarioId: resolucao.usuarioId,
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

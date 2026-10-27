/**
 * Mensagem do grupo SEM `#crm` (GAB-39; design doc §4.3 passo 4, §2).
 *
 * Ordem (o texto só é gravado se o classificador disser que é de venda):
 * 1. Ingestão (`ingestao.ts`, na tx do dedup): ruído óbvio (`ruidoObvio`) ou
 *    remetente desconhecido → só o contador do dia; nada de LLM. Senão
 *    devolve `CLASSIFICAR` — o `InboxEvento` já fica `PROCESSADO`, então o
 *    retry da Evolution cai em DUPLICADO e não cobra a LLM de novo.
 * 2. Webhook responde 200 e agenda `avaliarSemTag` em `after()`.
 * 3. `classificar` (LLM, fora de transação). Não relevante ou confiança
 *    abaixo de `LLM_LIMIAR_CLASSIFICADOR` → `contarDescartada`, mais nada:
 *    nem `MensagemBruta`, nem log com texto.
 * 4. Relevante → grava `MensagemBruta` (`semTag = true`, RECEBIDA) e chama
 *    `processarMensagem`, que só AGE com confiança de extração ≥
 *    `LLM_LIMIAR_SEM_TAG` (senão `PENDENTE_REVISAO`), apaga a linha se a
 *    extração disser IGNORAR, e confirma com "↪️ entendi como atualização: …".
 *
 * Falha do classificador (sem crédito, provedor fora, saída inválida):
 * decisão LGPD-segura — o texto NÃO é persistido (não dá para saber se é
 * dado de venda; guardar "por via das dúvidas" seria guardar conversa do
 * grupo). Em vez de sumir em silêncio:
 * - `naoClassificadas` +1 no contador do dia (só número);
 * - log `[sem-tag] ref=… LLM <código>` (nunca o texto);
 * - `SEM_CREDITO` dispara o alerta de ops do GAB-46 (`alertarSeSemCredito`);
 * - aviso no grupo, citando a mensagem, no máximo 1 a cada 30 min por
 *   processo: "⚠️ não consegui avaliar mensagens sem #crm agora (ref: …).
 *   O que for para o CRM, mande com #crm." — quem mandou venda sabe reenviar.
 * Limitação aceita: se o processo morrer entre o 200 e o fim do `after()`, a
 * mensagem sem tag se perde (não há cópia do texto para retomar).
 *
 * `avaliarSemTag` nunca lança (roda em `after()`).
 */
import { db } from "@/lib/db";
import { registrarErro } from "@/lib/erros/registrar";
import { alertarSeSemCredito, marcarCreditoOk } from "@/lib/llm/alerta-credito";
import { classificar, deveDescartar } from "@/lib/llm/classificacao";
import { ErroLlm } from "@/lib/llm/tipos";
import { contarDescartada, contarNaoClassificada } from "./contadores";
import { enviarWhatsApp } from "./enviar";
import type { MensagemRecebida } from "./payload";
import { processarMensagem, type ResultadoProcessamento } from "./processar";

/** Abaixo disto (sem espaços nas pontas) nem chama a LLM: "ok", "kkkk", "👍👍". */
export const MIN_CARACTERES_SEM_TAG = 8;

/** Curto demais, ou sem nenhuma letra/dígito (só emoji, pontuação, símbolo). */
export function ruidoObvio(texto: string): boolean {
  const t = texto.trim();
  return [...t].length < MIN_CARACTERES_SEM_TAG || !/[\p{L}\p{N}]/u.test(t);
}

export type ResultadoSemTag =
  | { tipo: "DESCARTADA" }
  | { tipo: "NAO_CLASSIFICADA"; ref: string; codigo: string }
  | { tipo: "PERSISTIDA"; mensagemId: string; processamento: ResultadoProcessamento }
  | { tipo: "ERRO"; ref: string };

export const INTERVALO_AVISO_MS = 30 * 60_000;
const g = globalThis as unknown as { __ijUltimoAvisoSemTag?: number };

/** Só para testes: zera o intervalo do aviso. */
export function reiniciarAvisoSemTag() {
  g.__ijUltimoAvisoSemTag = undefined;
}

export function textoNaoClassificada(ref: string): string {
  return `⚠️ não consegui avaliar mensagens sem #crm agora (ref: ${ref}). O que for para o CRM, mande com #crm.`;
}

async function textoRespondido(eventoId: string | null): Promise<string | null> {
  if (!eventoId) return null;
  const anterior =
    (await db.mensagemBruta.findUnique({ where: { eventoId }, select: { texto: true } })) ??
    (await db.mensagemEnviada.findUnique({ where: { eventoId }, select: { texto: true } }));
  return anterior?.texto ?? null;
}

async function avisarFalha(m: MensagemRecebida, ref: string) {
  const agora = Date.now();
  if (g.__ijUltimoAvisoSemTag !== undefined && agora - g.__ijUltimoAvisoSemTag < INTERVALO_AVISO_MS) return;
  g.__ijUltimoAvisoSemTag = agora;
  try {
    await enviarWhatsApp({
      para: m.grupoJid,
      texto: textoNaoClassificada(ref),
      citar: { eventoId: m.eventoId, participant: m.participantJid ?? undefined, texto: m.texto },
    });
  } catch (e) {
    console.error(`[sem-tag] aviso ref=${ref} não enviado: ${e instanceof Error ? e.name : typeof e}`);
  }
}

export async function avaliarSemTag(m: MensagemRecebida, usuarioId: string): Promise<ResultadoSemTag> {
  try {
    let relevante: boolean;
    try {
      const c = await classificar(m.texto, { respondendoA: await textoRespondido(m.respondendoEventoId) }, { ref: m.eventoId });
      relevante = !deveDescartar(c);
      await marcarCreditoOk(); // GAB-46: LLM respondeu → fecha o incidente de sem crédito; nunca lança
    } catch (e) {
      if (!(e instanceof ErroLlm)) throw e;
      const ref = registrarErro("sem-tag", e);
      await contarNaoClassificada(db, m.recebidaEm);
      await avisarFalha(m, ref);
      await alertarSeSemCredito(e, ref); // GAB-46: mesmo alerta de ops do FALHA de `processar.ts`; nunca lança
      return { tipo: "NAO_CLASSIFICADA", ref, codigo: e.codigo };
    }
    if (!relevante) {
      await contarDescartada(db, m.recebidaEm);
      return { tipo: "DESCARTADA" };
    }
    const bruta = await db.mensagemBruta.create({
      data: {
        eventoId: m.eventoId,
        remetenteTelefone: m.remetente.telefone,
        remetenteLid: m.remetente.lid,
        remetenteUsuarioId: usuarioId,
        grupoJid: m.grupoJid,
        texto: m.texto,
        respondendoEventoId: m.respondendoEventoId,
        recebidaEm: m.recebidaEm,
        status: "RECEBIDA",
        semTag: true,
      },
      select: { id: true },
    });
    const processamento = await processarMensagem(bruta.id, { participantJid: m.participantJid });
    return { tipo: "PERSISTIDA", mensagemId: bruta.id, processamento };
  } catch (e) {
    // `registrarErro` não loga mensagem de erro do Prisma (ecoa argumentos).
    return { tipo: "ERRO", ref: registrarErro("sem-tag", e) };
  }
}

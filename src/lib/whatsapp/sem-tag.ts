/**
 * Mensagem do grupo SEM `#crm` (GAB-39; design doc §4.3 passo 4, §2).
 *
 * Ordem (o texto só é gravado se o classificador disser que é de venda):
 * 1. Ingestão (`ingestao.ts`, na tx do dedup): ruído óbvio (`ruidoObvio`) ou
 *    remetente desconhecido → só o contador do dia; nada de LLM. Senão
 *    devolve `CLASSIFICAR` — o `InboxEvento` já fica `PROCESSADO`, então o
 *    retry da Evolution cai em DUPLICADO e não cobra a LLM de novo.
 * 2. Webhook responde 200 e agenda `avaliarSemTagComLimite` em `after()`
 *    (no máximo 3 classificações simultâneas por processo, 50 na fila).
 * 3. `classificar` (LLM, fora de transação). Não relevante ou confiança
 *    abaixo de `LLM_LIMIAR_CLASSIFICADOR` → `contarDescartada`, mais nada:
 *    nem `MensagemBruta`, nem log com texto.
 * 4. Relevante → grava `MensagemBruta` (`semTag = true`, RECEBIDA) e chama
 *    `processarMensagem`, que só AGE com confiança de extração ≥
 *    `LLM_LIMIAR_SEM_TAG` (senão `PENDENTE_REVISAO`, em silêncio no grupo —
 *    só a fila de revisão), apaga a linha se a extração disser IGNORAR com
 *    confiança, e, quando age, confirma com "↪️ entendi como atualização: …".
 *
 * Falha na etapa de classificação (sem crédito, provedor fora, saída
 * inválida, TRUNCADA 2×, banco ao ler a msg respondida, erro inesperado, ou
 * fila do limitador cheia):
 * decisão LGPD-segura — o texto NÃO é persistido (não dá para saber se é
 * dado de venda; guardar "por via das dúvidas" seria guardar conversa do
 * grupo). Para não sumir sem rastro:
 * - `naoClassificadas` +1 no contador do dia (só número);
 * - log `[sem-tag] ref=… LLM <código>` (nunca o texto);
 * - `SEM_CREDITO`/`COTA_DIARIA` dispara o alerta de ops do GAB-46 (`alertarSeSemCredito`);
 * - NADA no grupo (decisão do usuário): nem aviso, nem citação do texto. O
 *   alerta de ops do GAB-46 diz que mensagens sem #crm não são
 *   reprocessadas e quem precisar reenvia com #crm.
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
import { erroSeguro } from "./erro-seguro";
import { criarLimitador, type Limitador } from "./limitador";
import { contarDescartada, contarNaoClassificada } from "./contadores";
import type { MensagemRecebida } from "./payload";
import { processarMensagem, type ResultadoProcessamento } from "./processar";

export type ResultadoSemTag =
  | { tipo: "DESCARTADA" }
  | { tipo: "NAO_CLASSIFICADA"; ref: string; codigo: string }
  | { tipo: "PERSISTIDA"; mensagemId: string; processamento: ResultadoProcessamento }
  | { tipo: "ERRO"; ref: string };

async function textoRespondido(eventoId: string | null): Promise<string | null> {
  if (!eventoId) return null;
  const anterior =
    (await db.mensagemBruta.findUnique({ where: { eventoId }, select: { texto: true } })) ??
    (await db.mensagemEnviada.findUnique({ where: { eventoId }, select: { texto: true } }));
  return anterior?.texto ?? null;
}

/**
 * Classificação falhou — LLM, banco ao ler a msg respondida, erro
 * inesperado ou fila cheia: conta, loga com ref (erro saneado, sem texto)
 * e, se for SEM_CREDITO/COTA_DIARIA, avisa o ops (GAB-46). Nada vai para o grupo.
 */
async function naoClassificada(m: MensagemRecebida, e: unknown, codigo: string): Promise<ResultadoSemTag> {
  const ref = registrarErro("sem-tag", erroSeguro(e));
  await contarNaoClassificada(db, m.recebidaEm);
  await alertarSeSemCredito(e, ref); // GAB-46: mesmo alerta de ops do FALHA de `processar.ts`; nunca lança
  return { tipo: "NAO_CLASSIFICADA", ref, codigo };
}

export async function avaliarSemTag(m: MensagemRecebida, usuarioId: string): Promise<ResultadoSemTag> {
  try {
    let relevante: boolean;
    try {
      const c = await classificar(m.texto, { respondendoA: await textoRespondido(m.respondendoEventoId) }, { ref: m.eventoId });
      relevante = !deveDescartar(c);
    } catch (e) {
      return await naoClassificada(m, e, e instanceof ErroLlm ? e.codigo : "INESPERADO");
    }
    await marcarCreditoOk(); // GAB-46: LLM respondeu → fecha o incidente de sem crédito; nunca lança
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
    return { tipo: "ERRO", ref: registrarErro("sem-tag", erroSeguro(e)) };
  }
}

/**
 * Teto de classificações simultâneas por processo (rajada no grupo não
 * dispara dezenas de chamadas à LLM nem segura conexões do banco). Até
 * `FILA_SEM_TAG` esperam em memória; além disso → NAO_CLASSIFICADA
 * ("FILA_CHEIA": contador + ref + aviso), sem guardar o texto.
 */
export const CONCORRENCIA_SEM_TAG = 3;
export const FILA_SEM_TAG = 50;
const g2 = globalThis as unknown as { __ijLimitadorSemTag?: Limitador };
const limitador = (g2.__ijLimitadorSemTag ??= criarLimitador(CONCORRENCIA_SEM_TAG, FILA_SEM_TAG));

class FilaCheia extends Error {
  constructor() {
    super(`fila de classificação cheia (${CONCORRENCIA_SEM_TAG} rodando + ${FILA_SEM_TAG} esperando)`);
    this.name = "FilaCheia";
  }
}

/** Entrada do webhook (`after()`): `avaliarSemTag` atrás do limitador. Nunca lança. */
export async function avaliarSemTagComLimite(m: MensagemRecebida, usuarioId: string): Promise<ResultadoSemTag> {
  const execucao = limitador.executar(() => avaliarSemTag(m, usuarioId));
  if (execucao) return execucao;
  try {
    return await naoClassificada(m, new FilaCheia(), "FILA_CHEIA");
  } catch (e) {
    return { tipo: "ERRO", ref: registrarErro("sem-tag", erroSeguro(e)) };
  }
}

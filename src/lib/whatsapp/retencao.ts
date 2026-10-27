/**
 * Retenção LGPD do JSON da LLM (GAB-41, decisão do usuário: 90 dias; design
 * doc §4.6). Depois de 90 dias some o que a LLM leu — `mensagem_bruta.resultado_llm`
 * inteiro e a chave `saida` do payload das entradas `MENSAGEM_WHATSAPP` da
 * Timeline. O TEXTO original da mensagem fica (é o registro de venda).
 *
 * Mensagem SEM `#crm` que nunca foi confirmada como venda (`sem_tag` e
 * `FALHA`/`PENDENTE_REVISAO`) some inteira — linha e texto — depois de 30 dias
 * (`apagarSemTagNaoConfirmadas`): é conversa do grupo que ninguém validou.
 *
 * Em lotes (`lote` linhas por UPDATE, no máximo `maxLotes` por execução) e
 * idempotente: o filtro só casa linhas que ainda têm o JSON.
 */
import { db } from "@/lib/db";

export const RETENCAO_LLM_DIAS = 90;
export const RETENCAO_SEM_TAG_DIAS = 30;
const LOTE = 500;
const MAX_LOTES = 20;

export async function apagarJsonLlmVencido(
  opts: { agora?: Date; lote?: number; maxLotes?: number } = {},
): Promise<{ mensagens: number; timeline: number }> {
  const agora = opts.agora ?? new Date();
  const lote = opts.lote ?? LOTE;
  const maxLotes = opts.maxLotes ?? MAX_LOTES;
  const limite = new Date(agora.getTime() - RETENCAO_LLM_DIAS * 86_400_000);
  const r = { mensagens: 0, timeline: 0 };

  for (let i = 0; i < maxLotes; i++) {
    // Linha em andamento fica: o worker vai regravar resultado_llm de qualquer jeito.
    const n = await db.$executeRaw`
      UPDATE mensagem_bruta SET resultado_llm = NULL
       WHERE id IN (SELECT id FROM mensagem_bruta
                     WHERE resultado_llm IS NOT NULL AND recebida_em < ${limite}
                       AND status NOT IN ('RECEBIDA', 'PROCESSANDO')
                     LIMIT ${lote})`;
    r.mensagens += n;
    if (n < lote) break;
  }
  for (let i = 0; i < maxLotes; i++) {
    const n = await db.$executeRaw`
      UPDATE timeline SET payload = payload - 'saida'
       WHERE id IN (SELECT id FROM timeline
                     WHERE tipo = 'MENSAGEM_WHATSAPP' AND em < ${limite} AND jsonb_exists(payload, 'saida')
                     LIMIT ${lote})`;
    r.timeline += n;
    if (n < lote) break;
  }
  return r;
}

export async function apagarSemTagNaoConfirmadas(opts: { agora?: Date; lote?: number; maxLotes?: number } = {}): Promise<number> {
  const agora = opts.agora ?? new Date();
  const lote = opts.lote ?? LOTE;
  const maxLotes = opts.maxLotes ?? MAX_LOTES;
  const limite = new Date(agora.getTime() - RETENCAO_SEM_TAG_DIAS * 86_400_000);
  let total = 0;
  for (let i = 0; i < maxLotes; i++) {
    // Defesa: linha citada na Timeline (resolvida e depois reaberta?) fica — nunca quebra a FK.
    const n = await db.$executeRaw`
      DELETE FROM mensagem_bruta
       WHERE id IN (SELECT m.id FROM mensagem_bruta m
                     WHERE m.sem_tag AND m.status IN ('FALHA', 'PENDENTE_REVISAO') AND m.recebida_em < ${limite}
                       AND NOT EXISTS (SELECT 1 FROM timeline t WHERE t.mensagem_bruta_id = m.id)
                     LIMIT ${lote})`;
    total += n;
    if (n < lote) break;
  }
  return total;
}

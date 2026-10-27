/**
 * Retenção LGPD do JSON da LLM (GAB-41, decisão do usuário: 90 dias; design
 * doc §4.6). Depois de 90 dias some o que a LLM leu — `mensagem_bruta.resultado_llm`
 * inteiro e a chave `saida` do payload das entradas `MENSAGEM_WHATSAPP` da
 * Timeline. O TEXTO original da mensagem fica (é o registro de venda).
 *
 * Em lotes (`lote` linhas por UPDATE, no máximo `maxLotes` por execução) e
 * idempotente: o filtro só casa linhas que ainda têm o JSON.
 */
import { db } from "@/lib/db";

export const RETENCAO_LLM_DIAS = 90;
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

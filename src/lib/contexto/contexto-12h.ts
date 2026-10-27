/**
 * Contexto de 12 h para a extração (GAB-49), num ponto só para o
 * `montarContexto` de `whatsapp/processar.ts`:
 * - `historico`: ledger do remetente na janela atual ANTES desta mensagem;
 * - `cards`: cards que as mensagens do ledger mexeram na janela (consulta
 *   própria, não o ledger cortado; viram candidatas `via: ledger`);
 * - `resumoAnterior`: o resumo PRONTO da janela anterior, só lido. Ausente ou
 *   `GERANDO` → a extração segue sem ele, nunca espera a LLM do resumo.
 *   Faltando (e a mensagem sendo da janela corrente), a geração é disparada
 *   em paralelo e a promessa vai para `pendentes`, que `processarMensagem`
 *   aguarda só no fim (dentro do `after()`). Mensagem reprocessada de outra
 *   janela não dispara (a retenção já descartou aquela janela).
 * Nunca lança: erro de banco vira log com ref e contexto vazio.
 */
import { registrarErro } from "@/lib/erros/registrar";
import type { EntradaHistorico } from "@/lib/llm/prompts/extracao.v2";
import { erroSeguro } from "@/lib/whatsapp/erro-seguro";
import { janelaDe } from "./janela";
import { cardsDaJanela, ledgerDaJanela } from "./ledger";
import { gerarResumoJanelaAnterior, lerResumoJanelaAnterior } from "./resumo";

export type Contexto12h = { historico: EntradaHistorico[]; cards: string[]; resumoAnterior: string | null };

const VAZIO: Contexto12h = { historico: [], cards: [], resumoAnterior: null };

export async function contexto12h(
  m: { id?: string; remetenteUsuarioId: string | null; recebidaEm: Date },
  opts: { agora?: Date; pendentes?: Promise<unknown>[] } = {},
): Promise<Contexto12h> {
  if (!m.remetenteUsuarioId) return VAZIO;
  const usuarioId = m.remetenteUsuarioId;
  const agora = opts.agora ?? new Date();
  try {
    const janela = janelaDe(m.recebidaEm);
    const corrente = janela.inicio.getTime() === janelaDe(agora).inicio.getTime();
    const recorte = { usuarioId, janela, ate: m.recebidaEm, excluirId: m.id };
    const [ledger, cards, resumoAnterior] = await Promise.all([
      ledgerDaJanela(recorte),
      cardsDaJanela(recorte),
      corrente ? lerResumoJanelaAnterior(usuarioId, agora) : null,
    ]);
    // Não espera: a LLM do resumo nunca atrasa a extração desta mensagem.
    if (corrente && resumoAnterior === null) opts.pendentes?.push(gerarResumoJanelaAnterior(usuarioId, agora));
    return { historico: ledger.map(({ em, texto, card }) => ({ em, texto, card })), cards, resumoAnterior };
  } catch (e) {
    registrarErro("contexto-12h", erroSeguro(e));
    return VAZIO;
  }
}

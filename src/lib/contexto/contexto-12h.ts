/**
 * Contexto de 12 h para a extração (GAB-49), num ponto só para o
 * `montarContexto` de `whatsapp/processar.ts`:
 * - `historico`: ledger do remetente na janela atual ANTES desta mensagem;
 * - `cards`: cards que esse ledger mexeu (viram candidatas `via: ledger`);
 * - `resumoAnterior`: resumo da janela anterior (gerado sob demanda só quando
 *   a mensagem é da janela corrente — reprocessar uma mensagem antiga não
 *   gera resumo de uma janela que a retenção já descartou).
 * Nunca lança: erro de banco vira log com ref e contexto vazio.
 */
import { registrarErro } from "@/lib/erros/registrar";
import type { EntradaHistorico } from "@/lib/llm/prompts/extracao.v2";
import { erroSeguro } from "@/lib/whatsapp/erro-seguro";
import { janelaDe } from "./janela";
import { cardsDoLedger, ledgerDaJanela } from "./ledger";
import { resumoJanelaAnterior } from "./resumo";

export type Contexto12h = { historico: EntradaHistorico[]; cards: string[]; resumoAnterior: string | null };

const VAZIO: Contexto12h = { historico: [], cards: [], resumoAnterior: null };

export async function contexto12h(m: { id?: string; remetenteUsuarioId: string | null; recebidaEm: Date }, agora: Date = new Date()): Promise<Contexto12h> {
  if (!m.remetenteUsuarioId) return VAZIO;
  try {
    const janela = janelaDe(m.recebidaEm);
    const ledger = await ledgerDaJanela({ usuarioId: m.remetenteUsuarioId, janela, ate: m.recebidaEm, excluirId: m.id });
    const corrente = janela.inicio.getTime() === janelaDe(agora).inicio.getTime();
    const resumoAnterior = corrente ? await resumoJanelaAnterior(m.remetenteUsuarioId, agora) : null;
    return { historico: ledger.map(({ em, texto, card }) => ({ em, texto, card })), cards: cardsDoLedger(ledger), resumoAnterior };
  } catch (e) {
    registrarErro("contexto-12h", erroSeguro(e));
    return VAZIO;
  }
}

/**
 * Manutenção periódica chamada por `POST /api/cron/reprocessar` (GAB-41; o
 * cron do host roda `scripts/cron-reprocessar.sh` a cada 10 min).
 *
 * - Uma execução por vez: trava por aluguel de linha (`trava.ts`, 10 min),
 *   sem segurar conexão do pool. O trabalho para de começar coisa nova em
 *   4 min (`PRAZO_EXECUCAO_MS`), bem antes do aluguel vencer. Processo que
 *   morre sem soltar libera a trava quando o aluguel vence.
 * - Cada passo é isolado: erro vira log com ref e os outros seguem. `ERRO`
 *   do reprocessamento (banco/config fora) também entra em `erros` → 500.
 * - Devolve SÓ contagens (e refs de erro): nunca texto, telefone ou id.
 */
import { apagarSessoesExpiradas } from "@/lib/auth/sessao";
import { aplicarRetencaoResumos, gerarResumosPendentes } from "@/lib/contexto/resumo";
import { registrarErro } from "@/lib/erros/registrar";
import { purgarVencidas } from "@/lib/importacao/pipefy/servico";
import { PRAZO_EXECUCAO_MS, retomarPendentes, type ContagemRetomada } from "@/lib/whatsapp/reprocessar";
import { apagarJsonLlmVencido, apagarSemTagNaoConfirmadas } from "@/lib/whatsapp/retencao";
import { pegarTrava, soltarTrava } from "./trava";

const NOME_TRAVA = "reprocessar";
/** Aluguel da trava: > 2× o prazo de trabalho (4 min) e < intervalo do cron (10 min). */
export const DURACAO_TRAVA_MS = 9 * 60_000;
/**
 * Prazo dos resumos do GAB-49 (checado entre vendedores; uma chamada de LLM
 * em andamento pode passar ~60 s). Com o reprocessamento parando de começar
 * coisa nova no prazo global (início + 4 min), a execução fica bem dentro do aluguel.
 */
export const PRAZO_RESUMOS_MS = 60_000;

export type Manutencao = {
  ok: true;
  reprocessamento: Omit<ContagemRetomada, "refs"> | null;
  retencao: { mensagens: number; timeline: number } | null;
  semTagApagadas: number | null;
  /** GAB-49: resumos de 12 h gerados para a janela anterior. */
  resumos: { gerados: number; interrompido: boolean } | null;
  /** GAB-49: resumos de janelas antigas apagados. */
  resumosApagados: number | null;
  previasPurgadas: number | null;
  sessoesExpiradas: number | null;
  /** Refs dos passos que falharam (causa no log do servidor com a mesma ref). */
  erros: string[];
};

export type ResultadoManutencao = { tipo: "EM_ANDAMENTO" } | { tipo: "OK"; resumo: Manutencao };

async function passo<T>(nome: string, erros: string[], corpo: () => Promise<T>): Promise<T | null> {
  try {
    return await corpo();
  } catch (e) {
    erros.push(registrarErro(`cron.${nome}`, e));
    return null;
  }
}

async function executar(): Promise<Manutencao> {
  const erros: string[] = [];
  const prazo = new Date(Date.now() + PRAZO_EXECUCAO_MS);
  // Baratos primeiro; o reprocessamento (LLM) por último, limitado por prazo.
  const retencao = await passo("retencao", erros, () => apagarJsonLlmVencido());
  const semTagApagadas = await passo("semTag", erros, () => apagarSemTagNaoConfirmadas());
  const previasPurgadas = await passo("previas", erros, () => purgarVencidas());
  const sessoesExpiradas = await passo("sessoes", erros, () => apagarSessoesExpiradas());
  const resumosApagados = await passo("resumosRetencao", erros, () => aplicarRetencaoResumos());
  // GAB-49: resumo das janelas de 12 h fechadas, antes do reprocessamento (o
  // contexto das mensagens reprocessadas já encontra o resumo da janela anterior).
  const resumos = await passo("resumos", erros, () => gerarResumosPendentes(new Date(), { prazoMs: PRAZO_RESUMOS_MS }));
  const retomada = await passo("reprocessar", erros, () => retomarPendentes({ prazo }));
  let reprocessamento: Manutencao["reprocessamento"] = null;
  if (retomada) {
    const { refs, ...contagem } = retomada;
    erros.push(...refs);
    reprocessamento = contagem;
  }
  return { ok: true, reprocessamento, retencao, semTagApagadas, resumos, resumosApagados, previasPurgadas, sessoesExpiradas, erros };
}

export async function rodarManutencao(): Promise<ResultadoManutencao> {
  const dono = await pegarTrava(NOME_TRAVA, DURACAO_TRAVA_MS);
  if (!dono) return { tipo: "EM_ANDAMENTO" };
  try {
    return { tipo: "OK", resumo: await executar() };
  } finally {
    try {
      await soltarTrava(NOME_TRAVA, dono);
    } catch (e) {
      // Não soltou: vence sozinha em DURACAO_TRAVA_MS.
      registrarErro("cron.trava", e);
    }
  }
}

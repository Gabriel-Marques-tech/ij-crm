/**
 * Manutenção periódica chamada por `POST /api/cron/reprocessar` (GAB-41; o
 * cron do host roda `scripts/cron-reprocessar.sh` a cada 10 min).
 *
 * - Uma execução por vez: `pg_try_advisory_xact_lock` numa transação que fica
 *   aberta (sem tocar em linha nenhuma) enquanto os passos rodam com o `db`
 *   normal. Quem chega com o lock tomado sai na hora com `EM_ANDAMENTO`. Se o
 *   processo morrer, a conexão cai e o Postgres solta o lock.
 * - Cada passo é isolado: erro vira log com ref e os outros seguem.
 * - Devolve SÓ contagens (e refs de erro): nunca texto, telefone ou id.
 */
import { db } from "@/lib/db";
import { apagarSessoesExpiradas } from "@/lib/auth/sessao";
import { registrarErro } from "@/lib/erros/registrar";
import { purgarVencidas } from "@/lib/importacao/pipefy/servico";
import { retomarPendentes, type ContagemRetomada } from "@/lib/whatsapp/reprocessar";
import { apagarJsonLlmVencido } from "@/lib/whatsapp/retencao";

/** Chave fixa do advisory lock ("IJ41" em hex). */
const CHAVE_LOCK = 0x494a3431;
/** Teto da transação que segura o lock (o script do cron desiste em 300 s). */
const TIMEOUT_LOCK_MS = 9 * 60_000;

export type Manutencao = {
  ok: true;
  reprocessamento: ContagemRetomada | null;
  retencao: { mensagens: number; timeline: number } | null;
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
  // Baratos primeiro; o reprocessamento (LLM) por último, limitado por prazo.
  const retencao = await passo("retencao", erros, () => apagarJsonLlmVencido());
  const previasPurgadas = await passo("previas", erros, () => purgarVencidas());
  const sessoesExpiradas = await passo("sessoes", erros, () => apagarSessoesExpiradas());
  // TODO(GAB-49): quando o ledger de contexto de 12 h estiver na main, chamar
  // aqui a geração de resumo das janelas fechadas, ex.:
  //   const resumos = await passo("resumos", erros, () => gerarResumosDeJanelasFechadas());
  const reprocessamento = await passo("reprocessar", erros, () => retomarPendentes());
  return { ok: true, reprocessamento, retencao, previasPurgadas, sessoesExpiradas, erros };
}

export async function rodarManutencao(): Promise<ResultadoManutencao> {
  let resumo: Manutencao | null = null;
  try {
    const tomou = await db.$transaction(
      async (tx) => {
        const [{ ok }] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(${CHAVE_LOCK}::bigint) AS ok`;
        if (!ok) return false;
        resumo = await executar();
        return true;
      },
      { timeout: TIMEOUT_LOCK_MS, maxWait: 10_000 },
    );
    if (!tomou) return { tipo: "EM_ANDAMENTO" };
  } catch (e) {
    // Trabalho feito e só o commit da tx do lock falhou (ex.: passou do teto): vale o resumo.
    if (!resumo) throw e;
    (resumo as Manutencao).erros.push(registrarErro("cron.lock", e));
  }
  return { tipo: "OK", resumo: resumo! };
}

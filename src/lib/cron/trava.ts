/**
 * Trava do cron por aluguel de linha (`trava_cron`, GAB-41). Não segura
 * conexão do pool durante a execução: pegar = um UPDATE condicional que só
 * casa se a trava estiver livre ou vencida; soltar = UPDATE condicionado ao
 * `dono`. Processo que morre sem soltar libera a trava quando o aluguel vence.
 * Quem chama mantém o trabalho bem abaixo da duração do aluguel.
 */
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";

/** Devolve o token de dono, ou `null` se outra execução segura a trava. */
export async function pegarTrava(nome: string, duracaoMs: number): Promise<string | null> {
  await db.$executeRaw`INSERT INTO trava_cron (nome) VALUES (${nome}) ON CONFLICT (nome) DO NOTHING`;
  const dono = randomUUID();
  const linhas = await db.$queryRaw<{ ok: number }[]>`
    UPDATE trava_cron
       SET dono = ${dono}, expira_em = now() + make_interval(secs => ${duracaoMs / 1000})
     WHERE nome = ${nome} AND (expira_em IS NULL OR expira_em < now())
 RETURNING 1 AS ok`;
  return linhas.length === 1 ? dono : null;
}

/** Solta só se ainda for o dono (aluguel vencido e retomado por outro → não mexe). */
export async function soltarTrava(nome: string, dono: string): Promise<void> {
  await db.$executeRaw`UPDATE trava_cron SET dono = NULL, expira_em = NULL WHERE nome = ${nome} AND dono = ${dono}`;
}

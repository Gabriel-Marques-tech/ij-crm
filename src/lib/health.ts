/**
 * Checagem de saúde do banco para GET /api/health (GAB-30).
 *
 * Rota pública: não pode virar um jeito barato de ocupar o pool do Prisma.
 *  - resultado fica em cache no processo por CACHE_MS (5s);
 *  - chamadas simultâneas compartilham a MESMA consulta em andamento;
 *  - a consulta roda com `SET LOCAL statement_timeout` (o Postgres corta) e um
 *    prazo no Node (cobre espera por conexão do pool).
 * Nunca devolve nem loga a mensagem do erro (pode trazer host/usuário do banco).
 */
import { db } from "@/lib/db";

export const CACHE_MS = 5_000;
export const PRAZO_MS = 3_000;
const STATEMENT_TIMEOUT_MS = 2_000;

type Resultado = { ok: boolean; em: number };

let ultimo: Resultado | undefined;
let emAndamento: Promise<boolean> | undefined;

async function consultar(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const prazo = new Promise<never>((_, rejeitar) => {
      timer = setTimeout(() => rejeitar(new Error("prazo esgotado")), PRAZO_MS);
    });
    await Promise.race([
      db.$transaction([
        db.$executeRawUnsafe(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`),
        db.$queryRaw`SELECT 1`,
      ]),
      prazo,
    ]);
    return true;
  } catch (e) {
    console.error(`[health] banco indisponível (${e instanceof Error ? e.name : "erro"})`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** `true` se o banco respondeu. Reaproveita o último resultado por até CACHE_MS. */
export async function bancoSaudavel(agora: number = Date.now()): Promise<boolean> {
  if (ultimo && agora - ultimo.em < CACHE_MS) return ultimo.ok;
  emAndamento ??= consultar().then((ok) => {
    ultimo = { ok, em: Date.now() };
    emAndamento = undefined;
    return ok;
  });
  return emAndamento;
}

/** Só para testes. */
export function resetarCacheSaude() {
  ultimo = undefined;
  emAndamento = undefined;
}

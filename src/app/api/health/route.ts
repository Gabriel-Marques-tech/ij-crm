/**
 * GET /api/health — liveness + banco, para o healthcheck do compose e o
 * `scripts/deploy.sh` (GAB-30). Público (lista PUBLICAS em `proxy.ts`).
 *
 * 200 `{status:"ok"}` se o Postgres responde a `SELECT 1` em até 3s; senão
 * 503 `{status:"indisponivel"}`. Nunca expõe nem loga a mensagem do erro
 * (pode trazer host/usuário do banco) — só o nome da classe do erro.
 */
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRAZO_MS = 3_000;

function resposta(status: 200 | 503) {
  return Response.json(
    { status: status === 200 ? "ok" : "indisponivel" },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function GET() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const prazo = new Promise<never>((_, rejeitar) => {
      timer = setTimeout(() => rejeitar(new Error("prazo esgotado")), PRAZO_MS);
    });
    await Promise.race([db.$queryRaw`SELECT 1`, prazo]);
    return resposta(200);
  } catch (e) {
    console.error(`[health] banco indisponível (${e instanceof Error ? e.name : "erro"})`);
    return resposta(503);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET /api/health — liveness + banco, para o healthcheck do compose e o
 * `scripts/deploy.sh` (GAB-30). Público (lista PUBLICAS em `proxy.ts`).
 *
 * 200 `{status:"ok"}` se o Postgres responde; senão 503 `{status:"indisponivel"}`.
 * Cache de 5s, consultas simultâneas coalescidas e statement_timeout curto:
 * ver `src/lib/health.ts`.
 */
import { bancoSaudavel } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const ok = await bancoSaudavel();
  return Response.json(
    { status: ok ? "ok" : "indisponivel" },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}

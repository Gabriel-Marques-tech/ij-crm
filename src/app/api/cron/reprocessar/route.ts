/**
 * POST /api/cron/reprocessar (GAB-41) — chamado a cada 10 min por
 * `scripts/cron-reprocessar.sh` com o header `x-cron-secret`.
 *
 * - O header é o ÚNICO controle de acesso (o filtro do Caddy é só ruído a
 *   menos). `CRON_SECRET` ausente, placeholder ou curto ⇒ 401 para tudo
 *   (falha fechado) + log do motivo; comparação em tempo constante.
 * - 200 com contagens; 200 `{emAndamento:true}` se outra execução segura o
 *   lock; 500 com contagens + refs se algum passo falhou (o script loga só o
 *   status). Nunca conteúdo de mensagem nem dado pessoal na resposta.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { diagnosticarSegredo, segredoCron } from "@/lib/config/env";
import { rodarManutencao } from "@/lib/cron/manutencao";
import { registrarErro } from "@/lib/erros/registrar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEM_CACHE = { "cache-control": "no-store" };

/** Compara os hashes (mesmo tamanho sempre): nem o tamanho do segredo vaza pelo tempo. */
function iguais(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function autorizado(req: Request): boolean {
  const esperado = segredoCron();
  if (!esperado) {
    const d = diagnosticarSegredo("CRON_SECRET");
    console.error(`[cron] CRON_SECRET inutilizável (${d.ok ? "ok" : d.motivo}): recusando com 401. Gere com openssl rand -hex 32`);
    return false;
  }
  const recebido = req.headers.get("x-cron-secret");
  return recebido !== null && iguais(recebido, esperado);
}

export async function POST(req: Request): Promise<Response> {
  if (!autorizado(req)) return Response.json({ erro: "não autorizado" }, { status: 401, headers: SEM_CACHE });
  try {
    const r = await rodarManutencao();
    if (r.tipo === "EM_ANDAMENTO") return Response.json({ ok: true, emAndamento: true }, { headers: SEM_CACHE });
    const { resumo } = r;
    console.info(
      `[cron] reprocessar tentadas=${resumo.reprocessamento?.tentadas ?? "-"} processadas=${resumo.reprocessamento?.processadas ?? "-"} falhas=${resumo.reprocessamento?.falhas ?? "-"} retencao=${resumo.retencao?.mensagens ?? "-"}/${resumo.retencao?.timeline ?? "-"} erros=${resumo.erros.length}`,
    );
    return Response.json(resumo, { status: resumo.erros.length ? 500 : 200, headers: SEM_CACHE });
  } catch (e) {
    const ref = registrarErro("cron", e);
    return Response.json({ erro: "INESPERADO", ref }, { status: 500, headers: SEM_CACHE });
  }
}

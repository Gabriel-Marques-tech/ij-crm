/**
 * POST /api/webhooks/evolution — entrada do pipeline (design doc §4.3).
 *
 * Público (fora do guard de sessão em `proxy.ts`), protegido por segredo.
 * Duas formas de autenticar, ambas em comparação de tempo constante:
 *   1. header `x-webhook-secret` (ou `apikey`) == EVOLUTION_WEBHOOK_SECRET —
 *      preferida; vem dos `webhook.headers` configurados na instância (README);
 *   2. fallback: campo `apikey` do CORPO == EVOLUTION_API_KEY — a Evolution v2
 *      põe o token da instância no corpo (não em header), então a instância
 *      precisa ser criada com `token = EVOLUTION_API_KEY`.
 * Segredo ausente ou fraco (ver `src/lib/config/env.ts`) ⇒ aquela forma não
 * existe; sem nenhuma forma válida ⇒ 401 para tudo (falha fechada).
 *
 * Códigos: 401 não autenticado, 503 sem GRUPO_JID ou config técnica ilegível
 * (GAB-42), 400 corpo não-JSON (a
 * Evolution não re-tenta 4xx), 500 falha de processamento (re-tenta; o dedup
 * é atômico). Nunca logamos corpo, texto ou mensagens de erro do Prisma
 * (elas ecoam os argumentos da query, inclusive o texto).
 */
import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { chaveApiEvolution, diagnosticarSegredo, grupoJid, segredoWebhook } from "@/lib/config/env";
import { carregarConfigTecnica } from "@/lib/config/tecnica";
import { contarNaoAutorizado, registrarLogWebhook } from "@/lib/logs/tecnicos";
import { ingerirMensagem } from "@/lib/whatsapp/ingestao";
import { mascararJid } from "@/lib/whatsapp/mascarar";
import { interpretarPayload } from "@/lib/whatsapp/payload";
import { processarMensagem } from "@/lib/whatsapp/processar";

export const runtime = "nodejs";

function iguais(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function segredoDoHeader(req: Request): string | null {
  return req.headers.get("x-webhook-secret") ?? req.headers.get("apikey");
}

function apikeyDoCorpo(json: unknown): string | null {
  const v = (json as { apikey?: unknown } | null)?.apikey;
  return typeof v === "string" && v ? v : null;
}

type Autenticacao = { ok: true; via: "header" | "corpo" } | { ok: false };

/** `json` é `undefined` quando o corpo não era JSON — só o header pode autenticar então. */
function autenticar(req: Request, json: unknown): Autenticacao {
  const segredo = segredoWebhook();
  const doHeader = segredoDoHeader(req);
  if (segredo && doHeader && iguais(doHeader, segredo)) return { ok: true, via: "header" };

  const chave = chaveApiEvolution();
  const doCorpo = json === undefined ? null : apikeyDoCorpo(json);
  if (chave && doCorpo && iguais(doCorpo, chave)) return { ok: true, via: "corpo" };

  if (!segredo && !chave) {
    const a = diagnosticarSegredo("EVOLUTION_WEBHOOK_SECRET");
    const b = diagnosticarSegredo("EVOLUTION_API_KEY");
    console.error(
      `[webhook] nenhum segredo utilizável: EVOLUTION_WEBHOOK_SECRET ${a.ok ? "ok" : a.motivo}, EVOLUTION_API_KEY ${b.ok ? "ok" : b.motivo}; recusando com 401`,
    );
  }
  return { ok: false };
}

function descreverErro(e: unknown): string {
  if (!(e instanceof Error)) return typeof e;
  const codigo = (e as { code?: unknown }).code;
  return typeof codigo === "string" ? `${e.name} ${codigo}` : e.name;
}

/**
 * GAB-42: grava uma linha em `log_webhook` — tipo do evento, chat mascarado,
 * resultado e duração; nunca corpo/texto. 401 não entra no anel (só no
 * contador em memória). A config técnica é carregada em `tratar`, depois da
 * autenticação.
 */
export async function POST(req: Request): Promise<Response> {
  const inicio = performance.now();
  const copia = req.clone();
  const res = await tratar(req);
  if (res.status === 401) {
    contarNaoAutorizado();
    return res;
  }
  const ms = performance.now() - inicio;
  const copiaRes = res.clone(); // o corpo original vai para a Evolution
  // Depois da resposta (como o processamento): o log não atrasa a Evolution.
  after(async () => {
    let tipo: string | null = null;
    let chat: string | null = null;
    try {
      const j = JSON.parse(await copia.text()) as { event?: unknown; data?: { key?: { remoteJid?: unknown } } } | null;
      tipo = typeof j?.event === "string" ? j.event : null;
      chat = typeof j?.data?.key?.remoteJid === "string" ? j.data.key.remoteJid : null;
    } catch {
      // corpo não-JSON: fica sem tipo/chat
    }
    await registrarLogWebhook({ tipo, chat, status: res.status, resultado: await resultadoDe(copiaRes), ms });
  });
  return res;
}

/** Resumo do corpo JSON da resposta (só chaves/códigos nossos). */
async function resultadoDe(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as Record<string, unknown>;
    if (typeof j.erro === "string") return j.erro;
    if (j.ignorado) return `ignorado:${typeof j.motivo === "string" ? j.motivo : "?"}`;
    for (const k of ["duplicado", "remetenteDesconhecido", "descartada", "persistida"]) if (j[k]) return k;
    return "ok";
  } catch {
    return `http_${res.status}`;
  }
}

async function tratar(req: Request): Promise<Response> {
  // O corpo é lido antes da autenticação porque o fallback está nele — mas
  // nada dele é logado nem interpretado enquanto a autenticação não passar.
  const bruto = await req.text();
  let json: unknown;
  try {
    json = JSON.parse(bruto);
  } catch {
    json = undefined;
  }

  const auth = autenticar(req, json);
  if (!auth.ok) return Response.json({ erro: "nao_autorizado" }, { status: 401 });
  if (json === undefined) return Response.json({ erro: "json_invalido" }, { status: 400 });

  // GAB-42: GRUPO_JID do Admin > env. Sem conseguir ler a config, falha
  // fechado (503: a Evolution re-tenta) em vez de usar um grupo talvez velho.
  const carga = await carregarConfigTecnica();
  if (!carga.ok) {
    console.error(`[webhook] config técnica indisponível (ref=${carga.ref}); recusando com 503`);
    return Response.json({ erro: "config_indisponivel", ref: carga.ref }, { status: 503 });
  }

  const grupo = grupoJid();
  if (!grupo) {
    console.error("[webhook] GRUPO_JID não configurado; recusando com 503");
    return Response.json({ erro: "grupo_nao_configurado" }, { status: 503 });
  }

  const interpretacao = interpretarPayload(json, grupo);
  if (interpretacao.tipo === "IGNORAR") {
    if (interpretacao.motivo === "PAYLOAD_INVALIDO") {
      console.warn(`[webhook] payload inválido; campos: ${interpretacao.caminhos.join(", ")}`);
    } else {
      console.info(`[webhook] ignorado: ${interpretacao.motivo}`);
    }
    return Response.json({ ok: true, ignorado: true, motivo: interpretacao.motivo });
  }

  const { mensagem } = interpretacao;
  let resultado: Awaited<ReturnType<typeof ingerirMensagem>>;
  try {
    resultado = await ingerirMensagem(mensagem);
  } catch (e) {
    console.error(`[webhook] falha ao processar evento ${mensagem.eventoId}: ${descreverErro(e)}`);
    return Response.json({ erro: "falha_processamento" }, { status: 500 });
  }

  switch (resultado.tipo) {
    case "DUPLICADO":
      return Response.json({ ok: true, duplicado: true });
    case "REMETENTE_DESCONHECIDO":
      console.info(`[webhook] remetente desconhecido ${mascararJid(mensagem.remetente.lid ?? mensagem.remetente.telefone ?? "?")}`);
      return Response.json({ ok: true, remetenteDesconhecido: true });
    case "DESCARTADA":
      return Response.json({ ok: true, descartada: true });
    case "PERSISTIDA": {
      // 200 primeiro, LLM + confirmação depois (GAB-34): a Evolution não espera.
      // `processarMensagem` reivindica a linha RECEBIDA atomicamente e nunca
      // lança por erro de LLM/aplicação (vira FALHA + "❌ … ref"); o catch é
      // só para o inesperado (ex.: banco fora) — o cron (GAB-41) retoma.
      const mensagemId = resultado.mensagemId;
      after(async () => {
        try {
          await processarMensagem(mensagemId, { participantJid: mensagem.participantJid });
        } catch (e) {
          console.error(`[webhook] processamento da mensagem ${mensagemId} falhou: ${descreverErro(e)}`);
        }
      });
      return Response.json({ ok: true, persistida: true, mensagemId: resultado.mensagemId });
    }
  }
}

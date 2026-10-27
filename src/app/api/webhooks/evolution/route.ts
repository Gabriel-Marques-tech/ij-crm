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
 * Códigos: 401 não autenticado, 503 sem GRUPO_JID, 400 corpo não-JSON (a
 * Evolution não re-tenta 4xx), 500 falha de processamento (re-tenta; o dedup
 * é atômico). Nunca logamos corpo, texto ou mensagens de erro do Prisma
 * (elas ecoam os argumentos da query, inclusive o texto).
 */
import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { chaveApiEvolution, diagnosticarSegredo, grupoJid, segredoWebhook } from "@/lib/config/env";
import { ingerirMensagem } from "@/lib/whatsapp/ingestao";
import { mascararJid } from "@/lib/whatsapp/mascarar";
import { interpretarPayload } from "@/lib/whatsapp/payload";
import { processarMensagem } from "@/lib/whatsapp/processar";
import { avaliarSemTag } from "@/lib/whatsapp/sem-tag";

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

export async function POST(req: Request): Promise<Response> {
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
    case "CLASSIFICAR": {
      const usuarioId = resultado.usuarioId;
      // Sem #crm (GAB-39): o classificador (LLM) roda depois do 200 e só ele
      // decide se o texto é gravado. `avaliarSemTag` nunca lança.
      after(() => avaliarSemTag(mensagem, usuarioId));
      return Response.json({ ok: true, emAvaliacao: true });
    }
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

/**
 * POST /api/webhooks/evolution — entrada do pipeline (design doc §4.3).
 *
 * Público (fora do guard de sessão em `proxy.ts`), protegido por segredo no
 * header. A Evolution v2 NÃO manda a apikey da instância como header — ela vai
 * no corpo; o header vem dos `webhook.headers` configurados na instância
 * (README). Aceitamos `apikey` ou `x-webhook-secret`.
 *
 * Códigos: 401 segredo ausente/errado (ou não configurado — falha fechada),
 * 503 sem GRUPO_JID, 400 corpo não-JSON (a Evolution não re-tenta 4xx),
 * 500 falha de processamento (a Evolution re-tenta; o dedup é atômico).
 */
import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { grupoJid, segredoWebhook } from "@/lib/config/env";
import { enviarWhatsApp } from "@/lib/whatsapp/enviar";
import { ingerirMensagem, TEXTO_CONFIRMACAO } from "@/lib/whatsapp/ingestao";
import { mascararJid } from "@/lib/whatsapp/mascarar";
import { interpretarPayload } from "@/lib/whatsapp/payload";

export const runtime = "nodejs";

function segredoConfere(req: Request): boolean {
  const esperado = segredoWebhook();
  if (!esperado) return false;
  const recebido = req.headers.get("apikey") ?? req.headers.get("x-webhook-secret");
  if (!recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request): Promise<Response> {
  if (!segredoConfere(req)) return Response.json({ erro: "nao_autorizado" }, { status: 401 });

  const grupo = grupoJid();
  if (!grupo) {
    console.error("[webhook] GRUPO_JID não configurado; recusando com 503");
    return Response.json({ erro: "grupo_nao_configurado" }, { status: 503 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ erro: "json_invalido" }, { status: 400 });
  }

  const interpretacao = interpretarPayload(json, grupo);
  if (interpretacao.tipo === "IGNORAR") {
    // Sem conteúdo no log: só o motivo (design doc §4.6).
    console.info(`[webhook] ignorado: ${interpretacao.motivo}`);
    return Response.json({ ok: true, ignorado: true, motivo: interpretacao.motivo });
  }

  const { mensagem } = interpretacao;
  let resultado: Awaited<ReturnType<typeof ingerirMensagem>>;
  try {
    resultado = await ingerirMensagem(mensagem);
  } catch (e) {
    console.error(`[webhook] falha ao processar evento ${mensagem.eventoId}:`, e instanceof Error ? e.message : e);
    return Response.json({ erro: "falha_processamento" }, { status: 500 });
  }

  switch (resultado.tipo) {
    case "DUPLICADO":
      return Response.json({ ok: true, duplicado: true });
    case "REMETENTE_DESCONHECIDO":
      console.info(`[webhook] remetente desconhecido ${mascararJid(mensagem.remetente.telefone ?? mensagem.remetente.lid ?? "?")}`);
      return Response.json({ ok: true, remetenteDesconhecido: true });
    case "DESCARTADA":
      return Response.json({ ok: true, descartada: true });
    case "PERSISTIDA": {
      // 200 primeiro, confirmação depois: a Evolution não espera o envio.
      after(async () => {
        try {
          await enviarWhatsApp({
            para: mensagem.grupoJid,
            texto: TEXTO_CONFIRMACAO,
            citar: { eventoId: mensagem.eventoId, participant: mensagem.participantJid ?? undefined },
          });
        } catch (e) {
          console.error(`[webhook] confirmação do evento ${mensagem.eventoId} não enviada:`, e instanceof Error ? e.message : e);
        }
      });
      return Response.json({ ok: true, persistida: true, mensagemId: resultado.mensagemId });
    }
  }
}

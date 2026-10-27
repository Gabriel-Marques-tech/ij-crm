/**
 * Alerta de "sem crédito na API de LLM" (GAB-46). A recarga é manual (saldo
 * pré-pago, sem auto-reload): quando uma chamada falha com `SEM_CREDITO`,
 * toda mensagem #crm passa a cair em FALHA. Padrão herdado do LocPay
 * (`openai-credit-alert.service.ts`, incidente de 05/08/2026: saldo zerou e
 * ninguém percebeu por 40 min).
 *
 * - Avisa `ALERTA_OPS_JID` (número/grupo de operações) pelo sender de sempre
 *   (`enviarWhatsApp`, timeout de 60 s). Vazio = sem aviso; banner continua.
 * - Cooldown no banco (linha `alerta_operacional`), não em memória: sobrevive
 *   a restart e é atômico entre requests concorrentes. 6 h depois de um aviso
 *   entregue; 5 min se o envio falhou.
 * - Safe mode (`NOTIFICATIONS_ENABLED`≠true): só loga, sem consumir cooldown.
 * - Entrega confirmada pela Evolution conta como avisado mesmo se algo falhar
 *   depois (`ErroPosEnvio`), e o UPDATE das 6 h é re-tentado uma vez: não
 *   manda aviso duplicado em 5 min. Queda entre reivindicar e enviar segura
 *   só os 5 min da reivindicação.
 * - Banner para gestor/admin enquanto houver incidente aberto, sem expirar
 *   por tempo (sem sucesso não sabemos se o saldo voltou). Some quando uma
 *   chamada à LLM volta a dar certo (`marcarCreditoOk`), que fecha o
 *   incidente mas NÃO mexe no cooldown: o limite de 1 aviso a cada 6 h vale
 *   mesmo com falhas e sucessos alternados.
 * - Agnóstico de provedor: reage ao código `SEM_CREDITO` do `ErroLlm`.
 * - Nunca lança e nunca loga texto de mensagem do WhatsApp (só a ref).
 */
import type { PrismaClient } from "@prisma/client";
import { notificacoesAtivas } from "@/lib/config/env";
import { db as dbPadrao } from "@/lib/db";
import { registrarErro } from "@/lib/erros/registrar";
import { enviarWhatsApp, ErroPosEnvio } from "@/lib/whatsapp/enviar";
import { mascararJid } from "@/lib/whatsapp/mascarar";
import { ErroLlm } from "./tipos";

const CHAVE = "LLM_SEM_CREDITO";
export const COOLDOWN_AVISO_MS = 6 * 60 * 60 * 1000;
export const RETRY_AVISO_MS = 5 * 60 * 1000;

type Db = Pick<PrismaClient, "$queryRaw" | "$executeRaw">;
type Deps = { db?: Db; enviar?: (envio: { para: string; texto: string }) => Promise<{ enviada: boolean }> };

export type ResultadoAlerta = "IGNORADO" | "SO_LOG" | "EM_COOLDOWN" | "ENVIADO" | "FALHOU_ENVIO" | "ERRO";

export function textoAlertaSemCredito(ref: string): string {
  return `⚠️ Sem crédito na API de LLM. Mensagens do grupo estão ficando em FALHA e serão reprocessadas depois da recarga. ref: ${ref}`;
}

/** JID de operações. Vazio/ausente ⇒ alerta desligado (o banner continua). */
function opsJid(): string | undefined {
  return process.env.ALERTA_OPS_JID?.trim() || undefined;
}

function ehSemCredito(e: unknown): boolean {
  return e instanceof ErroLlm && e.codigo === "SEM_CREDITO";
}

/**
 * Chamar no caminho de FALHA do pipeline com o erro e a ref já registrada.
 * Não faz nada se o erro não for `SEM_CREDITO`. Nunca lança.
 */
export async function alertarSeSemCredito(e: unknown, ref: string, deps: Deps = {}): Promise<ResultadoAlerta> {
  if (!ehSemCredito(e)) return "IGNORADO";
  const db = deps.db ?? dbPadrao;
  const enviar = deps.enviar ?? enviarWhatsApp;
  try {
    // Marca a ocorrência (liga o banner). `ativo_desde` guarda a 1ª do
    // incidente aberto; `marcarCreditoOk` o fecha (NULL), e a próxima falta
    // de crédito abre um novo com `ativo_desde` novo.
    await db.$executeRaw`
      INSERT INTO alerta_operacional (chave, ativo_desde, ultima_ocorrencia_em)
      VALUES (${CHAVE}, now(), now())
      ON CONFLICT (chave) DO UPDATE
        SET ativo_desde = COALESCE(alerta_operacional.ativo_desde, now()),
            ultima_ocorrencia_em = now()`;

    const para = opsJid();
    if (!para || !notificacoesAtivas()) {
      const motivo = !para ? "ALERTA_OPS_JID vazio" : "safe mode";
      console.warn(`[alerta-credito] LLM sem crédito ref=${ref}: aviso não enviado (${motivo})`);
      return "SO_LOG";
    }

    // Reivindica o envio: só um request por janela segue. Segura já 5 min
    // (o envio pode levar até 60 s); o resultado decide o intervalo final.
    const reivindicado = await db.$queryRaw<unknown[]>`
      UPDATE alerta_operacional
         SET proximo_aviso_em = now() + make_interval(secs => ${RETRY_AVISO_MS / 1000})
       WHERE chave = ${CHAVE} AND (proximo_aviso_em IS NULL OR proximo_aviso_em <= now())
   RETURNING chave`;
    if (reivindicado.length === 0) return "EM_COOLDOWN";

    try {
      const r = await enviar({ para, texto: textoAlertaSemCredito(ref) });
      if (!r.enviada) throw new Error("envio não confirmado");
    } catch (erroEnvio) {
      if (erroEnvio instanceof ErroPosEnvio) {
        // A Evolution entregou; só a gravação local falhou. Conta como avisado.
        console.warn(`[alerta-credito] aviso entregue mas não registrado ref=${ref} (${erroEnvio.name}: ${erroEnvio.message})`);
      } else {
        // Nome da classe + mensagem só do ErroEnvioWhatsApp (que não carrega texto); resto só o nome.
        const desc =
          erroEnvio instanceof Error && erroEnvio.name === "ErroEnvioWhatsApp"
            ? `${erroEnvio.name}: ${erroEnvio.message}`
            : erroEnvio instanceof Error
              ? erroEnvio.name
              : typeof erroEnvio;
        console.error(`[alerta-credito] aviso para ${mascararJid(para)} não entregue ref=${ref} (${desc}); nova tentativa em 5 min`);
        return "FALHOU_ENVIO";
      }
    }
    // Entregue: janela de 6 h. Uma re-tentativa; se falhar de novo, fica a
    // reivindicação de 5 min (pior caso: um aviso repetido, nunca perdido).
    if (!(await gravarCooldown(db)) && !(await gravarCooldown(db))) {
      console.error(`[alerta-credito] aviso entregue mas cooldown de 6 h não gravado ref=${ref}; pode repetir em 5 min`);
      return "ENVIADO";
    }
    console.warn(`[alerta-credito] LLM sem crédito ref=${ref}: aviso enviado para ${mascararJid(para)}; próximo em 6 h`);
    return "ENVIADO";
  } catch (erro) {
    registrarErro("alerta-credito", erro);
    return "ERRO";
  }
}

async function gravarCooldown(db: Db): Promise<boolean> {
  try {
    await db.$executeRaw`
      UPDATE alerta_operacional
         SET proximo_aviso_em = now() + make_interval(secs => ${COOLDOWN_AVISO_MS / 1000}), avisado_em = now()
       WHERE chave = ${CHAVE}`;
    return true;
  } catch (erro) {
    registrarErro("alerta-credito", erro);
    return false;
  }
}

/**
 * Chamar depois de uma chamada à LLM que deu certo: fecha o incidente (some o
 * banner). Mantém `proximo_aviso_em`: o cooldown de 6 h é limite real de
 * avisos. Barato no caso comum (UPDATE que não casa linha). Nunca lança.
 */
export async function marcarCreditoOk(deps: Pick<Deps, "db"> = {}): Promise<void> {
  const db = deps.db ?? dbPadrao;
  try {
    await db.$executeRaw`
      UPDATE alerta_operacional SET ativo_desde = NULL
       WHERE chave = ${CHAVE} AND ativo_desde IS NOT NULL`;
  } catch (erro) {
    registrarErro("alerta-credito", erro);
  }
}

/**
 * Para o banner: incidente aberto (`desde` = 1ª ocorrência, `ultimoErro` = a
 * mais recente) ou `null`. Sem expiração por tempo. Nunca lança.
 */
export async function estadoSemCredito(deps: Pick<Deps, "db"> = {}): Promise<{ desde: Date; ultimoErro: Date } | null> {
  const db = deps.db ?? dbPadrao;
  try {
    const linhas = await db.$queryRaw<{ ativo_desde: Date; ultima_ocorrencia_em: Date }[]>`
      SELECT ativo_desde, ultima_ocorrencia_em FROM alerta_operacional
       WHERE chave = ${CHAVE} AND ativo_desde IS NOT NULL`;
    const l = linhas[0];
    return l ? { desde: l.ativo_desde, ultimoErro: l.ultima_ocorrencia_em ?? l.ativo_desde } : null;
  } catch (erro) {
    registrarErro("alerta-credito", erro);
    return null;
  }
}

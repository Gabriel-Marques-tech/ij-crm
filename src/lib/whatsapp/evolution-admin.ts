/**
 * Chamadas da Evolution API v2 usadas pelo Admin (GAB-42), com timeout que
 * cobre request e leitura do corpo. Endpoints (conferidos no código da
 * Evolution v2, `instance.router.ts`/`group.router.ts`):
 * - `GET /group/fetchAllGroups/{instancia}?getParticipants=false` →
 *   `[{ id, subject, size, ... }]`;
 * - `GET /instance/connectionState/{instancia}` →
 *   `{ instance: { instanceName, state: "open" | "connecting" | "close" } }`;
 * - `GET /instance/connect/{instancia}` → `{ pairingCode, code, base64, count }`
 *   (ou o connectionState, se já conectada). Com a instância fechada, este
 *   GET dispara uma nova conexão — é o que o botão "Mostrar QR" quer.
 *
 * O QR vincula o WhatsApp: só ADMIN chama, nunca vai para log nem cache.
 */
import { configEvolution } from "@/lib/config/env";

export const TIMEOUT_ADMIN_MS = 20_000;

export class ErroEvolutionAdmin extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = "ErroEvolutionAdmin";
  }
}

async function chamar(caminho: string, timeoutMs = TIMEOUT_ADMIN_MS): Promise<unknown> {
  const { apiUrl, apiKey, instancia } = configEvolution();
  const url = `${apiUrl}/${caminho.replace("{i}", encodeURIComponent(instancia))}`;
  const nome = caminho.split("/").slice(0, 2).join("/");
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { apikey: apiKey }, signal: controlador.signal, cache: "no-store" });
    if (!r.ok) throw new ErroEvolutionAdmin(`Evolution ${nome} respondeu HTTP ${r.status}`);
    return await r.json().catch(() => null);
  } catch (e) {
    if (e instanceof ErroEvolutionAdmin) throw e;
    throw new ErroEvolutionAdmin(`Evolution ${nome}: ${controlador.signal.aborted ? `timeout após ${timeoutMs / 1000}s` : "falha de rede"}`);
  } finally {
    clearTimeout(timer);
  }
}

export type GrupoEvolution = { jid: string; nome: string; membros: number | null };

export async function listarGrupos(): Promise<GrupoEvolution[]> {
  const bruto = await chamar("group/fetchAllGroups/{i}?getParticipants=false");
  if (!Array.isArray(bruto)) throw new ErroEvolutionAdmin("Evolution fetchAllGroups: resposta sem lista");
  return bruto
    .filter((g): g is { id: string; subject?: unknown; size?: unknown } => typeof g?.id === "string" && g.id.endsWith("@g.us"))
    .map((g) => ({ jid: g.id, nome: typeof g.subject === "string" && g.subject ? g.subject : "(sem nome)", membros: typeof g.size === "number" ? g.size : null }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export type EstadoConexao = "CONECTADO" | "AGUARDANDO_QR" | "DESCONECTADO" | "DESCONHECIDO";

/** `timeoutMs` menor na renderização da página: Evolution fora não pode travar o Admin. */
export async function estadoConexao(timeoutMs = TIMEOUT_ADMIN_MS): Promise<EstadoConexao> {
  const j = (await chamar("instance/connectionState/{i}", timeoutMs)) as { instance?: { state?: unknown } } | null;
  const s = j?.instance?.state;
  return s === "open" ? "CONECTADO" : s === "connecting" ? "AGUARDANDO_QR" : s === "close" ? "DESCONECTADO" : "DESCONHECIDO";
}

/** QR (data URL base64) para vincular; `null` se a instância já está conectada. */
export async function obterQr(): Promise<{ base64: string } | null> {
  const j = (await chamar("instance/connect/{i}")) as { base64?: unknown; instance?: { state?: unknown } } | null;
  if (typeof j?.base64 === "string" && j.base64) return { base64: j.base64 };
  if (j?.instance?.state === "open") return null;
  throw new ErroEvolutionAdmin("Evolution connect: QR ainda não disponível, tente de novo em alguns segundos");
}

/** Foto de perfil do PRÓPRIO usuário (GAB-43). Bytes validados em `imagem.ts` antes de gravar. */
import { db } from "@/lib/db";
import { FOTO_MAX_BYTES, FOTO_MIMES, validarFoto, type ErroFoto } from "./imagem";

export async function salvarFoto(
  usuarioId: string,
  bytes: Uint8Array,
  agora: Date = new Date(),
): Promise<{ ok: true; atualizadoEm: Date } | { ok: false; erro: ErroFoto }> {
  const v = validarFoto(bytes);
  if (!v.ok) return v;
  const dados = { bytes: Buffer.from(bytes), mime: v.mime, atualizadoEm: agora };
  await db.usuarioFoto.upsert({ where: { usuarioId }, create: { usuarioId, ...dados }, update: dados });
  return { ok: true, atualizadoEm: agora };
}

export async function removerFoto(usuarioId: string): Promise<void> {
  await db.usuarioFoto.deleteMany({ where: { usuarioId } });
}

/** Foto para servir. Revalida mime e tamanho na saída (defesa contra linha mexida à mão). */
export async function obterFoto(usuarioId: string): Promise<{ bytes: Uint8Array; mime: string; atualizadoEm: Date } | null> {
  const f = await db.usuarioFoto.findUnique({ where: { usuarioId } });
  if (!f || !(FOTO_MIMES as readonly string[]).includes(f.mime) || f.bytes.length > FOTO_MAX_BYTES) return null;
  return { bytes: new Uint8Array(f.bytes), mime: f.mime, atualizadoEm: f.atualizadoEm };
}

/** ETag forte a partir da versão (atualizado_em) — a mesma que vai na URL do avatar. */
export function etagFoto(atualizadoEm: Date): string {
  return `"f${atualizadoEm.getTime().toString(36)}"`;
}

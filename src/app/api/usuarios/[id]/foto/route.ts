/**
 * GET /api/usuarios/[id]/foto — foto de perfil (GAB-43). Exige sessão (qualquer
 * usuário logado vê a foto do time). 404 = sem foto → o cliente mostra as iniciais.
 *
 * `Content-Type` só do mime validado (webp/jpeg) + `nosniff` + CSP vazia: nunca
 * vira HTML/script mesmo que alguém consiga gravar bytes estranhos. A URL leva
 * `?v=<atualizado_em>` (cache-bust), então o cache privado pode ser longo; o
 * ETag cobre o resto (`If-None-Match` → 304).
 */
import { usuarioAtual } from "@/lib/auth/atual";
import { registrarErro } from "@/lib/erros/registrar";
import { etagFoto, obterFoto } from "@/lib/perfil/foto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEGURANCA = {
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; sandbox",
  "cross-origin-resource-policy": "same-origin",
};

function casaEtag(cabecalho: string | null, etag: string): boolean {
  if (!cabecalho) return false;
  if (cabecalho.trim() === "*") return true;
  return cabecalho.split(",").some((t) => t.trim().replace(/^W\//, "") === etag);
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const eu = await usuarioAtual();
    if (!eu) return new Response(null, { status: 401, headers: { ...SEGURANCA, "cache-control": "no-store" } });
    const { id } = await params;
    const foto = id.length <= 64 ? await obterFoto(id) : null;
    if (!foto) return new Response(null, { status: 404, headers: { ...SEGURANCA, "cache-control": "private, no-cache" } });

    const etag = etagFoto(foto.atualizadoEm);
    const cabecalhos = {
      ...SEGURANCA,
      etag,
      "cache-control": "private, max-age=86400",
      "last-modified": foto.atualizadoEm.toUTCString(),
    };
    if (casaEtag(req.headers.get("if-none-match"), etag)) return new Response(null, { status: 304, headers: cabecalhos });
    return new Response(Buffer.from(foto.bytes), {
      status: 200,
      headers: { ...cabecalhos, "content-type": foto.mime, "content-length": String(foto.bytes.length), "content-disposition": "inline" },
    });
  } catch (e) {
    const ref = registrarErro("api.usuarios.foto", e);
    return new Response(null, { status: 500, headers: { ...SEGURANCA, "cache-control": "no-store", "x-erro-ref": ref } });
  }
}

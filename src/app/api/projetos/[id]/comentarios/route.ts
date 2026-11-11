/**
 * GET /api/projetos/[id]/comentarios — polling dos comentários da proposta
 * (GAB-91). Só quem vê a proposta (GAB-98, `lib/propostas/acesso`). Barato de
 * propósito: com `?v=<versao>` igual à atual responde só `{ versao }` (um
 * aggregate no índice da proposta); mudou → `{ versao, comentarios }`.
 * Escrever é server action (`projetos/[id]/proposta/comentarios-actions.ts`).
 */
import { NextResponse } from "next/server";
import { usuarioAtual } from "@/lib/auth/atual";
import { registrarErro } from "@/lib/erros/registrar";
import { MENSAGEM_SEM_ACESSO_PROPOSTA, podeVerPropostaDoProjeto } from "@/lib/propostas/acesso";
import { listarComentarios, versaoDosComentarios } from "@/lib/propostas/comentarios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEM_CACHE = { "cache-control": "no-store" };

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const eu = await usuarioAtual();
    if (!eu) return NextResponse.json({ erro: "Sessão expirada. Entre de novo." }, { status: 401, headers: SEM_CACHE });
    const { id } = await params;
    if (!id || id.length > 64) return NextResponse.json({ erro: "Proposta não encontrada." }, { status: 404, headers: SEM_CACHE });
    if (!(await podeVerPropostaDoProjeto(eu, id))) return NextResponse.json({ erro: MENSAGEM_SEM_ACESSO_PROPOSTA }, { status: 403, headers: SEM_CACHE });
    const v = new URL(req.url).searchParams.get("v");
    if (v) {
      const versao = await versaoDosComentarios(id, eu);
      if (versao === v) return NextResponse.json({ versao }, { headers: SEM_CACHE });
    }
    const l = await listarComentarios(id, eu);
    if (!l) return NextResponse.json({ erro: "Proposta não encontrada." }, { status: 404, headers: SEM_CACHE });
    return NextResponse.json({ versao: l.versao, comentarios: l.threads }, { headers: SEM_CACHE });
  } catch (e) {
    const ref = registrarErro("api.comentarios", e);
    return NextResponse.json({ erro: "Erro no servidor.", ref }, { status: 500, headers: SEM_CACHE });
  }
}

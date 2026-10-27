/** Leitura/gravação de `usuario.preferencias`. Sempre do PRÓPRIO usuário (a action passa o id da sessão). */
import { cache } from "react";
import { db } from "@/lib/db";
import { listarPipelines } from "@/lib/fases/fases";
import { comInicio, comVisualizacaoKanban, inicioSchema, lerPreferencias, visualizacaoKanbanSchema, type Preferencias } from "./preferencias";

export type ErroPreferencias = "DADOS_INVALIDOS" | "QUADRO_INEXISTENTE";

/** Uma leitura por request (React cache): o layout e a página costumam pedir as duas. */
export const obterPreferencias = cache(async (usuarioId: string): Promise<Preferencias> => {
  const u = await db.usuario.findUnique({ where: { id: usuarioId }, select: { preferencias: true } });
  return lerPreferencias(u?.preferencias ?? null);
});

/**
 * Grava a visualização de um quadro. Só aceita quadro existente e guarda só
 * chaves de fase ativas desse quadro. Lê-mescla-grava com lock na linha do
 * usuário, para duas abas salvando quadros diferentes não se sobrescreverem.
 */
export async function salvarVisualizacaoKanban(
  usuarioId: string,
  pipelineChave: string,
  entrada: unknown,
): Promise<{ ok: true } | { ok: false; erro: ErroPreferencias }> {
  const v = visualizacaoKanbanSchema.safeParse(entrada);
  if (!v.success) return { ok: false, erro: "DADOS_INVALIDOS" };
  const pipeline = (await listarPipelines()).find((p) => p.chave === pipelineChave);
  if (!pipeline) return { ok: false, erro: "QUADRO_INEXISTENTE" };
  const chaves = new Set(pipeline.fases.map((f) => f.chave));
  const visualizacao = { mostrarVazias: v.data.mostrarVazias, abertas: [...new Set(v.data.abertas)].filter((k) => chaves.has(k)) };

  await mesclar(usuarioId, (p) => comVisualizacaoKanban(p, pipelineChave, visualizacao));
  return { ok: true };
}

/** Grava a página inicial (`/` → Minha Semana | Kanban Vendas | Kanban Projetos). */
export async function salvarPaginaInicial(usuarioId: string, entrada: unknown): Promise<{ ok: true } | { ok: false; erro: ErroPreferencias }> {
  const v = inicioSchema.safeParse(entrada);
  if (!v.success) return { ok: false, erro: "DADOS_INVALIDOS" };
  await mesclar(usuarioId, (p) => comInicio(p, v.data));
  return { ok: true };
}

/** Lê-mescla-grava com lock na linha do usuário (duas abas não se sobrescrevem). */
async function mesclar(usuarioId: string, mudar: (p: Preferencias) => Preferencias): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM usuario WHERE id = ${usuarioId} FOR UPDATE`;
    const u = await tx.usuario.findUnique({ where: { id: usuarioId }, select: { preferencias: true } });
    if (!u) return;
    await tx.usuario.update({ where: { id: usuarioId }, data: { preferencias: mudar(lerPreferencias(u.preferencias)) } });
  });
}

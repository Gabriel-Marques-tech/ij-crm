"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirPapel } from "@/lib/auth/atual";
import { comTratamento } from "@/lib/erros/registrar";
import type { Relatorio } from "@/lib/importacao/pipefy/aplicar";
import { confirmarPrevia, remapearPrevia, type Previa } from "@/lib/importacao/pipefy/servico";

// O upload (CSV grande) vai pela rota `/api/gestao/importar/previa`: não sobe o limite global das actions.
export type RespostaPrevia = { ok: true; token: string; expiraEm: string; previa: Previa } | { ok: false; erro: string; ref?: string };
export type RespostaImport = { ok: true; relatorio: Relatorio } | { ok: false; erro: string; ref?: string };

const tokenSchema = z.string().regex(/^[0-9a-f]{64}$/);
const mapaSchema = z.record(z.string().max(300), z.string().max(100).nullable());
const opcoesSchema = z.object({ motivoPerdaPadrao: z.string().max(40).nullable().optional() }).strict();

export async function remapearImportAction(token: string, mapeamento: unknown, opcoes?: unknown): Promise<RespostaPrevia> {
  return comTratamento("gestao.importar.remapear", async (): Promise<RespostaPrevia> => {
    const u = await exigirPapel("GESTOR");
    const t = tokenSchema.safeParse(token);
    const m = mapaSchema.safeParse(mapeamento);
    const o = opcoesSchema.safeParse(opcoes ?? {});
    if (!t.success || !m.success || !o.success) return { ok: false, erro: "Dados inválidos. Recarregue a página." };
    const r = await remapearPrevia(t.data, m.data, u, new Date(), o.data);
    if (!r.ok) return r;
    return { ok: true, token: r.token, expiraEm: r.expiraEm.toISOString(), previa: r.previa };
  });
}

/**
 * Confirma a prévia. O relatório volta mesmo quando o import é interrompido
 * no meio (`relatorio.interrompido` com a ref): o que já foi gravado aparece.
 * Revalida o Kanban em `finally` — lotes gravados antes de uma falha também contam.
 */
export async function confirmarImportAction(token: string, hash: string): Promise<RespostaImport> {
  return comTratamento("gestao.importar.confirmar", async (): Promise<RespostaImport> => {
    const u = await exigirPapel("GESTOR");
    const t = tokenSchema.safeParse(token);
    const h = tokenSchema.safeParse(hash);
    if (!t.success || !h.success) return { ok: false, erro: "Dados inválidos. Recarregue a página." };
    try {
      return await confirmarPrevia(t.data, h.data, u);
    } finally {
      revalidatePath("/kanban");
      revalidatePath("/");
    }
  });
}

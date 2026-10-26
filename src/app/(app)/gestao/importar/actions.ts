"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirPapel } from "@/lib/auth/atual";
import { comTratamento } from "@/lib/erros/registrar";
import { decodificarArquivo } from "@/lib/importacao/pipefy/csv";
import type { Relatorio } from "@/lib/importacao/pipefy/aplicar";
import { LIMITE_BYTES, confirmarPrevia, criarPrevia, remapearPrevia, type Previa } from "@/lib/importacao/pipefy/servico";

export type RespostaPrevia = { ok: true; token: string; expiraEm: string; previa: Previa } | { ok: false; erro: string; ref?: string };
export type RespostaImport = { ok: true; relatorio: Relatorio } | { ok: false; erro: string; ref?: string };

const MB = (n: number) => (n / 1024 / 1024).toFixed(1).replace(".", ",");

export async function previsualizarImportAction(form: FormData): Promise<RespostaPrevia> {
  return comTratamento("gestao.importar.previa", async (): Promise<RespostaPrevia> => {
    const u = await exigirPapel("GESTOR");
    const arquivo = form.get("arquivo");
    if (!(arquivo instanceof File) || arquivo.size === 0) return { ok: false, erro: "Escolha o arquivo CSV exportado do Pipefy." };
    if (/\.xlsx?$/i.test(arquivo.name)) {
      return { ok: false, erro: "Arquivo do Excel (.xlsx). Abra no Excel/Planilhas e salve como CSV (UTF-8), depois envie o .csv." };
    }
    if (!/\.(csv|txt)$/i.test(arquivo.name)) return { ok: false, erro: "Envie o export em CSV (.csv)." };
    if (arquivo.size > LIMITE_BYTES) {
      return { ok: false, erro: `Arquivo com ${MB(arquivo.size)} MB; o limite é ${MB(LIMITE_BYTES)} MB. Divida o export (por fase ou período).` };
    }
    const conteudo = decodificarArquivo(new Uint8Array(await arquivo.arrayBuffer()));
    const r = await criarPrevia({ conteudo, nomeArquivo: arquivo.name }, u);
    if (!r.ok) return r;
    return { ok: true, token: r.token, expiraEm: r.expiraEm.toISOString(), previa: r.previa };
  });
}

const tokenSchema = z.string().regex(/^[0-9a-f]{64}$/);
const mapaSchema = z.record(z.string().max(300), z.string().max(100).nullable());

export async function remapearImportAction(token: string, mapeamento: unknown): Promise<RespostaPrevia> {
  return comTratamento("gestao.importar.remapear", async (): Promise<RespostaPrevia> => {
    const u = await exigirPapel("GESTOR");
    const t = tokenSchema.safeParse(token);
    const m = mapaSchema.safeParse(mapeamento);
    if (!t.success || !m.success) return { ok: false, erro: "Dados inválidos. Recarregue a página." };
    const r = await remapearPrevia(t.data, m.data, u);
    if (!r.ok) return r;
    return { ok: true, token: r.token, expiraEm: r.expiraEm.toISOString(), previa: r.previa };
  });
}

export async function confirmarImportAction(token: string, hash: string): Promise<RespostaImport> {
  return comTratamento("gestao.importar.confirmar", async (): Promise<RespostaImport> => {
    const u = await exigirPapel("GESTOR");
    const t = tokenSchema.safeParse(token);
    const h = tokenSchema.safeParse(hash);
    if (!t.success || !h.success) return { ok: false, erro: "Dados inválidos. Recarregue a página." };
    const r = await confirmarPrevia(t.data, h.data, u);
    if (r.ok) {
      revalidatePath("/kanban");
      revalidatePath("/");
    }
    return r;
  });
}

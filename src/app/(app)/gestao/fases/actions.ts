"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirPapel } from "@/lib/auth/atual";
import { criarFase, desarquivarFase, editarFase, moverFase, removerFase, type ErroFase } from "@/lib/fases/fases";
import { comTratamentoForm } from "@/lib/erros/registrar";

const MENSAGEM: Record<ErroFase, string> = {
  PIPELINE_NAO_ENCONTRADO: "Quadro não encontrado.",
  FASE_NAO_ENCONTRADA: "Fase não encontrada. Recarregue a página.",
  FASE_ARQUIVADA: "Essa fase está arquivada. Restaure antes de editar.",
  NOME_INVALIDO: "Nome precisa ter entre 2 e 60 caracteres.",
  COR_INVALIDA: "Cor inválida.",
  LIMITE_INVALIDO: "Limite de dias precisa ser um inteiro entre 1 e 365 (ou vazio).",
  ORDEM_INVALIDA: "A ordem ficou desatualizada. Recarregue a página.",
  TERMINAL_GANHO_OBRIGATORIO: "O quadro precisa manter ao menos uma fase terminal de ganho.",
  TERMINAL_PERDIDO_OBRIGATORIO: "Vendas precisa manter ao menos uma fase terminal de perdido.",
  DESTINO_OBRIGATORIO: "Escolha para qual fase os cards vão.",
  DESTINO_INVALIDO: "Fase de destino inválida: precisa ser outra fase ativa do mesmo quadro.",
  DESTINO_TERMINAL_INCOMPATIVEL:
    "Mova esses cards pelo Kanban — fases de ganho/perdido exigem os dados do fechamento. Aqui só dá para levar cards para uma fase do mesmo tipo (aberta → aberta, ganho → ganho, perdido → perdido).",
  FASE_EM_USO: "A fase passou a ter cards ou histórico enquanto você removia. Tente de novo.",
};

export type EstadoFase = { erro?: string; ok?: true } | undefined;

const ROTA = "/gestao/fases";

const camposSchema = z.object({
  nome: z.string().trim().min(2, MENSAGEM.NOME_INVALIDO).max(60, MENSAGEM.NOME_INVALIDO),
  cor: z.string().trim().optional(),
  limiteDiasAlerta: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 365), MENSAGEM.LIMITE_INVALIDO),
  tipoTerminal: z.enum(["", "GANHO", "PERDIDO"]).transform((v) => (v === "" ? null : v)),
});

function lerCampos(form: FormData) {
  return camposSchema.safeParse({
    nome: form.get("nome"),
    cor: form.get("cor") ?? undefined,
    limiteDiasAlerta: form.get("limiteDiasAlerta") ?? "",
    tipoTerminal: form.get("tipoTerminal") ?? "",
  });
}

export async function criarFaseAction(_prev: EstadoFase, form: FormData): Promise<EstadoFase> {
  return comTratamentoForm("gestao.fases.criarFase", async (): Promise<EstadoFase> => {
    await exigirPapel("GESTOR");
    const pipelineId = z.string().min(1).safeParse(form.get("pipelineId"));
    if (!pipelineId.success) return { erro: "Dados inválidos." };
    const campos = lerCampos(form);
    if (!campos.success) return { erro: campos.error.issues[0]?.message ?? "Dados inválidos." };
    const r = await criarFase(pipelineId.data, { ...campos.data, cor: campos.data.cor || null });
    if (!r.ok) return { erro: MENSAGEM[r.erro] };
    revalidatePath(ROTA);
    return { ok: true };
  });
}

export async function editarFaseAction(_prev: EstadoFase, form: FormData): Promise<EstadoFase> {
  return comTratamentoForm("gestao.fases.editarFase", async (): Promise<EstadoFase> => {
    await exigirPapel("GESTOR");
    const faseId = z.string().min(1).safeParse(form.get("faseId"));
    if (!faseId.success) return { erro: "Dados inválidos." };
    const campos = lerCampos(form);
    if (!campos.success) return { erro: campos.error.issues[0]?.message ?? "Dados inválidos." };
    const r = await editarFase(faseId.data, { ...campos.data, cor: campos.data.cor || null });
    if (!r.ok) return { erro: MENSAGEM[r.erro] };
    revalidatePath(ROTA);
    return { ok: true };
  });
}

export async function moverFaseAction(faseId: string, direcao: "SUBIR" | "DESCER"): Promise<EstadoFase> {
  return comTratamentoForm("gestao.fases.moverFase", async (): Promise<EstadoFase> => {
    await exigirPapel("GESTOR");
    const r = await moverFase(faseId, direcao);
    if (!r.ok) return { erro: MENSAGEM[r.erro] };
    revalidatePath(ROTA);
    return { ok: true };
  });
}

export type EstadoRemocao = { erro?: string; acao?: "EXCLUIR" | "ARQUIVAR" } | undefined;

export async function removerFaseAction(_prev: EstadoRemocao, form: FormData): Promise<EstadoRemocao> {
  return comTratamentoForm("gestao.fases.removerFase", async (): Promise<EstadoRemocao> => {
    const ator = await exigirPapel("GESTOR");
    const parsed = z
      .object({ faseId: z.string().min(1), destinoFaseId: z.string().trim().optional() })
      .safeParse({ faseId: form.get("faseId"), destinoFaseId: form.get("destinoFaseId") ?? undefined });
    if (!parsed.success) return { erro: "Dados inválidos." };
    const r = await removerFase(parsed.data.faseId, { destinoFaseId: parsed.data.destinoFaseId || null }, ator);
    if (!r.ok) return { erro: MENSAGEM[r.erro] };
    revalidatePath(ROTA);
    return { acao: r.acao };
  });
}

export async function desarquivarFaseAction(faseId: string): Promise<EstadoFase> {
  return comTratamentoForm("gestao.fases.desarquivarFase", async (): Promise<EstadoFase> => {
    await exigirPapel("GESTOR");
    const r = await desarquivarFase(faseId);
    if (!r.ok) return { erro: MENSAGEM[r.erro] };
    revalidatePath(ROTA);
    return { ok: true };
  });
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { comTratamento, type Inesperado } from "@/lib/erros/registrar";
import { exigirUsuario } from "@/lib/auth/atual";
import { salvarExibicaoTarefas } from "@/lib/preferencias/servico";
import { exigirTarefas } from "@/lib/tarefas/acesso";
import { criarTarefa, editarTarefa, excluirTarefa, MENSAGEM_ERRO_TAREFA, moverTarefa, PRIORIDADES, STATUS_TAREFA, TITULO_MAX, DESCRICAO_MAX } from "@/lib/tarefas/tarefas";
import { ETIQUETA_MAX, ETIQUETAS_MAX } from "@/lib/tarefas/modelo";

/**
 * Actions do kanban interno do projeto. Toda uma passa por `exigirTarefas`
 * (quem não é do time de projetos → /403) e pelo serviço, que confere que a
 * tarefa é do projeto informado. Nada aqui grava na Timeline do card.
 */
export type EstadoTarefas = { ok: true; id?: string; numero?: number } | { erro: string } | Inesperado;

const id = z.string().min(1).max(64);
const status = z.enum(STATUS_TAREFA as [string, ...string[]]);
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const prioridade = z.enum(PRIORIDADES.map((p) => p.k) as [string, ...string[]]);
const etiquetas = z.array(z.string().max(ETIQUETA_MAX * 2)).max(ETIQUETAS_MAX * 2);
const INVALIDO: EstadoTarefas = { erro: MENSAGEM_ERRO_TAREFA.DADOS_INVALIDOS };

const novaSchema = z.object({
  titulo: z.string().max(TITULO_MAX),
  status: status.optional(),
  prioridade: prioridade.optional(),
  responsavelId: id.nullable().optional(),
  prazo: dia.optional(),
  etiquetas: etiquetas.optional(),
  paiId: id.nullable().optional(),
});
const patchSchema = z
  .object({
    titulo: z.string().max(TITULO_MAX),
    descricao: z.string().max(DESCRICAO_MAX).nullable(),
    status,
    prioridade,
    responsavelId: id.nullable(),
    prazo: dia,
    etiquetas,
  })
  .partial()
  .strict();
const destinoSchema = z.object({ status, posicao: z.number().finite(), responsavelId: id.nullable().optional() }).strict();

function revalidar(projetoId: string) {
  revalidatePath(`/projetos/${projetoId}/tarefas`);
}

export async function criarTarefaAction(projetoId: string, dados: z.input<typeof novaSchema>): Promise<EstadoTarefas> {
  return comTratamento("tarefas.criar", async (): Promise<EstadoTarefas> => {
    const ator = await exigirTarefas();
    const p = novaSchema.safeParse(dados);
    if (!id.safeParse(projetoId).success || !p.success) return INVALIDO;
    const r = await criarTarefa(projetoId, { ...p.data, status: p.data.status as never, prioridade: p.data.prioridade as never }, ator);
    if (!r.ok) return { erro: MENSAGEM_ERRO_TAREFA[r.erro] };
    revalidar(projetoId);
    return { ok: true, id: r.id, numero: r.numero };
  });
}

export async function editarTarefaAction(projetoId: string, tarefaId: string, patch: z.input<typeof patchSchema>): Promise<EstadoTarefas> {
  return comTratamento("tarefas.editar", async (): Promise<EstadoTarefas> => {
    const ator = await exigirTarefas();
    const p = patchSchema.safeParse(patch);
    if (!id.safeParse(projetoId).success || !id.safeParse(tarefaId).success || !p.success) return INVALIDO;
    const r = await editarTarefa(projetoId, tarefaId, { ...p.data, status: p.data.status as never, prioridade: p.data.prioridade as never }, ator);
    if (!r.ok) return { erro: MENSAGEM_ERRO_TAREFA[r.erro] };
    revalidar(projetoId);
    return { ok: true };
  });
}

export async function moverTarefaAction(projetoId: string, tarefaId: string, para: z.input<typeof destinoSchema>): Promise<EstadoTarefas> {
  return comTratamento("tarefas.mover", async (): Promise<EstadoTarefas> => {
    const ator = await exigirTarefas();
    const p = destinoSchema.safeParse(para);
    if (!id.safeParse(projetoId).success || !id.safeParse(tarefaId).success || !p.success) return INVALIDO;
    const r = await moverTarefa(projetoId, tarefaId, { ...p.data, status: p.data.status as never }, ator);
    if (!r.ok) return { erro: MENSAGEM_ERRO_TAREFA[r.erro] };
    revalidar(projetoId);
    return { ok: true };
  });
}

export async function excluirTarefaAction(projetoId: string, tarefaId: string): Promise<EstadoTarefas> {
  return comTratamento("tarefas.excluir", async (): Promise<EstadoTarefas> => {
    const ator = await exigirTarefas();
    if (!id.safeParse(projetoId).success || !id.safeParse(tarefaId).success) return INVALIDO;
    const r = await excluirTarefa(projetoId, tarefaId, ator);
    if (!r.ok) return { erro: MENSAGEM_ERRO_TAREFA[r.erro] };
    revalidar(projetoId);
    return { ok: true };
  });
}

/**
 * Exibição (quadro/lista, agrupar, ordenar…) do usuário DA SESSÃO, igual em todos
 * os projetos. Não recebe id de usuário; sem revalidate (a UI já aplicou).
 */
export async function salvarExibicaoTarefasAction(exibicao: unknown): Promise<EstadoTarefas> {
  return comTratamento("tarefas.salvarExibicao", async (): Promise<EstadoTarefas> => {
    const ator = await exigirUsuario();
    const r = await salvarExibicaoTarefas(ator.id, exibicao);
    if (!r.ok) return INVALIDO;
    return { ok: true };
  });
}

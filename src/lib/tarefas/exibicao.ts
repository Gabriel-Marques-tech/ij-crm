/**
 * Exibição do quadro/lista de tarefas (o "Display" do Linear), por pessoa, em
 * `usuario.preferencias.tarefas`: layout, agrupamento, ordem, concluídas,
 * subtarefas, densidade, colunas recolhidas e propriedades do cartão. Puro.
 */
import { z } from "zod";
import type { PrioridadeTarefa } from "@prisma/client";
import { PRIORIDADES, fechada, type TarefaLista } from "./modelo";

export const exibicaoSchema = z.object({
  vista: z.enum(["quadro", "lista"]),
  agrupar: z.enum(["resp", "status", "prio", "etiqueta", "nenhum"]),
  ordenar: z.enum(["posicao", "prazo", "prioridade", "responsavel", "criado", "titulo", "status"]),
  ordemDesc: z.boolean(),
  concluidas: z.enum(["todas", "semana", "mes", "nenhuma"]),
  subtarefas: z.enum(["todas", "lista", "nenhuma"]),
  dens: z.enum(["compacta", "padrao", "confortavel"]),
  recolhidos: z.boolean(),
  vazios: z.boolean(),
  props: z.object({ id: z.boolean(), status: z.boolean(), prio: z.boolean(), resp: z.boolean(), etiquetas: z.boolean(), prazo: z.boolean(), sub: z.boolean(), criada: z.boolean(), pai: z.boolean() }),
});

export type Exibicao = z.infer<typeof exibicaoSchema>;
export type Agrupar = Exibicao["agrupar"];
export type Ordenar = Exibicao["ordenar"];
export type Propriedade = keyof Exibicao["props"];

export const EXIBICAO_PADRAO: Exibicao = {
  vista: "quadro",
  agrupar: "status",
  ordenar: "posicao",
  ordemDesc: false,
  concluidas: "todas",
  subtarefas: "todas",
  dens: "padrao",
  recolhidos: false,
  vazios: false,
  props: { id: true, status: true, prio: true, resp: true, etiquetas: true, prazo: true, sub: true, criada: true, pai: true },
};

export const ROTULO_AGRUPAR: Record<Agrupar, string> = { resp: "Responsável", status: "Status", prio: "Prioridade", etiqueta: "Etiqueta", nenhum: "Nenhum" };
export const ROTULO_ORDENAR: Record<Ordenar, string> = { posicao: "Manual", prazo: "Prazo", prioridade: "Prioridade", responsavel: "Responsável", criado: "Criação", titulo: "Título", status: "Status" };
export const ROTULO_PROPRIEDADE: Record<Propriedade, string> = { id: "ID", status: "Status", prio: "Prioridade", resp: "Responsável", etiquetas: "Etiquetas", prazo: "Prazo", sub: "Subtarefas", criada: "Criada em", pai: "Tarefa pai" };

/** Lê o JSON guardado; qualquer coisa fora do schema vira o padrão (campo a campo não: é um bloco só). */
export function lerExibicao(bruto: unknown): Exibicao {
  const r = exibicaoSchema.safeParse(bruto);
  return r.success ? r.data : EXIBICAO_PADRAO;
}

const NIVEL_PRIO: Record<PrioridadeTarefa, number> = Object.fromEntries(PRIORIDADES.map((p, i) => [p.k, i])) as Record<PrioridadeTarefa, number>;
const NIVEL_STATUS = { BACKLOG: 0, A_FAZER: 1, EM_ANDAMENTO: 2, EM_REVISAO: 3, FEITA: 4, CANCELADA: 5 } as const;

/** Comparador da exibição; empate cai na posição manual. `nomeDe` resolve o responsável (sem responsável vai por último). */
export function ordenador(e: Pick<Exibicao, "ordenar" | "ordemDesc">, nomeDe: (id: string) => string = (id) => id): (a: TarefaLista, b: TarefaLista) => number {
  const s = e.ordemDesc ? -1 : 1;
  const resp = (t: TarefaLista) => (t.responsavelId ? nomeDe(t.responsavelId) : "\uffff");
  const base: Record<Ordenar, (a: TarefaLista, b: TarefaLista) => number> = {
    posicao: (a, b) => a.posicao - b.posicao,
    responsavel: (a, b) => resp(a).localeCompare(resp(b), "pt-BR"),
    prazo: (a, b) => (a.prazo ?? "9999").localeCompare(b.prazo ?? "9999"),
    prioridade: (a, b) => NIVEL_PRIO[a.prioridade] - NIVEL_PRIO[b.prioridade],
    criado: (a, b) => b.criadoEmMs - a.criadoEmMs,
    titulo: (a, b) => a.titulo.localeCompare(b.titulo, "pt-BR"),
    status: (a, b) => NIVEL_STATUS[a.status] - NIVEL_STATUS[b.status],
  };
  const cmp = base[e.ordenar];
  return (a, b) => s * cmp(a, b) || a.posicao - b.posicao;
}

/** Concluídas por período e subtarefas conforme a exibição (os filtros do usuário vêm depois, em `filtros.ts`). */
export function aplicarExibicao(tarefas: readonly TarefaLista[], e: Pick<Exibicao, "concluidas" | "subtarefas" | "vista">, agoraMs: number): TarefaLista[] {
  const limite = { semana: 7, mes: 30 }[e.concluidas as "semana" | "mes"];
  const corte = limite ? agoraMs - limite * 864e5 : null;
  return tarefas.filter(
    (t) =>
      (e.subtarefas === "todas" || !t.paiId || (e.subtarefas === "lista" && e.vista === "lista")) &&
      (!fechada(t.status) || e.concluidas === "todas" || (corte !== null && (t.concluidaEmMs ?? 0) >= corte)),
  );
}

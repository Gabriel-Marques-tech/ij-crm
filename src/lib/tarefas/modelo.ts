/** Tipos e constantes puras do kanban interno: sem banco, importáveis pelo cliente. */
import type { PrioridadeTarefa, StatusTarefa } from "@prisma/client";

export const STATUS_TAREFA: readonly StatusTarefa[] = ["BACKLOG", "A_FAZER", "EM_ANDAMENTO", "EM_REVISAO", "FEITA", "CANCELADA"];
/** Da mais alta para a mais baixa (ordem de triagem); "sem prioridade" por último. */
export const PRIORIDADES: readonly { k: PrioridadeTarefa; nome: string }[] = [
  { k: "URGENTE", nome: "Urgente" },
  { k: "ALTA", nome: "Alta" },
  { k: "MEDIA", nome: "Média" },
  { k: "BAIXA", nome: "Baixa" },
  { k: "SEM_PRIORIDADE", nome: "Sem prioridade" },
];
export const ROTULO_PRIORIDADE: Record<PrioridadeTarefa, string> = Object.fromEntries(PRIORIDADES.map((p) => [p.k, p.nome])) as Record<PrioridadeTarefa, string>;
export const TITULO_MAX = 500;
export const DESCRICAO_MAX = 10_000;
export const ETIQUETA_MAX = 30;
export const ETIQUETAS_MAX = 20;

/** FEITA e CANCELADA: tarefa fechada (preenche `concluidaEm`). */
export function fechada(status: StatusTarefa): boolean {
  return status === "FEITA" || status === "CANCELADA";
}

/** Etiqueta é texto livre: minúscula, sem espaço duplicado, sem repetição. Vazia/longa demais sai. */
export function normalizarEtiquetas(brutas: readonly string[]): string[] {
  const saida: string[] = [];
  for (const b of brutas) {
    const e = b.trim().replace(/\s+/g, " ").toLowerCase();
    if (e && e.length <= ETIQUETA_MAX && !saida.includes(e)) saida.push(e);
  }
  return saida.slice(0, ETIQUETAS_MAX);
}

export type TarefaLista = {
  id: string;
  numero: number;
  titulo: string;
  descricao: string | null;
  status: StatusTarefa;
  prioridade: PrioridadeTarefa;
  posicao: number;
  responsavelId: string | null;
  /** `YYYY-MM-DD` ou null (coluna DATE). */
  prazo: string | null;
  etiquetas: string[];
  paiId: string | null;
  concluidaEmMs: number | null;
  criadoEmMs: number;
};

export type PessoaTarefa = {
  id: string;
  nome: string;
  fotoEm: number | null;
  ativo: boolean;
  /** Afastado segundo G&G (status do membro): aviso ao atribuir. */
  afastado?: boolean;
  /** false = responsável atual que não pode receber tarefa nova (saiu da equipe): aparece só para reatribuir. */
  podeReceber?: boolean;
};

/** Pode ser escolhida como responsável de uma tarefa que ainda não é dela. */
export function recebeTarefa(p: PessoaTarefa): boolean {
  return p.ativo && p.podeReceber !== false;
}

/** Rótulo no menu de responsável: inativo e fora da equipe ficam marcados (e desabilitados para outras tarefas). */
export function rotuloResponsavel(p: PessoaTarefa): string {
  if (!p.ativo) return `${p.nome} (inativo)`;
  if (p.podeReceber === false) return `${p.nome} (fora da equipe)`;
  return p.afastado ? `${p.nome} (afastado)` : p.nome;
}

export type ProjetoTarefas = { id: string; titulo: string; pipelineChave: string };

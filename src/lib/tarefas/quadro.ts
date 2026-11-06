/**
 * Regras puras do quadro de tarefas (rodam no cliente e no servidor): colunas
 * por status, linhas por responsável e a posição ao soltar um card.
 */
import type { PrioridadeTarefa, StatusTarefa } from "@prisma/client";
import type { Agrupar } from "./exibicao";
import { PRIORIDADES, type PessoaTarefa } from "./modelo";

export type Coluna = { status: StatusTarefa; nome: string; /** Backlog e Cancelada começam recolhidas (spec §3). */ recolhida: boolean };

export const COLUNAS: readonly Coluna[] = [
  { status: "BACKLOG", nome: "Backlog", recolhida: true },
  { status: "A_FAZER", nome: "A fazer", recolhida: false },
  { status: "EM_ANDAMENTO", nome: "Em andamento", recolhida: false },
  { status: "EM_REVISAO", nome: "Em revisão", recolhida: false },
  { status: "FEITA", nome: "Feita", recolhida: false },
  { status: "CANCELADA", nome: "Cancelada", recolhida: true },
];

export const ROTULO_STATUS: Record<StatusTarefa, string> = Object.fromEntries(COLUNAS.map((c) => [c.status, c.nome])) as Record<StatusTarefa, string>;

/** Chave da linha "Sem responsável" (sempre a última). */
export const SEM_RESPONSAVEL = "none";

export type Linha<T> = { chave: string; nome: string; pessoa: PessoaTarefa | null; /** Cor do ponto (status/prioridade); null = sem ponto. */ cor: string | null; tarefas: T[] };

export const COR_STATUS: Record<StatusTarefa, string> = { BACKLOG: "#8a8c96", A_FAZER: "#c9cbd1", EM_ANDAMENTO: "#ffc857", EM_REVISAO: "#4cc9f0", FEITA: "#25d097", CANCELADA: "#6b7280" };
export const SEM_ETIQUETA = "none";

/**
 * Uma linha por pessoa que tem tarefa (ordem por nome), e "Sem responsável" no
 * fim quando há tarefa sem dono. Pessoa sem tarefa não ganha linha: o quadro
 * fica do tamanho do trabalho que existe.
 */
export function agruparPorResponsavel<T extends { responsavelId: string | null }>(tarefas: readonly T[], pessoas: readonly PessoaTarefa[]): Linha<T>[] {
  const porPessoa = new Map<string, T[]>();
  const semDono: T[] = [];
  for (const t of tarefas) {
    if (t.responsavelId === null) semDono.push(t);
    else porPessoa.set(t.responsavelId, [...(porPessoa.get(t.responsavelId) ?? []), t]);
  }
  const linhas: Linha<T>[] = [...pessoas]
    .filter((p) => porPessoa.has(p.id))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
    .map((p) => ({ chave: p.id, nome: p.ativo ? p.nome : `${p.nome} (inativo)`, pessoa: p, cor: null, tarefas: porPessoa.get(p.id)! }));
  // Responsável que nem está na lista de pessoas (não deveria acontecer): ainda aparece, sem sumir tarefa.
  for (const [id, ts] of porPessoa) if (!pessoas.some((p) => p.id === id)) linhas.push({ chave: id, nome: "Pessoa removida", pessoa: null, cor: null, tarefas: ts });
  if (semDono.length) linhas.push({ chave: SEM_RESPONSAVEL, nome: "Sem responsável", pessoa: null, cor: null, tarefas: semDono });
  return linhas;
}

type Agrupavel = { responsavelId: string | null; status: StatusTarefa; prioridade: PrioridadeTarefa; etiquetas: string[] };

/**
 * Linhas do quadro (ou grupos da lista) pelo critério da exibição. Status e
 * prioridade listam todos os valores (vazios ficam para a UI recolher);
 * etiqueta agrupa pela PRIMEIRA etiqueta da tarefa (uma tarefa, uma linha).
 */
export function agrupar<T extends Agrupavel>(tarefas: readonly T[], pessoas: readonly PessoaTarefa[], por: Agrupar, nomesStatus: Record<StatusTarefa, string>, nomesPrio: Record<PrioridadeTarefa, string>): Linha<T>[] {
  switch (por) {
    case "resp":
      return agruparPorResponsavel(tarefas, pessoas);
    case "status":
      return (Object.keys(COR_STATUS) as StatusTarefa[]).map((s) => ({ chave: s, nome: nomesStatus[s], pessoa: null, cor: COR_STATUS[s], tarefas: tarefas.filter((t) => t.status === s) }));
    case "prio":
      return PRIORIDADES.map((p) => ({ chave: p.k, nome: nomesPrio[p.k], pessoa: null, cor: null, tarefas: tarefas.filter((t) => t.prioridade === p.k) }));
    case "etiqueta": {
      const nomes = [...new Set(tarefas.flatMap((t) => (t.etiquetas[0] ? [t.etiquetas[0]] : [])))].sort((a, b) => a.localeCompare(b, "pt-BR"));
      const linhas: Linha<T>[] = nomes.map((e) => ({ chave: e, nome: e, pessoa: null, cor: null, tarefas: tarefas.filter((t) => t.etiquetas[0] === e) }));
      const sem = tarefas.filter((t) => t.etiquetas.length === 0);
      if (sem.length) linhas.push({ chave: SEM_ETIQUETA, nome: "Sem etiqueta", pessoa: null, cor: null, tarefas: sem });
      return linhas;
    }
    case "nenhum":
      return [{ chave: "all", nome: "", pessoa: null, cor: null, tarefas: [...tarefas] }];
  }
}

/** Posição ao soltar entre dois vizinhos (float, sem renormalizar: 15 pessoas, poucas centenas de movimentos). */
export function posicaoEntre(antes: number | null, depois: number | null): number {
  if (antes !== null && depois !== null) return (antes + depois) / 2;
  if (antes !== null) return antes + 1;
  if (depois !== null) return depois - 1;
  return 1;
}

/**
 * Posição ao soltar numa coluna (`naColuna` na ordem exibida, sem a tarefa arrastada), antes de
 * `antesDeId` ou no fim. Vizinhos só valem na ordem manual crescente: ordenado por prazo,
 * prioridade… (ou decrescente) a coluna não mostra a posição, então soltar na mesma coluna não
 * muda nada (null) e em outra vai para o fim, sem bagunçar a ordem manual.
 */
export function posicaoAoSoltar(naColuna: readonly { id: string; posicao: number }[], antesDeId: string | null, o: { manual: boolean; mesmaColuna: boolean }): number | null {
  if (!o.manual) {
    if (o.mesmaColuna) return null;
    return posicaoEntre(naColuna.length ? Math.max(...naColuna.map((x) => x.posicao)) : null, null);
  }
  const i = antesDeId ? naColuna.findIndex((x) => x.id === antesDeId) : -1;
  if (i === -1) return posicaoEntre(naColuna.at(-1)?.posicao ?? null, null);
  return posicaoEntre(i > 0 ? naColuna[i - 1].posicao : null, naColuna[i].posicao);
}

/**
 * Minha Semana em colunas (GAB-51), parte pura. Uma leitura cobre da segunda
 * desta semana até hoje+7 (o antigo "Próximos 7 dias"); aqui ela é dividida
 * em 7 colunas (seg–dom) e na lista "Próxima semana" (da segunda seguinte até
 * hoje+7). O destaque do topo ("Mais urgente") também aparece nas colunas,
 * no dia dele (a grade marca o card como urgente), mas não se repete na lista
 * "Próxima semana" (já está grande no topo).
 */
import { agruparPorDia, type DiaAgrupado, type SemanaCalendario } from "@/lib/calendario/semana";
import { somarDias } from "@/lib/projetos/proxima-acao";

/** Último dia lido: hoje+7 (sempre ≥ domingo desta semana). */
export function fimDaJanela(semana: SemanaCalendario): string {
  const f = somarDias(semana.hoje, 7);
  return f > semana.domingo ? f : semana.domingo;
}

export function dividirSemana<A extends { cardId: string; dia: string }, P extends { dia: string }>(
  semana: SemanaCalendario,
  itens: { acoes: readonly A[]; prazos: readonly P[] },
  destaqueId: string | null,
): { dias: DiaAgrupado<A, P>[]; proxima: { acoes: A[]; prazos: P[] } } {
  const depois = (i: { dia: string }) => i.dia > semana.domingo;
  return {
    dias: agruparPorDia(semana.dias, itens.acoes, itens.prazos),
    proxima: { acoes: itens.acoes.filter((a) => depois(a) && a.cardId !== destaqueId), prazos: itens.prazos.filter(depois) },
  };
}

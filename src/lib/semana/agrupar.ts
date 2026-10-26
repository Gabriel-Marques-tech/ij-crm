/**
 * Minha Semana (GAB-33), parte pura: agrupa os cards do vendedor pelas faixas
 * da próxima ação (`faixaProximaAcao`, a mesma do filtro do Kanban) e escolhe
 * o destaque. Dias civis de São Paulo, qualquer que seja o fuso do servidor.
 */
import { diaEmFuso, FUSO_NEGOCIO } from "@/lib/oportunidades/aging";
import { interpretarCampo } from "@/lib/oportunidades/campos";
import { diasAte, faixaProximaAcao } from "@/lib/oportunidades/proxima-acao";

export type ItemAgrupavel = { id: string; proximaAcaoEm: Date | null; faseDesde: Date };

export type FaixaSemana = "vencida" | "hoje" | "semana";

export type Semana<T> = {
  /** A mais urgente: vencida mais antiga → hoje → a mais próxima dos 7 dias. Não se repete na lista. */
  destaque: T | null;
  destaqueFaixa: FaixaSemana | null;
  vencidas: T[];
  hoje: T[];
  semana: T[];
  sem: T[];
  /** Totais por faixa, contando o destaque. */
  totais: Record<FaixaSemana | "sem", number>;
  /** Cards com próxima ação depois dos 7 dias (não listados). */
  depois: number;
};

/** Data mais cedo primeiro; empate → há mais tempo na fase; depois id (estável). */
function comparar(a: ItemAgrupavel, b: ItemAgrupavel): number {
  const da = a.proximaAcaoEm?.getTime() ?? 0;
  const db = b.proximaAcaoEm?.getTime() ?? 0;
  if (da !== db) return da - db;
  const fa = a.faseDesde.getTime();
  const fb = b.faseDesde.getTime();
  if (fa !== fb) return fa - fb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function agruparSemana<T extends ItemAgrupavel>(itens: readonly T[], agora: Date): Semana<T> {
  const grupos = { vencida: [] as T[], hoje: [] as T[], semana: [] as T[], sem: [] as T[] };
  let depois = 0;
  for (const it of itens) {
    const f = faixaProximaAcao(it.proximaAcaoEm, agora);
    if (f === "depois") depois++;
    else grupos[f].push(it);
  }
  for (const g of Object.values(grupos)) g.sort(comparar);
  const totais = { vencida: grupos.vencida.length, hoje: grupos.hoje.length, semana: grupos.semana.length, sem: grupos.sem.length };

  const destaqueFaixa: FaixaSemana | null = grupos.vencida.length ? "vencida" : grupos.hoje.length ? "hoje" : grupos.semana.length ? "semana" : null;
  const destaque = destaqueFaixa ? grupos[destaqueFaixa].shift()! : null;

  return { destaque, destaqueFaixa, vencidas: grupos.vencida, hoje: grupos.hoje, semana: grupos.semana, sem: grupos.sem, totais, depois };
}

const DIA_SEMANA = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "short" });

/** "ontem" / "há N dias" / "hoje" / "amanhã" / "qua" + data `DD/MM` (ano só se for outro). */
export function quandoRotulo(proximaAcaoEm: Date, agora: Date): { curto: string; data: string } {
  const dia = diaEmFuso(proximaAcaoEm, FUSO_NEGOCIO);
  const hoje = diaEmFuso(agora, FUSO_NEGOCIO);
  const n = diasAte(hoje, dia);
  const [a, m, d] = dia.split("-");
  const data = a === hoje.slice(0, 4) ? `${d}/${m}` : `${d}/${m}/${a}`;
  let curto: string;
  if (n === 0) curto = "hoje";
  else if (n === -1) curto = "ontem";
  else if (n < 0) curto = `há ${-n} dias`;
  else if (n === 1) curto = "amanhã";
  else curto = DIA_SEMANA.format(new Date(`${dia}T12:00:00Z`)).replace(".", "");
  return { curto, data };
}

export type EscolhaValida = { ok: true; proximaAcao: string; proximaAcaoEm: Date } | { ok: false; erro: string };

/** Nova próxima ação ao marcar feita: texto e data obrigatórios, data de hoje (SP) em diante. */
export function validarProximaEscolha(textoBruto: string, diaBruto: string, agora: Date): EscolhaValida {
  const texto = interpretarCampo("proximaAcao", textoBruto);
  if (!texto.ok) return texto;
  if (texto.valor === null) return { ok: false, erro: "Descreva a próxima ação." };
  if (diaBruto.trim() === "") return { ok: false, erro: "Escolha a data da próxima ação." };
  const data = interpretarCampo("proximaAcaoEm", diaBruto);
  if (!data.ok) return data;
  const em = data.valor as Date;
  if (diaEmFuso(em) < diaEmFuso(agora)) return { ok: false, erro: "A data da próxima ação não pode estar no passado." };
  return { ok: true, proximaAcao: texto.valor as string, proximaAcaoEm: em };
}

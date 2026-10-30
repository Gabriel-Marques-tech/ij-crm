/**
 * Ranking de vendas (GAB-44) — cálculo PURO, feito na leitura a partir do
 * histórico (nada de pontos gravados: mudar um peso recalcula tudo na hora).
 *
 * Regras de pontuação e atribuição:
 * Só contam movimentos feitos por gente: origem `UI` ou `WHATSAPP`
 * (`ORIGENS_QUE_PONTUAM`). `SISTEMA` (fase arquivada/removida) e `IMPORT` não
 * pontuam nem contam como ganho/perda.
 *
 * - Ganho: card de Vendas que ESTÁ numa fase de ganho, entrou nela (vindo de
 *   fora do ganho) por UI/WhatsApp e tem `data_ganho` no período → para o
 *   RESPONSÁVEL do card. Reaberto não conta (olha o estado
 *   atual); re-ganho conta pela nova `data_ganho`. Pontos = `ganho` +
 *   `bonusPorMil` a cada R$ 1.000 completos de `valor_fechado`, bônus até `tetoBonus`.
 * - Avanço de fase: TransicaoFase em Vendas para fase NÃO terminal de ordem
 *   maior que a de origem, e só se for a PRIMEIRA entrada do card naquela fase
 *   (a criação conta como entrada) → para quem moveu (`usuario_id`).
 * - Próxima ação feita ("Marcar feita") → para quem marcou; no máximo
 *   `acoesPorDia` (padrão 4) por VENDEDOR por dia civil de SP (as primeiras do
 *   dia), em qualquer card — o mesmo card pode contar mais de uma vez.
 * - Card criado em Vendas (UI/WhatsApp) → para quem criou.
 * - Perdido: 0 ponto (entra só em conversão), datado pela entrada no perdido.
 * Usuário desativado sai da lista, das posições e dos destaques, mas o que fez
 * continua na linha "Time" (é história do time): `soNoTime`.
 * Desempate: mais ganhos → maior R$ fechado → quem chegou primeiro à pontuação
 * final (instante do último evento que pontuou) → nome.
 */
import type { OrigemTransicao } from "@prisma/client";
import { diaEmFuso } from "@/lib/projetos/aging";
import type { ConfigRanking, PesosRanking } from "./config";
import { dentroDoPeriodo } from "./periodo";

export type Intervalo = { inicio: Date; fim: Date };

export type Participante = { id: string; nome: string; fotoEm: number | null };

/** `origem`: da transição que levou o card ao ganho/perda (null = sem histórico). */
export type Ganho = {
  projetoId: string;
  titulo: string;
  responsavelId: string;
  dataGanho: Date;
  valorFechado: number | null;
  criadoEm: Date;
  origem: OrigemTransicao | null;
};
export type Perda = { projetoId: string; responsavelId: string; em: Date; origem: OrigemTransicao | null };

/** Movimentos feitos por gente. SISTEMA (migração de fase) e IMPORT ficam de fora. */
export const ORIGENS_QUE_PONTUAM: ReadonlySet<OrigemTransicao> = new Set<OrigemTransicao>(["UI", "WHATSAPP"]);
const porGente = (o: OrigemTransicao | null) => o !== null && ORIGENS_QUE_PONTUAM.has(o);
export type Transicao = {
  id: string;
  projetoId: string;
  titulo: string;
  usuarioId: string | null;
  origem: OrigemTransicao;
  em: Date;
  paraFaseId: string;
  paraFaseNome: string;
  paraOrdem: number;
  paraTerminal: boolean;
  /** null = criação (entrada no funil). */
  deOrdem: number | null;
};
export type AcaoFeita = { projetoId: string; usuarioId: string; em: Date };
export type Criacao = { projetoId: string; usuarioId: string; em: Date };
/** Situação de HOJE (não do período): cards abertos em Vendas por responsável. */
export type Abertos = { responsavelId: string; quantidade: number; orcamento: number };

/**
 * Tudo que o cálculo precisa. `transicoes` traz o histórico COMPLETO dos cards
 * que tiveram transição no intervalo (para saber a primeira entrada por fase).
 */
export type DadosRanking = {
  ganhos: Ganho[];
  perdas: Perda[];
  transicoes: Transicao[];
  acoes: AcaoFeita[];
  criacoes: Criacao[];
  abertos: Abertos[];
};

export type DetalhePontos = { ganho: number; avanco: number; acaoFeita: number; cardCriado: number };

export type Metricas = {
  pontos: number;
  ganhos: number;
  perdidos: number;
  /** ganhos ÷ (ganhos + perdidos); null sem fechados. */
  conversao: number | null;
  fechado: number;
  /** R$ fechado ÷ ganhos COM valor informado; null sem nenhum. */
  ticketMedio: number | null;
  /** Média de dias entre a criação do card e o ganho; null sem ganhos. */
  tempoMedioGanhoDias: number | null;
  avancos: number;
  acoesFeitas: number;
  cardsCriados: number;
  abertos: number;
  emAberto: number;
};

export type LinhaRanking = Metricas & {
  usuario: Participante;
  posicao: number;
  detalhe: DetalhePontos;
  /** Quando chegou à pontuação final (último evento que pontuou); null = 0 ponto. */
  alcancouEm: Date | null;
};

export type ChaveDestaque = "liderVendas" | "maisGanhos" | "maiorTicket" | "melhorConversao" | "maisAvancos" | "maisAcoes" | "fechamentoMaisRapido";

export type Destaque = {
  chave: ChaveDestaque;
  titulo: string;
  formato: "dinheiro" | "inteiro" | "percentual" | "dias";
  /** Todos os empatados; vazio = sem dados suficientes. */
  vencedores: { usuario: Participante; card?: { id: string; titulo: string } }[];
  valor: number | null;
  /** Mostrada quando não há vencedor. */
  dica: string;
};

export type Ranking = { linhas: LinhaRanking[]; time: Metricas; destaques: Destaque[] };

const MIL = 1_000;
const DIA_MS = 86_400_000;

export function pontosDoGanho(valorFechado: number | null, pesos: PesosRanking): number {
  const bonus = valorFechado && valorFechado > 0 ? Math.floor(valorFechado / MIL) * pesos.bonusPorMil : 0;
  return pesos.ganho + Math.min(bonus, pesos.tetoBonus);
}

const porInstante = <T extends { em: Date }>(a: T, b: T, ida: string, idb: string) => a.em.getTime() - b.em.getTime() || (ida < idb ? -1 : ida > idb ? 1 : 0);

/** Avanços que pontuam no intervalo (primeira entrada por card × fase, ver topo). */
export function avancosQueContam(transicoes: Transicao[], intervalo: Intervalo): Transicao[] {
  const ordenadas = [...transicoes].sort((a, b) => porInstante(a, b, a.id, b.id));
  const vistas = new Set<string>();
  const contam: Transicao[] = [];
  for (const t of ordenadas) {
    const chave = `${t.projetoId}|${t.paraFaseId}`;
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    if (!dentroDoPeriodo(t.em, intervalo)) continue;
    if (t.deOrdem === null || t.paraTerminal || t.paraOrdem <= t.deOrdem) continue;
    if (!porGente(t.origem) || !t.usuarioId) continue;
    contam.push(t);
  }
  return contam;
}

/** "Marcar feita" que pontuam: as `limitePorDia` primeiras de cada vendedor em cada dia de SP. */
export function acoesQueContam(acoes: AcaoFeita[], intervalo: Intervalo, limitePorDia: number): AcaoFeita[] {
  const ordenadas = acoes.filter((a) => dentroDoPeriodo(a.em, intervalo)).sort((a, b) => a.em.getTime() - b.em.getTime());
  const usadas = new Map<string, number>();
  return ordenadas.filter((a) => {
    const chave = `${a.usuarioId}|${diaEmFuso(a.em)}`;
    const n = usadas.get(chave) ?? 0;
    if (n >= limitePorDia) return false;
    usadas.set(chave, n + 1);
    return true;
  });
}

type Acumulador = Metricas & { detalhe: DetalhePontos; alcancouEm: Date | null; comValor: number; diasGanho: number[] };

function novo(): Acumulador {
  return {
    pontos: 0,
    ganhos: 0,
    perdidos: 0,
    conversao: null,
    fechado: 0,
    ticketMedio: null,
    tempoMedioGanhoDias: null,
    avancos: 0,
    acoesFeitas: 0,
    cardsCriados: 0,
    abertos: 0,
    emAberto: 0,
    detalhe: { ganho: 0, avanco: 0, acaoFeita: 0, cardCriado: 0 },
    alcancouEm: null,
    comValor: 0,
    diasGanho: [],
  };
}

function pontuar(a: Acumulador, categoria: keyof DetalhePontos, pts: number, em: Date) {
  if (pts <= 0) return;
  a.pontos += pts;
  a.detalhe[categoria] += pts;
  if (!a.alcancouEm || em > a.alcancouEm) a.alcancouEm = em;
}

const media = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length);

function fechar(a: Acumulador): Metricas {
  const fechados = a.ganhos + a.perdidos;
  return {
    pontos: a.pontos,
    ganhos: a.ganhos,
    perdidos: a.perdidos,
    conversao: fechados > 0 ? a.ganhos / fechados : null,
    fechado: a.fechado,
    ticketMedio: a.comValor > 0 ? a.fechado / a.comValor : null,
    tempoMedioGanhoDias: media(a.diasGanho),
    avancos: a.avancos,
    acoesFeitas: a.acoesFeitas,
    cardsCriados: a.cardsCriados,
    abertos: a.abertos,
    emAberto: a.emAberto,
  };
}

export function calcularRanking(
  participantes: Participante[],
  dados: DadosRanking,
  periodo: Intervalo,
  config: ConfigRanking,
  opts: { soNoTime?: Iterable<string> } = {},
): Ranking {
  const { pesos } = config;
  const acc = new Map(participantes.map((p) => [p.id, novo()]));
  const soNoTime = new Set(opts.soNoTime ?? []);
  const time = novo();
  /** Acumuladores que recebem o evento: participante → ele + Time; desativado → só Time. */
  const alvos = (id: string | null): Acumulador[] => {
    if (!id) return [];
    const a = acc.get(id);
    if (a) return [a, time];
    return soNoTime.has(id) ? [time] : [];
  };

  const ganhosNoPeriodo = dados.ganhos.filter((g) => porGente(g.origem) && dentroDoPeriodo(g.dataGanho, periodo));
  for (const g of ganhosNoPeriodo) {
    for (const a of alvos(g.responsavelId)) {
      a.ganhos += 1;
      if (g.valorFechado !== null) {
        a.fechado += g.valorFechado;
        a.comValor += 1;
      }
      a.diasGanho.push(Math.max(0, (g.dataGanho.getTime() - g.criadoEm.getTime()) / DIA_MS));
      pontuar(a, "ganho", pontosDoGanho(g.valorFechado, pesos), g.dataGanho);
    }
  }
  for (const p of dados.perdas) {
    if (!porGente(p.origem) || !dentroDoPeriodo(p.em, periodo)) continue;
    for (const a of alvos(p.responsavelId)) a.perdidos += 1;
  }
  for (const t of avancosQueContam(dados.transicoes, periodo)) {
    for (const x of alvos(t.usuarioId)) {
      x.avancos += 1;
      pontuar(x, "avanco", pesos.avanco, t.em);
    }
  }
  for (const f of acoesQueContam(dados.acoes, periodo, pesos.acoesPorDia)) {
    for (const x of alvos(f.usuarioId)) {
      x.acoesFeitas += 1;
      pontuar(x, "acaoFeita", pesos.acaoFeita, f.em);
    }
  }
  for (const c of dados.criacoes) {
    if (!dentroDoPeriodo(c.em, periodo)) continue;
    for (const x of alvos(c.usuarioId)) {
      x.cardsCriados += 1;
      pontuar(x, "cardCriado", pesos.cardCriado, c.em);
    }
  }
  for (const ab of dados.abertos) {
    for (const x of alvos(ab.responsavelId)) {
      x.abertos += ab.quantidade;
      x.emAberto += ab.orcamento;
    }
  }

  const linhas = participantes
    .map((usuario) => {
      const a = acc.get(usuario.id)!;
      return { usuario, ...fechar(a), detalhe: a.detalhe, alcancouEm: a.alcancouEm, posicao: 0 };
    })
    .sort(
      (x, y) =>
        y.pontos - x.pontos ||
        y.ganhos - x.ganhos ||
        y.fechado - x.fechado ||
        (x.alcancouEm?.getTime() ?? Infinity) - (y.alcancouEm?.getTime() ?? Infinity) ||
        x.usuario.nome.localeCompare(y.usuario.nome, "pt-BR"),
    );
  linhas.forEach((l, i) => (l.posicao = i + 1));

  return { linhas, time: fechar(time), destaques: calcularDestaques(linhas, ganhosNoPeriodo.filter((g) => acc.has(g.responsavelId)), config) };
}

/** Todos os empatados no melhor valor (maior, ou menor com `menor`); valores null/≤0 não concorrem. */
function melhores(linhas: LinhaRanking[], valor: (l: LinhaRanking) => number | null, menor = false) {
  const validos = linhas.map((l) => ({ l, v: valor(l) })).filter((x): x is { l: LinhaRanking; v: number } => x.v !== null && (menor || x.v > 0));
  if (validos.length === 0) return { vencedores: [], valor: null };
  const alvo = menor ? Math.min(...validos.map((x) => x.v)) : Math.max(...validos.map((x) => x.v));
  return { vencedores: validos.filter((x) => x.v === alvo).map((x) => ({ usuario: x.l.usuario })), valor: alvo };
}

function calcularDestaques(linhas: LinhaRanking[], ganhos: Ganho[], config: ConfigRanking): Destaque[] {
  const { fechadosConversao, ganhosTempo } = config.minimos;
  const porId = new Map(linhas.map((l) => [l.usuario.id, l.usuario]));

  const comValor = ganhos.filter((g) => g.valorFechado !== null && g.valorFechado > 0);
  const maiorValor = comValor.length ? Math.max(...comValor.map((g) => g.valorFechado!)) : null;
  const maiorTicket = maiorValor === null ? [] : comValor.filter((g) => g.valorFechado === maiorValor);
  maiorTicket.sort((a, b) => porId.get(a.responsavelId)!.nome.localeCompare(porId.get(b.responsavelId)!.nome, "pt-BR") || a.dataGanho.getTime() - b.dataGanho.getTime());

  const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;
  return [
    { chave: "liderVendas", titulo: "Líder de vendas", formato: "dinheiro", ...melhores(linhas, (l) => l.fechado), dica: "Nenhum valor fechado no período." },
    { chave: "maisGanhos", titulo: "Mais ganhos", formato: "inteiro", ...melhores(linhas, (l) => l.ganhos), dica: "Nenhuma venda ganha no período." },
    {
      chave: "maiorTicket",
      titulo: "Maior ticket",
      formato: "dinheiro",
      vencedores: maiorTicket.map((g) => ({ usuario: porId.get(g.responsavelId)!, card: { id: g.projetoId, titulo: g.titulo } })),
      valor: maiorValor,
      dica: "Nenhum ganho com valor fechado no período.",
    },
    {
      chave: "melhorConversao",
      titulo: "Melhor conversão",
      formato: "percentual",
      ...melhores(linhas, (l) => (l.ganhos + l.perdidos >= fechadosConversao ? l.conversao : null)),
      dica: `Mínimo de ${plural(fechadosConversao, "venda fechada", "vendas fechadas")} (ganhas + perdidas).`,
    },
    { chave: "maisAvancos", titulo: "Mais avanços de fase", formato: "inteiro", ...melhores(linhas, (l) => l.avancos), dica: "Nenhum avanço de fase no período." },
    { chave: "maisAcoes", titulo: "Mais próximas ações feitas", formato: "inteiro", ...melhores(linhas, (l) => l.acoesFeitas), dica: "Nenhuma próxima ação marcada como feita." },
    {
      chave: "fechamentoMaisRapido",
      titulo: "Fechamento mais rápido",
      formato: "dias",
      ...melhores(linhas, (l) => (l.ganhos >= ganhosTempo ? l.tempoMedioGanhoDias : null), true),
      dica: `Mínimo de ${plural(ganhosTempo, "ganho", "ganhos")} no período.`,
    },
  ];
}

export type ItemFeed = {
  tipo: "GANHO" | "AVANCO";
  em: Date;
  projetoId: string;
  titulo: string;
  usuario: Participante;
  /** Avanço: nome da fase de destino. */
  faseNome?: string;
};

export const DIAS_FEED = 7;

export function janelaFeed(agora: Date): Intervalo {
  return { inicio: new Date(agora.getTime() - DIAS_FEED * DIA_MS), fim: new Date(agora.getTime() + 1) };
}

/** O agregado do período já traz tudo dos últimos 7 dias? (então o feed não precisa de outra consulta) */
export function cobreJanelaFeed(periodo: Intervalo, agora: Date): boolean {
  const j = janelaFeed(agora);
  return periodo.inicio.getTime() <= j.inicio.getTime() && periodo.fim.getTime() >= j.fim.getTime();
}

/**
 * Feed "últimos 7 dias": ganhos e avanços que pontuam, de participantes, mais
 * recentes primeiro. `apenas` filtra pelo usuário ANTES do limite (ranking
 * oculto: os itens mais novos dos outros não podem esconder os do vendedor).
 */
export function montarFeed(participantes: Participante[], dados: DadosRanking, agora: Date, opts: { limite?: number; apenas?: string } = {}): ItemFeed[] {
  const { limite = 30, apenas } = opts;
  const janela = janelaFeed(agora);
  const porId = new Map(participantes.filter((p) => !apenas || p.id === apenas).map((p) => [p.id, p]));
  const itens: ItemFeed[] = [];
  for (const g of dados.ganhos) {
    const u = porId.get(g.responsavelId);
    if (u && porGente(g.origem) && dentroDoPeriodo(g.dataGanho, janela)) itens.push({ tipo: "GANHO", em: g.dataGanho, projetoId: g.projetoId, titulo: g.titulo, usuario: u });
  }
  for (const t of avancosQueContam(dados.transicoes, janela)) {
    const u = t.usuarioId ? porId.get(t.usuarioId) : undefined;
    if (u) itens.push({ tipo: "AVANCO", em: t.em, projetoId: t.projetoId, titulo: t.titulo, usuario: u, faseNome: t.paraFaseNome });
  }
  return itens.sort((a, b) => b.em.getTime() - a.em.getTime()).slice(0, limite);
}

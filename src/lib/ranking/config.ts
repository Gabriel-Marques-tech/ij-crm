/** Configuração do ranking (GAB-44): pesos, mínimos dos destaques e visibilidade. Chave `ranking`. */
import { z } from "zod";
import { definirConfiguracao } from "@/lib/configuracao/definicao";

const inteiro = (rotulo: string, max: number) =>
  z
    .number({ error: `${rotulo}: informe um número.` })
    .int(`${rotulo}: use um número inteiro.`)
    .min(0, `${rotulo}: não pode ser negativo.`)
    .max(max, `${rotulo}: no máximo ${max}.`);

export const PESOS_PADRAO = {
  /** Venda ganha (data_ganho no período). */
  ganho: 100,
  /** Bônus a cada R$ 1.000 de valor fechado… */
  bonusPorMil: 1,
  /** …até este teto de pontos de bônus por venda. */
  tetoBonus: 100,
  /** Primeira entrada do card numa fase aberta de ordem maior (Vendas). */
  avanco: 5,
  /** "Marcar feita" da Minha Semana… */
  acaoFeita: 2,
  /** …no máximo esta quantidade por vendedor por dia de SP. */
  acoesPorDia: 4,
  /** Card criado em Vendas (UI ou WhatsApp). */
  cardCriado: 1,
} as const;

export const MINIMOS_PADRAO = {
  /** Melhor conversão: mínimo de vendas fechadas (ganhas + perdidas). */
  fechadosConversao: 3,
  /** Fechamento mais rápido: mínimo de ganhos. */
  ganhosTempo: 2,
} as const;

export const rankingSchema = z.object({
  pesos: z.object({
    ganho: inteiro("Ganho", 10_000),
    bonusPorMil: inteiro("Bônus por R$ 1.000", 1_000),
    tetoBonus: inteiro("Teto do bônus", 100_000),
    avanco: inteiro("Avanço de fase", 1_000),
    acaoFeita: inteiro("Próxima ação feita", 1_000),
    // `default`: config gravada antes deste campo continua válida (não cai toda no padrão).
    acoesPorDia: inteiro("Ações feitas por dia", 100).default(PESOS_PADRAO.acoesPorDia),
    cardCriado: inteiro("Card criado", 1_000),
  }),
  minimos: z.object({
    fechadosConversao: inteiro("Mínimo de fechados", 100).min(1, "Mínimo de fechados: pelo menos 1."),
    ganhosTempo: inteiro("Mínimo de ganhos", 100).min(1, "Mínimo de ganhos: pelo menos 1."),
  }),
  mostrarAosVendedores: z.boolean(),
});

export type ConfigRanking = z.infer<typeof rankingSchema>;
export type PesosRanking = ConfigRanking["pesos"];

export const CONFIG_RANKING_PADRAO: ConfigRanking = { pesos: { ...PESOS_PADRAO }, minimos: { ...MINIMOS_PADRAO }, mostrarAosVendedores: true };

export const CONFIG_RANKING = definirConfiguracao("ranking", rankingSchema, CONFIG_RANKING_PADRAO);

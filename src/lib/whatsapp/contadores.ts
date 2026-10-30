/**
 * Contadores diários do que o pipeline NÃO guardou (design doc §2: nada de
 * conteúdo fora de venda). Uma linha por dia civil de São Paulo, só números.
 *
 * - `total`: descartadas — sem `#crm` e irrelevantes (classificador ou ruído
 *   óbvio), remetente desconhecido sem tag, ou sem tag com intenção IGNORAR.
 * - `naoClassificadas`: sem `#crm` e o classificador falhou (sem crédito,
 *   provedor fora). O texto também não fica — ver `sem-tag.ts`.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { diaEmFuso } from "@/lib/projetos/aging";

type Cliente = Prisma.TransactionClient | typeof db;

/** Dia civil em São Paulo como `Date` à meia-noite UTC (coluna `@db.Date`). */
export function diaContador(quando: Date): Date {
  return new Date(`${diaEmFuso(quando)}T00:00:00Z`);
}

export async function contarDescartada(cliente: Cliente, quando: Date) {
  const dia = diaContador(quando);
  await cliente.contadorDescartadas.upsert({ where: { dia }, create: { dia, total: 1 }, update: { total: { increment: 1 } } });
}

export async function contarNaoClassificada(cliente: Cliente, quando: Date) {
  const dia = diaContador(quando);
  await cliente.contadorDescartadas.upsert({
    where: { dia },
    create: { dia, naoClassificadas: 1 },
    update: { naoClassificadas: { increment: 1 } },
  });
}

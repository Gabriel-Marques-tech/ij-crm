import { PrismaClient } from "@prisma/client";
import { sanitizarErroPrisma } from "./erros/prisma"; // relativo: o db também roda em scripts (tsx)

/**
 * LGPD: a `message` dos erros do Prisma ecoa os argumentos da query (emails,
 * telefones, textos) e o Next imprime o erro original no stderr. Por isso:
 * - toda operação (modelos, SQL cru, dentro de `$transaction`) passa por um
 *   `$extends` que troca a mensagem pela descrição segura no próprio erro e
 *   limpa `meta` (classe, `code`, `meta.target`, `clientVersion` intactos);
 * - o ciclo de vida da transação interativa (begin/commit/timeout P2028) não
 *   passa pelo `$allOperations`: `$transaction` é embrulhado para o mesmo fim;
 * - o log do Prisma vai por evento e só com o `target`, sem a mensagem.
 * `errorFormat: "minimal"` não resolve: ainda ecoa a query.
 */
function criar(): PrismaClient {
  const base = new PrismaClient({
    log: [{ emit: "event", level: "error" }, ...(process.env.NODE_ENV === "development" ? [{ emit: "stdout" as const, level: "warn" as const }] : [])],
  });
  base.$on("error", (e) => console.error(`prisma:error target=${e.target}`));
  // Extensão só de `query`: não muda tipos de modelos/resultados. O cast mantém
  // `db` compatível com `Prisma.TransactionClient` e com quem tipa `PrismaClient`.
  const estendido = base.$extends({
    query: {
      async $allOperations({ args, query }) {
        try {
          return await query(args);
        } catch (e) {
          sanitizarErroPrisma(e);
          throw e;
        }
      },
    },
  }) as unknown as PrismaClient;
  const transacao = estendido.$transaction.bind(estendido) as (...a: unknown[]) => Promise<unknown>;
  const $transaction = (...a: unknown[]) =>
    transacao(...a).catch((e: unknown) => {
      sanitizarErroPrisma(e);
      throw e;
    });
  // Propriedade própria comum (não Proxy): continua substituível por `vi.spyOn`.
  Object.defineProperty(estendido, "$transaction", { value: $transaction, writable: true, configurable: true });
  return estendido;
}

// Singleton: evita abrir N conexões no hot reload do Next em dev.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? criar();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

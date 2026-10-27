import { PrismaClient } from "@prisma/client";
import { sanitizarErroPrisma } from "@/lib/erros/prisma";

/**
 * LGPD: a `message` dos erros do Prisma ecoa os argumentos da query (emails,
 * telefones, textos) e o Next imprime o erro original no stderr. Por isso:
 * - toda operação (modelos, SQL cru, dentro de `$transaction`) passa por um
 *   `$extends` que troca a mensagem pela descrição segura no próprio erro
 *   (classe, `code`, `meta`, `clientVersion` intactos);
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
  return base.$extends({
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
}

// Singleton: evita abrir N conexões no hot reload do Next em dev.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? criar();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

/**
 * Infra de teste de integração: usa o Postgres do compose num schema separado
 * (`ijcrm_test`), migrado pelo globalSetup. Cada teste limpa as tabelas que usa.
 */
import { PrismaClient } from "@prisma/client";

export const SCHEMA_TESTE = "ijcrm_test";

/** Garante que TRUNCATE/migrate dos testes nunca apontam para outro schema. */
export function urlDeTeste(): string {
  let url: URL;
  if (process.env.DATABASE_URL_TEST) {
    url = new URL(process.env.DATABASE_URL_TEST);
  } else {
    url = new URL(process.env.DATABASE_URL ?? "postgresql://ijcrm:ijcrm@localhost:5432/ijcrm");
    url.searchParams.set("schema", SCHEMA_TESTE);
  }
  // Aceita ijcrm_test ou ijcrm_test_<sufixo>: worktrees paralelos usam schemas próprios.
  const schema = url.searchParams.get("schema") ?? "";
  if (schema !== SCHEMA_TESTE && !schema.startsWith(`${SCHEMA_TESTE}_`)) {
    throw new Error(`URL de teste precisa usar schema=${SCHEMA_TESTE} ou ${SCHEMA_TESTE}_<sufixo> (recebido: ${schema})`);
  }
  return url.toString();
}

let cliente: PrismaClient | undefined;

export function dbTeste(): PrismaClient {
  cliente ??= new PrismaClient({ datasources: { db: { url: urlDeTeste() } } });
  return cliente;
}

/** TRUNCATE em cascata nas tabelas de domínio (ordem não importa). */
export async function limparBanco(tabelas: string[]) {
  urlDeTeste(); // revalida o schema antes de qualquer destruição
  const db = dbTeste();
  const lista = tabelas.map((t) => `"${t}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${lista} RESTART IDENTITY CASCADE`);
}

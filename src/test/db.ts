/**
 * Infra de teste de integração: usa o Postgres do compose num schema separado
 * (`ijcrm_test`), migrado pelo globalSetup. Cada teste limpa as tabelas que usa.
 */
import { PrismaClient } from "@prisma/client";

export function urlDeTeste(): string {
  if (process.env.DATABASE_URL_TEST) return process.env.DATABASE_URL_TEST;
  const base = process.env.DATABASE_URL ?? "postgresql://ijcrm:ijcrm@localhost:5432/ijcrm";
  const u = new URL(base);
  u.searchParams.set("schema", "ijcrm_test");
  return u.toString();
}

let cliente: PrismaClient | undefined;

export function dbTeste(): PrismaClient {
  cliente ??= new PrismaClient({ datasources: { db: { url: urlDeTeste() } } });
  return cliente;
}

/** TRUNCATE em cascata nas tabelas de domínio (ordem não importa). */
export async function limparBanco(tabelas: string[]) {
  const db = dbTeste();
  const lista = tabelas.map((t) => `"${t}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${lista} RESTART IDENTITY CASCADE`);
}

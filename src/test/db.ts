/**
 * Infra de teste de integração: usa o Postgres do compose num schema separado,
 * migrado pelo globalSetup. Cada teste limpa as tabelas que usa (TRUNCATE).
 *
 * Schema: `DATABASE_URL_TEST` quando definida (precisa ser `ijcrm_test` ou
 * `ijcrm_test_<sufixo>`); senão `ijcrm_test_<hash do diretório>` — cada
 * worktree tem o seu, e dois agentes em paralelo nunca truncam as tabelas um
 * do outro.
 */
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

export const SCHEMA_TESTE = "ijcrm_test";

/** `ijcrm_test_<8 hex do sha256 do diretório>`: estável por worktree. */
export function schemaPadraoDeTeste(diretorio: string = process.cwd()): string {
  return `${SCHEMA_TESTE}_${createHash("sha256").update(diretorio).digest("hex").slice(0, 8)}`;
}

/** Garante que TRUNCATE/migrate dos testes nunca apontam para outro schema. */
export function urlDeTeste(): string {
  let url: URL;
  if (process.env.DATABASE_URL_TEST) {
    url = new URL(process.env.DATABASE_URL_TEST);
  } else {
    url = new URL(process.env.DATABASE_URL ?? "postgresql://ijcrm:ijcrm@localhost:5432/ijcrm");
    url.searchParams.set("schema", schemaPadraoDeTeste());
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

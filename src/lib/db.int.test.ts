import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { limparBanco } from "@/test/db";

const EMAIL = "ana.segredo@exemplo.test";

beforeEach(() => limparBanco(["usuario"]));
afterAll(() => limparBanco(["usuario"]));

async function capturar(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error("devia ter falhado");
}

function semSegredo(e: Error) {
  expect(e.message).not.toContain(EMAIL);
  expect(e.message).not.toContain("segredo");
  expect(e.stack ?? "").not.toContain(EMAIL);
  expect(JSON.stringify((e as { meta?: unknown }).meta ?? {})).not.toContain(EMAIL);
}

describe("db: erros do Prisma saem sem os argumentos da query (LGPD)", () => {
  it("validação com email nos args → mesma classe, mensagem sem o email", async () => {
    // campo inexistente força PrismaClientValidationError, que ecoa a query inteira
    const e = await capturar(db.usuario.findFirst({ where: { email: EMAIL, naoExiste: 1 } as never }));
    expect(e).toBeInstanceOf(Prisma.PrismaClientValidationError);
    semSegredo(e);
    expect(e.message).toContain("PrismaClientValidationError");
  });

  it("P2002 continua KnownRequestError com code/meta/clientVersion (tratamento de unicidade intacto)", async () => {
    await db.usuario.create({ data: { nome: "Ana", email: EMAIL } });
    const e = await capturar(db.usuario.create({ data: { nome: "Ana 2", email: EMAIL } }));
    expect(e).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    const k = e as Prisma.PrismaClientKnownRequestError;
    expect(k.code).toBe("P2002");
    expect(k.meta?.target).toEqual(["email"]);
    expect(k.clientVersion).toBeTruthy();
    semSegredo(e);
    expect(e.message).toContain("P2002");
  });

  it("também dentro de transação interativa e em SQL cru", async () => {
    await db.usuario.create({ data: { nome: "Ana", email: EMAIL } });
    const e = await capturar(db.$transaction((tx) => tx.usuario.findFirst({ where: { email: EMAIL, naoExiste: 1 } as never })));
    expect(e).toBeInstanceOf(Prisma.PrismaClientValidationError);
    semSegredo(e);
    // o Postgres ecoa o valor duplicado: "Key (email)=(ana...) already exists"
    const cru = await capturar(db.$executeRawUnsafe(`INSERT INTO usuario (id, nome, email, atualizado_em) VALUES ('x2', 'Ana', '${EMAIL}', now())`));
    expect(cru).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    semSegredo(cru);
  });

  it("SQL cru com template ($queryRaw/$executeRaw): Postgres ecoa o valor em meta → sai", async () => {
    await db.usuario.create({ data: { nome: "Ana", email: EMAIL } });
    const exec = await capturar(db.$executeRaw`INSERT INTO usuario (id, nome, email, atualizado_em) VALUES ('x3', 'Ana', ${EMAIL}, now())`);
    expect((exec as Prisma.PrismaClientKnownRequestError).code).toBe("P2010");
    semSegredo(exec);
    const query = await capturar(db.$queryRaw`SELECT * FROM usuario WHERE email = ${EMAIL} AND id = ${EMAIL}::int`);
    semSegredo(query);
  });

  it("$transaction em lote e escrita aninhada", async () => {
    await db.usuario.create({ data: { nome: "Ana", email: EMAIL } });
    const lote = await capturar(db.$transaction([db.usuario.create({ data: { nome: "Ana 2", email: EMAIL } })]));
    expect((lote as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");
    semSegredo(lote);
    const aninhada = await capturar(
      // erro no nível aninhado ecoa os args do pai e do filho
      db.usuario.create({ data: { nome: "Bia", email: `bia.${EMAIL}`, sessoes: { create: [{ id: EMAIL, expiraEm: "nao-e-data" }] } } as never }),
    );
    expect(aninhada).toBeInstanceOf(Prisma.PrismaClientValidationError);
    semSegredo(aninhada);
  });

  it("timeout de transação interativa no commit (P2028) mantém classe/código", async () => {
    const e = await capturar(
      db.$transaction(
        async (tx) => {
          await tx.usuario.count();
          await new Promise((r) => setTimeout(r, 300));
        },
        { timeout: 50 },
      ),
    );
    expect(e).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((e as Prisma.PrismaClientKnownRequestError).code).toBe("P2028");
    expect(e.message).toMatch(/^Prisma P2028/);
  });
});

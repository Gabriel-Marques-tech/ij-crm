import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { sanitizarErroPrisma } from "./prisma";

const EMAIL = "ana@segredo.test";

describe("sanitizarErroPrisma: meta só com chaves estruturais", () => {
  it("SQL cru (P2010): meta.message com 'Key (email)=(...)' sai; code fica", () => {
    const e = new Prisma.PrismaClientKnownRequestError(`Raw query failed. Key (email)=(${EMAIL})`, {
      code: "P2010",
      clientVersion: "6.19.3",
      meta: { code: "23505", message: `Key (email)=(${EMAIL}) already exists.` },
    });
    sanitizarErroPrisma(e);
    expect(JSON.stringify(e.meta)).not.toContain(EMAIL);
    expect(e.meta).toEqual({ code: "23505" });
    expect(e.message).not.toContain(EMAIL);
  });

  it("P2002: target e modelName intactos (o tratamento de unicidade depende deles)", () => {
    const e = new Prisma.PrismaClientKnownRequestError("x", { code: "P2002", clientVersion: "6.19.3", meta: { target: ["email"], modelName: "Usuario" } });
    sanitizarErroPrisma(e);
    expect(e.meta).toEqual({ target: ["email"], modelName: "Usuario" });
  });

  it("estruturais (field_name/table/column/constraint) ficam; texto livre e valores não-código saem", () => {
    const e = new Prisma.PrismaClientKnownRequestError("x", {
      code: "P2003",
      clientVersion: "6.19.3",
      meta: { field_name: "fk_empresa", table: "contato", column: "email", constraint: "uq", cause: `Registro ${EMAIL} não achado`, error: "Transaction already closed", valor: EMAIL },
    });
    sanitizarErroPrisma(e);
    expect(e.meta).toEqual({ field_name: "fk_empresa", table: "contato", column: "email", constraint: "uq" });
  });
});

import { describe, expect, it } from "vitest";
import { redigirPii } from "./redigir";

describe("redigirPii (mensagem de erro genérico antes do log)", () => {
  it("mensagem técnica continua legível", () => {
    expect(redigirPii("travarPipelines is not a function")).toBe("travarPipelines is not a function");
    expect(redigirPii("Cannot read properties of undefined (reading 'fase') na linha 42")).toBe(
      "Cannot read properties of undefined (reading 'fase') na linha 42",
    );
    expect(redigirPii("PrismaClientKnownRequestError em travarPipelines")).toBe("PrismaClientKnownRequestError em travarPipelines");
  });

  it("mascara email, telefone, sequência longa de dígitos, CPF/CNPJ e token", () => {
    const r = redigirPii(
      "falhou ana.souza+x@empresa.com.br tel +55 (11) 98765-4321 id 12345678 cpf 123.456.789-09 cnpj 12.345.678/0001-90 tok 9f86d081884c7d659a2feaa0c55ad015",
    );
    for (const segredo of ["ana.souza", "empresa.com", "98765", "12345678", "123.456.789-09", "12.345.678/0001-90", "9f86d081884c"]) {
      expect(r).not.toContain(segredo);
    }
    expect(r).toContain("[email]");
    expect(r).toContain("[num]");
    expect(r).toContain("[doc]");
    expect(r).toContain("[token]");
  });

  it("CPF/telefone sem pontuação e base64 também", () => {
    expect(redigirPii("cpf 12345678909")).not.toContain("12345678909");
    expect(redigirPii("5511987654321")).not.toContain("987654321");
    expect(redigirPii("k=dGhpcyBpcyBhIHNlY3JldCB0b2tlbg==")).not.toContain("dGhpcyBpcyBh");
  });

  it("trunca em ~200 caracteres", () => {
    const r = redigirPii("x ".repeat(300));
    expect(r.length).toBeLessThanOrEqual(201);
    expect(r.endsWith("…")).toBe(true);
  });
});

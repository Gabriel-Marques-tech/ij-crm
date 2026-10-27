import { afterEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { redirect, notFound } from "next/navigation";
import { comTratamento, comTratamentoForm, descreverErro, ehInesperado, registrarErro } from "./registrar";

afterEach(() => vi.restoreAllMocks());

function erroPrisma() {
  // Prisma ecoa argumentos da query na mensagem: é exatamente o que NÃO pode vazar.
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed: email = 'ana@segredo.test' senha_hash=$argon2...", {
    code: "P2002",
    clientVersion: "6.19.3",
    meta: { target: ["email"], modelName: "Usuario" },
  });
}

describe("descreverErro", () => {
  it("Prisma conhecido → só code + target/modelName, nunca a mensagem", () => {
    const d = descreverErro(erroPrisma());
    expect(d).toContain("P2002");
    expect(d).toContain("email");
    expect(d).toContain("Usuario");
    expect(d).not.toContain("segredo");
    expect(d).not.toContain("argon2");
    expect(d).not.toContain("Unique constraint");
  });

  it("demais erros do Prisma → só a classe (e o código, se houver), nunca a mensagem", () => {
    const segredo = "where: { email: 'ana@segredo.test' }";
    const casos: [Error, string][] = [
      [new Prisma.PrismaClientValidationError(`Argument missing ${segredo}`, { clientVersion: "6.19.3" }), "PrismaClientValidationError"],
      [new Prisma.PrismaClientUnknownRequestError(`falhou ${segredo}`, { clientVersion: "6.19.3" }), "PrismaClientUnknownRequestError"],
      [new Prisma.PrismaClientRustPanicError(`panic ${segredo}`, "6.19.3"), "PrismaClientRustPanicError"],
      [new Prisma.PrismaClientInitializationError(`não conectou ${segredo}`, "6.19.3", "P1001"), "PrismaClientInitializationError P1001"],
    ];
    for (const [e, esperado] of casos) {
      const d = descreverErro(e);
      expect(d).toBe(esperado);
      expect(d).not.toContain("segredo");
    }
  });

  it("Prisma conhecido loga só as CHAVES de meta além de target/modelName", () => {
    const e = new Prisma.PrismaClientKnownRequestError("x", { code: "P2003", clientVersion: "6.19.3", meta: { field_name: "fk", valor: "ana@segredo.test" } });
    const d = descreverErro(e);
    expect(d).toBe("Prisma P2003 meta=field_name,valor");
    expect(d).not.toContain("segredo");
  });

  it("Error comum → nome: mensagem + no máximo 3 frames do stack", () => {
    const e = new TypeError("travarPipelines is not a function");
    e.stack = ["TypeError: travarPipelines is not a function", "    at a (x.ts:1)", "    at b (x.ts:2)", "    at c (x.ts:3)", "    at d (x.ts:4)"].join("\n");
    const d = descreverErro(e);
    expect(d).toContain("TypeError: travarPipelines is not a function");
    expect(d).toContain("at a (x.ts:1)");
    expect(d).toContain("at c (x.ts:3)");
    expect(d).not.toContain("at d (x.ts:4)");
  });

  it("não-Error → só o typeof (não serializa o valor)", () => {
    expect(descreverErro("senha=123")).toBe("lançado valor não-Error (string)");
    expect(descreverErro({ token: "abc" })).toBe("lançado valor não-Error (object)");
  });
});

describe("registrarErro", () => {
  it("devolve ref de 8 hex e loga [contexto] ref=<ref> <descrição>", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const ref = registrarErro("kanban.criarCard", erroPrisma());
    expect(ref).toMatch(/^[0-9a-f]{8}$/);
    expect(log).toHaveBeenCalledTimes(1);
    const linha = String(log.mock.calls[0][0]);
    expect(linha.startsWith(`[kanban.criarCard] ref=${ref} `)).toBe(true);
    expect(linha).not.toContain("segredo");
  });

  it("refs diferentes a cada chamada", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(registrarErro("x", new Error("a"))).not.toBe(registrarErro("x", new Error("a")));
  });
});

describe("comTratamento", () => {
  it("passa o resultado normal adiante", async () => {
    expect(await comTratamento("x", async () => ({ ok: true }))).toEqual({ ok: true });
  });

  it("exceção inesperada → { ok: false, erro: INESPERADO, ref } e loga", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await comTratamento("x", async () => {
      throw new TypeError("boom");
    });
    expect(r).toMatchObject({ ok: false, erro: "INESPERADO" });
    expect((r as { ref: string }).ref).toMatch(/^[0-9a-f]{8}$/);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("redirect / notFound do Next são relançados, não viram erro", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(comTratamento("x", async () => redirect("/login"))).rejects.toThrow();
    await expect(comTratamento("x", async () => notFound())).rejects.toThrow();
    expect(log).not.toHaveBeenCalled();
  });
});

describe("comTratamentoForm", () => {
  it("erro de regra passa intacto; inesperado vira texto com a ref", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await comTratamentoForm("x", async () => ({ erro: "Email inválido." }))).toEqual({ erro: "Email inválido." });
    const r = await comTratamentoForm("x", async (): Promise<{ erro?: string }> => {
      throw new Error("db caiu");
    });
    const ref = (r as { ref: string }).ref;
    expect(ref).toMatch(/^[0-9a-f]{8}$/);
    expect(r.erro).toContain(`ref: ${ref}`);
    expect(r.erro).not.toContain("db caiu");
  });
});

describe("ehInesperado (leituras de página envolvidas em comTratamento)", () => {
  it("distingue o resultado com ref dos dados normais", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const falhou = await comTratamento("pagina.teste", async () => {
      throw new Error("db caiu");
    });
    expect(ehInesperado(falhou)).toBe(true);
    if (ehInesperado(falhou)) expect(falhou.ref).toMatch(/^[0-9a-f]{8}$/);
    expect(ehInesperado(await comTratamento("pagina.teste", async () => ({ nome: "x" })))).toBe(false);
    expect(ehInesperado(await comTratamento("pagina.teste", async () => null))).toBe(false);
  });
});

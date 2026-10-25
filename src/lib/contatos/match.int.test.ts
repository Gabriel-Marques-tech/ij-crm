import { beforeEach, describe, expect, it } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { encontrarContatoPorIdentificador, encontrarEmpresa } from "./match";

const db = dbTeste();

beforeEach(async () => {
  await limparBanco(["contato_ponto", "contato", "empresa"]);
});

async function contato(nome: string, pontos: { tipo: "TELEFONE" | "EMAIL"; valorNormalizado: string }[], extra: object = {}) {
  return db.contato.create({ data: { nome, ...extra, pontos: { create: pontos.map((p) => ({ ...p, valorOriginal: p.valorNormalizado })) } } });
}

describe("encontrarContatoPorIdentificador", () => {
  it("casa telefone em qualquer formato (com/sem 9, DDI) e email em qualquer caixa", async () => {
    const c = await contato("Gustavo", [
      { tipo: "TELEFONE", valorNormalizado: "+5511999998888" },
      { tipo: "EMAIL", valorNormalizado: "gustavo@acme.com" },
    ]);
    for (const e of ["11 99999-8888", "11 9999-8888", "+55 11 99999-8888", "551199998888", "  GUSTAVO@Acme.com "]) {
      expect(await encontrarContatoPorIdentificador(e)).toEqual({ id: c.id, nome: "Gustavo", empresaId: null });
    }
  });

  it("nunca casa por nome nem por valor aproximado", async () => {
    await contato("Gustavo", [{ tipo: "TELEFONE", valorNormalizado: "+5511999998888" }]);
    expect(await encontrarContatoPorIdentificador("Gustavo")).toBeNull();
    expect(await encontrarContatoPorIdentificador("11 99999-8887")).toBeNull();
    expect(await encontrarContatoPorIdentificador("gustavo@acme.co")).toBeNull();
    expect(await encontrarContatoPorIdentificador("")).toBeNull();
  });

  it("mesclado resolve para o destino; soft-deletado não casa", async () => {
    const destino = await contato("Ana (principal)", []);
    await contato("Ana dup", [{ tipo: "EMAIL", valorNormalizado: "ana@acme.com" }], { mergedIntoId: destino.id });
    await contato("Morto", [{ tipo: "EMAIL", valorNormalizado: "morto@acme.com" }], { deletadoEm: new Date() });
    expect((await encontrarContatoPorIdentificador("ana@acme.com"))?.id).toBe(destino.id);
    expect(await encontrarContatoPorIdentificador("morto@acme.com")).toBeNull();
  });

  it("roda dentro de transação", async () => {
    const c = await contato("Tx", [{ tipo: "EMAIL", valorNormalizado: "tx@acme.com" }]);
    const r = await db.$transaction((tx) => encontrarContatoPorIdentificador("tx@acme.com", tx));
    expect(r?.id).toBe(c.id);
  });
});

describe("encontrarEmpresa", () => {
  it("casa CNPJ (numérico e alfanumérico) com ou sem pontuação/caixa", async () => {
    const a = await db.empresa.create({ data: { nome: "Acme", cnpj: "11222333000181" } });
    const b = await db.empresa.create({ data: { nome: "Beta", cnpj: "12ABC34501DE35" } });
    expect(await encontrarEmpresa("11.222.333/0001-81")).toEqual({ id: a.id, nome: "Acme" });
    expect(await encontrarEmpresa("12.abc.345/01de-35")).toEqual({ id: b.id, nome: "Beta" });
    expect(await encontrarEmpresa("11.222.333/0001-82")).toBeNull(); // DV errado não é CNPJ
  });

  it("casa domínio vindo de email ou URL; provedor pessoal nunca", async () => {
    const a = await db.empresa.create({ data: { nome: "Acme", dominioEmail: "acme.com.br" } });
    await db.empresa.create({ data: { nome: "Gmail?", dominioEmail: "gmail.com" } });
    expect((await encontrarEmpresa("joao@ACME.com.br"))?.id).toBe(a.id);
    expect((await encontrarEmpresa("https://www.acme.com.br/contato"))?.id).toBe(a.id);
    expect(await encontrarEmpresa("ana@gmail.com")).toBeNull();
  });

  it("nunca por nome; domínio ambíguo → null; deletada não casa; mesclada resolve", async () => {
    await db.empresa.create({ data: { nome: "Acme", dominioEmail: "acme.com" } });
    expect(await encontrarEmpresa("Acme")).toBeNull();
    await db.empresa.create({ data: { nome: "Acme 2", dominioEmail: "acme.com" } });
    expect(await encontrarEmpresa("x@acme.com")).toBeNull();

    await db.empresa.create({ data: { nome: "Morta", cnpj: "11222333000181", deletadoEm: new Date() } });
    expect(await encontrarEmpresa("11222333000181")).toBeNull();

    const destino = await db.empresa.create({ data: { nome: "Beta" } });
    await db.empresa.create({ data: { nome: "Beta dup", dominioEmail: "beta.io", mergedIntoId: destino.id } });
    expect((await encontrarEmpresa("ana@beta.io"))?.id).toBe(destino.id);
  });
});

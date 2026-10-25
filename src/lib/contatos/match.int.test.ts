import { beforeEach, describe, expect, it } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { encontrarContatoPorIdentificador, encontrarEmpresa, resolverEmpresas } from "./match";

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
    for (const e of ["11 99999-8888", "11 9999-8888", "+55 11 99999-8888", "551199998888", "  GUSTAVO@Acme.com ", "<gustavo@acme.com>"]) {
      expect(await encontrarContatoPorIdentificador(e)).toEqual({ tipo: "ENCONTRADO", contato: { id: c.id, nome: "Gustavo", empresaId: null } });
    }
  });

  it("nunca casa por nome nem por valor aproximado", async () => {
    await contato("Gustavo", [{ tipo: "TELEFONE", valorNormalizado: "+5511999998888" }]);
    for (const e of ["Gustavo", "11 99999-8887", "gustavo@acme.co", ""]) {
      expect(await encontrarContatoPorIdentificador(e)).toEqual({ tipo: "NAO_ENCONTRADO" });
    }
  });

  it("mesclado resolve para o destino; dono excluído → BLOQUEADO_EXCLUIDO (valor continua preso)", async () => {
    const destino = await contato("Ana (principal)", []);
    await contato("Ana dup", [{ tipo: "EMAIL", valorNormalizado: "ana@acme.com" }], { mergedIntoId: destino.id });
    const morto = await contato("Morto", [{ tipo: "EMAIL", valorNormalizado: "morto@acme.com" }], { deletadoEm: new Date() });
    const destinoMorto = await contato("Destino morto", [], { deletadoEm: new Date() });
    await contato("Dup de morto", [{ tipo: "EMAIL", valorNormalizado: "dup@acme.com" }], { mergedIntoId: destinoMorto.id });

    expect(await encontrarContatoPorIdentificador("ana@acme.com")).toMatchObject({ tipo: "ENCONTRADO", contato: { id: destino.id } });
    expect(await encontrarContatoPorIdentificador("morto@acme.com")).toEqual({ tipo: "BLOQUEADO_EXCLUIDO", contatoId: morto.id });
    expect(await encontrarContatoPorIdentificador("dup@acme.com")).toEqual({ tipo: "BLOQUEADO_EXCLUIDO", contatoId: destinoMorto.id });
  });

  it("roda dentro de transação", async () => {
    const c = await contato("Tx", [{ tipo: "EMAIL", valorNormalizado: "tx@acme.com" }]);
    const r = await db.$transaction((tx) => encontrarContatoPorIdentificador("tx@acme.com", tx));
    expect(r).toMatchObject({ tipo: "ENCONTRADO", contato: { id: c.id } });
  });
});

describe("encontrarEmpresa", () => {
  it("casa CNPJ (numérico e alfanumérico) com ou sem pontuação/caixa, via cnpj", async () => {
    const a = await db.empresa.create({ data: { nome: "Acme", cnpj: "11222333000181" } });
    const b = await db.empresa.create({ data: { nome: "Beta", cnpj: "12ABC34501DE35" } });
    expect(await encontrarEmpresa("11.222.333/0001-81")).toEqual({ empresa: { id: a.id, nome: "Acme" }, via: "cnpj" });
    expect(await encontrarEmpresa("12.abc.345/01de-35")).toEqual({ empresa: { id: b.id, nome: "Beta" }, via: "cnpj" });
    expect(await encontrarEmpresa("11.222.333/0001-82")).toBeNull(); // DV errado não é CNPJ
  });

  it("domínio vindo de email ou URL casa como SUGESTÃO (via dominio); provedor pessoal nunca", async () => {
    const a = await db.empresa.create({ data: { nome: "Acme", dominioEmail: "acme.com.br" } });
    await db.empresa.create({ data: { nome: "Gmail?", dominioEmail: "gmail.com" } });
    expect(await encontrarEmpresa("joao@ACME.com.br")).toEqual({ empresa: { id: a.id, nome: "Acme" }, via: "dominio" });
    expect((await encontrarEmpresa("https://www.acme.com.br/contato"))?.empresa.id).toBe(a.id);
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
    expect((await encontrarEmpresa("ana@beta.io"))?.empresa.id).toBe(destino.id);
  });

  it("dois registros com o mesmo domínio que resolvem para a mesma empresa não são ambíguos", async () => {
    const destino = await db.empresa.create({ data: { nome: "Beta", dominioEmail: "beta.io" } });
    await db.empresa.create({ data: { nome: "Beta dup", dominioEmail: "beta.io", mergedIntoId: destino.id } });
    expect((await encontrarEmpresa("ana@beta.io"))?.empresa.id).toBe(destino.id);
  });
});

describe("resolverEmpresas", () => {
  it("resolve cadeias em lote e para em ciclo", async () => {
    const c = await db.empresa.create({ data: { nome: "C" } });
    const b = await db.empresa.create({ data: { nome: "B", mergedIntoId: c.id } });
    const a = await db.empresa.create({ data: { nome: "A", mergedIntoId: b.id } });
    const x = await db.empresa.create({ data: { nome: "X" } });
    const y = await db.empresa.create({ data: { nome: "Y", mergedIntoId: x.id } });
    await db.empresa.update({ where: { id: x.id }, data: { mergedIntoId: y.id } }); // ciclo por erro
    const r = await resolverEmpresas([a.id, c.id, x.id, "nao-existe"]);
    expect(r.get(a.id)).toEqual({ id: c.id, nome: "C", deletado: false, mesclado: true });
    expect(r.get(c.id)).toEqual({ id: c.id, nome: "C", deletado: false, mesclado: false });
    expect(r.has(x.id)).toBe(false);
    expect(r.has("nao-existe")).toBe(false);
  });
});

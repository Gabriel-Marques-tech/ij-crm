import { beforeEach, describe, expect, it } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { buscarEmpresasPorNome, criarEmpresa, editarEmpresa, listarEmpresas, obterEmpresa } from "./empresas";

const db = dbTeste();

beforeEach(async () => {
  await limparBanco(["timeline", "transicao_fase", "oportunidade", "fase", "pipeline", "contato_ponto", "contato", "empresa", "sessao", "usuario"]);
});

describe("criarEmpresa / editarEmpresa", () => {
  it("grava CNPJ e domínio normalizados; empresa sem contato é válida", async () => {
    const r = await criarEmpresa({ nome: " Acme  Ltda ", cnpj: "12.abc.345/01de-35", dominioEmail: "https://www.Acme.com.br/" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const e = await db.empresa.findUniqueOrThrow({ where: { id: r.id } });
    expect([e.nome, e.cnpj, e.dominioEmail]).toEqual(["Acme Ltda", "12ABC34501DE35", "acme.com.br"]);
  });

  it("CNPJ repetido aponta a empresa dona (criar e editar)", async () => {
    const a = await criarEmpresa({ nome: "Acme", cnpj: "11222333000181" });
    const b = await criarEmpresa({ nome: "Beta" });
    if (!a.ok || !b.ok) throw new Error("setup");
    expect(await criarEmpresa({ nome: "Acme de novo", cnpj: "11.222.333/0001-81" })).toEqual({ ok: false, erro: "CNPJ_DUPLICADO", empresa: { id: a.id, nome: "Acme", deletado: false } });
    expect(await editarEmpresa(b.id, "cnpj", "11222333000181")).toEqual({ ok: false, erro: "CNPJ_DUPLICADO", empresa: { id: a.id, nome: "Acme", deletado: false } });
    expect(await editarEmpresa(a.id, "cnpj", "11.222.333/0001-81")).toEqual({ ok: true }); // o próprio
  });

  it("recusa CNPJ inválido e domínio de provedor pessoal", async () => {
    expect(await criarEmpresa({ nome: "X", cnpj: "123" })).toMatchObject({ ok: false, erro: "CAMPO_INVALIDO" });
    expect(await criarEmpresa({ nome: "X", dominioEmail: "a@gmail.com" })).toMatchObject({ ok: false, erro: "CAMPO_INVALIDO" });
    expect(await criarEmpresa({ nome: "" })).toMatchObject({ ok: false, erro: "NOME_INVALIDO" });
  });

  it("edita campos; vazio limpa", async () => {
    const a = await criarEmpresa({ nome: "Acme", cnpj: "11222333000181" });
    if (!a.ok) throw new Error("setup");
    expect(await editarEmpresa(a.id, "estado", "sp")).toEqual({ ok: true });
    expect(await editarEmpresa(a.id, "cnpj", "")).toEqual({ ok: true });
    const e = await db.empresa.findUniqueOrThrow({ where: { id: a.id } });
    expect([e.estado, e.cnpj]).toEqual(["SP", null]);
    expect(await editarEmpresa("nao-existe", "cidade", "x")).toMatchObject({ ok: false, erro: "EMPRESA_NAO_ENCONTRADA" });
  });
});

describe("leitura", () => {
  it("detalhe e lista ignoram projetos soft-deletados e contatos deletados", async () => {
    const p = await db.pipeline.create({ data: { chave: "vendas", nome: "Vendas", fases: { create: [{ chave: "a", nome: "A", ordem: 0 }] } }, include: { fases: true } });
    const u = await db.usuario.create({ data: { nome: "Vend", email: "v@ij.test" } });
    const a = await criarEmpresa({ nome: "Acme" });
    if (!a.ok) throw new Error("setup");
    const base = { pipelineId: p.id, faseId: p.fases[0].id, responsavelId: u.id, criadoVia: "UI" as const, empresaId: a.id };
    await db.projeto.create({ data: { ...base, titulo: "Viva" } });
    await db.projeto.create({ data: { ...base, titulo: "Apagada", deletadoEm: new Date() } });
    await db.contato.create({ data: { nome: "Ana", empresaId: a.id } });
    await db.contato.create({ data: { nome: "Morto", empresaId: a.id, deletadoEm: new Date() } });

    const d = await obterEmpresa(a.id);
    expect(d?.projetos.map((o) => o.titulo)).toEqual(["Viva"]);
    expect(d?.contatos.map((c) => c.nome)).toEqual(["Ana"]);
    const [l] = await listarEmpresas();
    expect(l._count).toEqual({ contatos: 1, projetos: 1 });
  });

  it("lista busca por nome, CNPJ ou domínio; autocomplete prefixo primeiro", async () => {
    await criarEmpresa({ nome: "Economia Sensata", cnpj: "11222333000181" });
    await criarEmpresa({ nome: "Banco da Economia", dominioEmail: "bancoeco.com.br" });
    await criarEmpresa({ nome: "Outra" });
    expect((await listarEmpresas("economia")).length).toBe(2);
    expect((await listarEmpresas("11.222.333/0001-81")).map((e) => e.nome)).toEqual(["Economia Sensata"]);
    expect((await listarEmpresas("ana@bancoeco.com.br")).map((e) => e.nome)).toEqual(["Banco da Economia"]);
    expect((await buscarEmpresasPorNome("eco")).map((e) => e.nome)).toEqual(["Economia Sensata", "Banco da Economia"]);
  });
});

describe("review", () => {
  it("'%' na busca é literal", async () => {
    await criarEmpresa({ nome: "Acme" });
    await criarEmpresa({ nome: "100% Café" });
    expect((await listarEmpresas("%")).map((e) => e.nome)).toEqual(["100% Café"]);
    expect((await buscarEmpresasPorNome("%")).map((e) => e.nome)).toEqual(["100% Café"]);
  });

  it("CNPJ de empresa mesclada aponta o destino; de excluída vem marcado", async () => {
    const destino = await db.empresa.create({ data: { nome: "Beta" } });
    await db.empresa.create({ data: { nome: "Beta dup", cnpj: "11222333000181", mergedIntoId: destino.id } });
    await db.empresa.create({ data: { nome: "Morta", cnpj: "12ABC34501DE35", deletadoEm: new Date() } });
    expect(await criarEmpresa({ nome: "X", cnpj: "11222333000181" })).toEqual({ ok: false, erro: "CNPJ_DUPLICADO", empresa: { id: destino.id, nome: "Beta", deletado: false } });
    expect(await criarEmpresa({ nome: "X", cnpj: "12ABC34501DE35" })).toMatchObject({ erro: "CNPJ_DUPLICADO", empresa: { nome: "Morta", deletado: true } });
  });

  it("contato de projeto excluído/mesclado vem descrito no detalhe da empresa", async () => {
    const p = await db.pipeline.create({ data: { chave: "vendas", nome: "Vendas", fases: { create: [{ chave: "a", nome: "A", ordem: 0 }] } }, include: { fases: true } });
    const u = await db.usuario.create({ data: { nome: "Vend", email: "v@ij.test" } });
    const a = await criarEmpresa({ nome: "Acme" });
    if (!a.ok) throw new Error("setup");
    const morto = await db.contato.create({ data: { nome: "Morto", deletadoEm: new Date() } });
    await db.projeto.create({ data: { pipelineId: p.id, faseId: p.fases[0].id, responsavelId: u.id, criadoVia: "UI", empresaId: a.id, contatoId: morto.id, titulo: "Card" } });
    expect((await obterEmpresa(a.id))?.projetos[0].contato).toEqual({ estado: "EXCLUIDO", id: morto.id, nome: "Morto" });
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { adicionarPonto, buscarContatosPorNome, criarContato, definirEmpresaDoContato, editarContato, listarContatos, obterContato, removerPonto } from "./contatos";
import { criarEmpresa } from "@/lib/empresas/empresas";

const db = dbTeste();

beforeEach(async () => {
  await limparBanco(["timeline", "transicao_fase", "oportunidade", "fase", "pipeline", "contato_ponto", "contato", "empresa", "sessao", "usuario"]);
});

describe("criarContato", () => {
  it("cria com N telefones e emails, todos normalizados, guardando o original", async () => {
    const r = await criarContato({ nome: "  Gustavo   Saab ", pontos: ["11 9999-8888", " Gustavo@Acme.com.br ", "(21) 3333-4444"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const pontos = await db.contatoPonto.findMany({ where: { contatoId: r.id }, orderBy: { valorNormalizado: "asc" } });
    expect(pontos.map((p) => [p.tipo, p.valorNormalizado, p.valorOriginal])).toEqual([
      ["TELEFONE", "+5511999998888", "11 9999-8888"],
      ["TELEFONE", "+552133334444", "(21) 3333-4444"],
      ["EMAIL", "gustavo@acme.com.br", "Gustavo@Acme.com.br"],
    ]);
    const c = await db.contato.findUniqueOrThrow({ where: { id: r.id } });
    expect(c.nome).toBe("Gustavo Saab");
    expect(c.empresaId).toBeNull(); // contato sem empresa é válido
  });

  it("ignora repetição dentro do próprio pedido (mesmo valor normalizado)", async () => {
    const r = await criarContato({ nome: "Ana", pontos: ["11 99999-8888", "+55 11 9999-8888"] });
    expect(r.ok).toBe(true);
    expect(await db.contatoPonto.count()).toBe(1);
  });

  it("ponto que já é de outro contato → PONTO_DUPLICADO apontando o dono; nada é criado", async () => {
    const a = await criarContato({ nome: "Ana", pontos: ["ana@acme.com"] });
    if (!a.ok) throw new Error("setup");
    const r = await criarContato({ nome: "Ana Paula", pontos: ["11 99999-0000", "ANA@acme.com"] });
    expect(r).toEqual({ ok: false, erro: "PONTO_DUPLICADO", ponto: { tipo: "EMAIL", valorNormalizado: "ana@acme.com" }, contato: { id: a.id, nome: "Ana", deletado: false } });
    expect(await db.contato.count()).toBe(1);
    expect(await db.contatoPonto.count()).toBe(1);
  });

  it("recusa nome vazio, ponto inválido e empresa inexistente", async () => {
    expect(await criarContato({ nome: "  " })).toMatchObject({ ok: false, erro: "NOME_INVALIDO" });
    expect(await criarContato({ nome: "Ana", pontos: ["123"] })).toMatchObject({ ok: false, erro: "PONTO_INVALIDO", valor: "123" });
    expect(await criarContato({ nome: "Ana", empresaId: "nao-existe" })).toMatchObject({ ok: false, erro: "EMPRESA_NAO_ENCONTRADA" });
  });
});

describe("adicionarPonto / removerPonto", () => {
  it("acumula pontos; duplicado aponta o contato existente", async () => {
    const a = await criarContato({ nome: "Ana", pontos: ["11 99999-8888"] });
    const b = await criarContato({ nome: "Bruno" });
    if (!a.ok || !b.ok) throw new Error("setup");

    expect(await adicionarPonto(b.id, "bruno@acme.com")).toMatchObject({ ok: true });
    expect(await adicionarPonto(b.id, "5511 9999-8888")).toEqual({
      ok: false,
      erro: "PONTO_DUPLICADO",
      ponto: { tipo: "TELEFONE", valorNormalizado: "+5511999998888" },
      contato: { id: a.id, nome: "Ana", deletado: false },
    });
    // O mesmo ponto no próprio contato: idempotente, não erro.
    expect(await adicionarPonto(a.id, "+55 11 99999-8888")).toMatchObject({ ok: true, jaExistia: true });
    expect(await db.contatoPonto.count({ where: { contatoId: a.id } })).toBe(1);
  });

  it("respeita o tipo pedido", async () => {
    const a = await criarContato({ nome: "Ana" });
    if (!a.ok) throw new Error("setup");
    expect(await adicionarPonto(a.id, "11 99999-8888", "EMAIL")).toMatchObject({ ok: false, erro: "PONTO_INVALIDO" });
  });

  it("remove só ponto do próprio contato", async () => {
    const a = await criarContato({ nome: "Ana", pontos: ["ana@acme.com"] });
    const b = await criarContato({ nome: "Bruno" });
    if (!a.ok || !b.ok) throw new Error("setup");
    const p = await db.contatoPonto.findFirstOrThrow();
    expect(await removerPonto(b.id, p.id)).toMatchObject({ ok: false, erro: "PONTO_NAO_ENCONTRADO" });
    expect(await removerPonto(a.id, p.id)).toEqual({ ok: true });
    expect(await db.contatoPonto.count()).toBe(0);
  });
});

describe("editar", () => {
  it("edita campos e define/limpa a empresa", async () => {
    const e = await criarEmpresa({ nome: "Acme" });
    const a = await criarContato({ nome: "Ana" });
    if (!a.ok || !e.ok) throw new Error("setup");
    expect(await editarContato(a.id, "cargo", "CEO")).toEqual({ ok: true });
    expect(await definirEmpresaDoContato(a.id, e.id)).toEqual({ ok: true });
    expect((await db.contato.findUniqueOrThrow({ where: { id: a.id } })).empresaId).toBe(e.id);
    expect(await definirEmpresaDoContato(a.id, null)).toEqual({ ok: true });
    expect((await db.contato.findUniqueOrThrow({ where: { id: a.id } })).empresaId).toBeNull();
    expect(await editarContato(a.id, "nome", " ")).toMatchObject({ ok: false, erro: "CAMPO_INVALIDO" });
  });
});

describe("leitura", () => {
  async function semearCards() {
    const p = await db.pipeline.create({ data: { chave: "vendas", nome: "Vendas", fases: { create: [{ chave: "a", nome: "A", ordem: 0 }] } }, include: { fases: true } });
    const u = await db.usuario.create({ data: { nome: "Vend", email: "v@ij.test" } });
    return { pipelineId: p.id, faseId: p.fases[0].id, responsavelId: u.id, criadoVia: "UI" as const };
  }

  it("detalhe lista oportunidades vinculadas, nunca as soft-deletadas", async () => {
    const base = await semearCards();
    const a = await criarContato({ nome: "Ana" });
    if (!a.ok) throw new Error("setup");
    await db.oportunidade.create({ data: { ...base, titulo: "Viva", contatoId: a.id } });
    await db.oportunidade.create({ data: { ...base, titulo: "Apagada", contatoId: a.id, deletadoEm: new Date() } });
    const c = await obterContato(a.id);
    expect(c?.oportunidades.map((o) => o.titulo)).toEqual(["Viva"]);
    const lista = await listarContatos();
    expect(lista[0]._count.oportunidades).toBe(1);
  });

  it("lista busca por nome (ILIKE) ou por telefone/email exatos", async () => {
    await criarContato({ nome: "Gustavo Saab", pontos: ["11 99999-8888"] });
    await criarContato({ nome: "Ana Gusmão", pontos: ["ana@acme.com"] });
    await criarContato({ nome: "Bruno" });
    expect((await listarContatos("gus")).map((c) => c.nome).sort()).toEqual(["Ana Gusmão", "Gustavo Saab"]);
    expect((await listarContatos("(11) 9999-8888")).map((c) => c.nome)).toEqual(["Gustavo Saab"]);
    expect((await listarContatos("ANA@ACME.COM")).map((c) => c.nome)).toEqual(["Ana Gusmão"]);
  });

  it("autocomplete: prefixo primeiro, sem deletados/mesclados", async () => {
    await criarContato({ nome: "Ana Gusmão" });
    await criarContato({ nome: "Gustavo Saab" });
    const d = await criarContato({ nome: "Gustavo Morto" });
    if (!d.ok) throw new Error("setup");
    await db.contato.update({ where: { id: d.id }, data: { deletadoEm: new Date() } });
    expect((await buscarContatosPorNome("gus")).map((c) => c.nome)).toEqual(["Gustavo Saab", "Ana Gusmão"]);
    expect(await buscarContatosPorNome(" ")).toEqual([]);
  });
});

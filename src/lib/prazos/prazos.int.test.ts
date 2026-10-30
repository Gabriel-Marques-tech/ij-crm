import { beforeEach, describe, expect, it } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { criarPrazo, editarPrazo, excluirPrazo, listarPrazosDoCard, marcarPrazoFeito } from "./prazos";

const db = dbTeste();

async function semear() {
  const vendas = await db.pipeline.create({
    data: { chave: "vendas", nome: "Vendas", ordem: 0, fases: { create: [{ chave: "primeiro_contato", nome: "Primeiro Contato", ordem: 0 }] } },
    include: { fases: true },
  });
  const ana = await db.usuario.create({ data: { nome: "Ana Vendas", email: "ana@ij.test" } });
  const bruno = await db.usuario.create({ data: { nome: "Bruno Lima", email: "bruno@ij.test" } });
  const gil = await db.usuario.create({ data: { nome: "Gil Gestora", email: "gil@ij.test", papel: "GESTOR" } });
  const ivo = await db.usuario.create({ data: { nome: "Ivo Inativo", email: "ivo@ij.test", ativo: false } });
  const card = await db.projeto.create({
    data: { titulo: "Padaria", pipelineId: vendas.id, faseId: vendas.fases[0].id, responsavelId: ana.id, criadoVia: "UI" },
  });
  const anaA = { id: ana.id, papel: "VENDEDOR" as const };
  const brunoA = { id: bruno.id, papel: "VENDEDOR" as const };
  const gilA = { id: gil.id, papel: "GESTOR" as const };
  return { ana, bruno, gil, ivo, card, anaA, brunoA, gilA };
}

beforeEach(async () => {
  await limparBanco(["prazo", "transicao_fase", "timeline", "oportunidade", "fase", "pipeline", "usuario"]);
  invalidarCachePipelines();
});

describe("permissões (servidor)", () => {
  it("vendedor cria só para si; não edita, conclui nem exclui o de outro", async () => {
    const s = await semear();
    expect(await criarPrazo(s.anaA, { titulo: "x", dia: "2026-10-30", responsavelId: s.bruno.id })).toMatchObject({ ok: false, erro: "SEM_PERMISSAO" });

    const r = await criarPrazo(s.brunoA, { titulo: "do Bruno", dia: "2026-10-30", responsavelId: s.bruno.id });
    if (!r.ok) throw new Error(r.erro);
    expect(await editarPrazo(s.anaA, r.id, { titulo: "mexi", dia: "2026-10-31", responsavelId: s.bruno.id })).toMatchObject({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await marcarPrazoFeito(s.anaA, r.id, true)).toMatchObject({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await excluirPrazo(s.anaA, r.id)).toMatchObject({ ok: false, erro: "SEM_PERMISSAO" });
    const intacto = await db.prazo.findUniqueOrThrow({ where: { id: r.id } });
    expect(intacto).toMatchObject({ titulo: "do Bruno", feitoEm: null, deletadoEm: null });
  });

  it("vendedor não passa o próprio prazo para outra pessoa", async () => {
    const s = await semear();
    const r = await criarPrazo(s.anaA, { titulo: "meu", dia: "2026-10-30", responsavelId: s.ana.id });
    if (!r.ok) throw new Error(r.erro);
    expect(await editarPrazo(s.anaA, r.id, { titulo: "meu", dia: "2026-10-30", responsavelId: s.bruno.id })).toMatchObject({ ok: false, erro: "SEM_PERMISSAO" });
  });

  it("gestor cria, edita, conclui e exclui o de qualquer um", async () => {
    const s = await semear();
    const r = await criarPrazo(s.gilA, { titulo: "da Ana", dia: "2026-10-30", responsavelId: s.ana.id });
    if (!r.ok) throw new Error(r.erro);
    expect(await editarPrazo(s.gilA, r.id, { titulo: "do Bruno agora", dia: "2026-11-02", responsavelId: s.bruno.id })).toEqual({ ok: true });
    expect(await marcarPrazoFeito(s.gilA, r.id, true)).toEqual({ ok: true });
    const p = await db.prazo.findUniqueOrThrow({ where: { id: r.id } });
    expect(p).toMatchObject({ titulo: "do Bruno agora", responsavelId: s.bruno.id, feitoPorId: s.gil.id, criadoPorId: s.gil.id });
    expect(p.data.toISOString().slice(0, 10)).toBe("2026-11-02");
    expect(p.feitoEm).not.toBeNull();
    expect(await excluirPrazo(s.gilA, r.id)).toEqual({ ok: true });
  });

  it("responsável inativo ou inexistente é recusado; dados inválidos também", async () => {
    const s = await semear();
    expect(await criarPrazo(s.gilA, { titulo: "x", dia: "2026-10-30", responsavelId: s.ivo.id })).toMatchObject({ ok: false, erro: "RESPONSAVEL_INVALIDO" });
    expect(await criarPrazo(s.gilA, { titulo: "x", dia: "2026-10-30", responsavelId: "nao-existe" })).toMatchObject({ ok: false, erro: "RESPONSAVEL_INVALIDO" });
    expect(await criarPrazo(s.gilA, { titulo: " ", dia: "2026-10-30", responsavelId: s.ana.id })).toMatchObject({ ok: false, erro: "INVALIDO" });
    expect(await criarPrazo(s.gilA, { titulo: "x", dia: "30/10", responsavelId: s.ana.id })).toMatchObject({ ok: false, erro: "INVALIDO" });
  });
});

describe("ciclo do prazo no card + Timeline", () => {
  it("criar e concluir num card gravam PRAZO na Timeline; reabrir e concluir de novo não duplicam o 'criado'", async () => {
    const s = await semear();
    const r = await criarPrazo(s.anaA, { titulo: "Enviar proposta", dia: "2026-10-30", responsavelId: s.ana.id, projetoId: s.card.id });
    if (!r.ok) throw new Error(r.erro);
    expect(await marcarPrazoFeito(s.anaA, r.id, true)).toEqual({ ok: true });
    // Concluir de novo (outra aba) não grava outra entrada.
    expect(await marcarPrazoFeito(s.anaA, r.id, true)).toEqual({ ok: true });
    expect(await marcarPrazoFeito(s.anaA, r.id, false)).toEqual({ ok: true });
    expect((await db.prazo.findUniqueOrThrow({ where: { id: r.id } })).feitoEm).toBeNull();

    const tl = await db.timeline.findMany({ where: { projetoId: s.card.id, tipo: "PRAZO" }, orderBy: { em: "asc" } });
    expect(tl.map((t) => (t.payload as { evento: string }).evento)).toEqual(["criado", "concluido"]);
    expect(tl[0]).toMatchObject({ usuarioId: s.ana.id, payload: { prazoId: r.id, titulo: "Enviar proposta", dia: "2026-10-30" } });
  });

  it("prazo avulso (sem card) não toca Timeline", async () => {
    const s = await semear();
    const r = await criarPrazo(s.anaA, { titulo: "Relatório", dia: "2026-10-30", responsavelId: s.ana.id });
    if (!r.ok) throw new Error(r.erro);
    await marcarPrazoFeito(s.anaA, r.id, true);
    expect(await db.timeline.count()).toBe(0);
  });

  it("card excluído (lixeira) ou inexistente: não cria; prazos dele somem da lista e não são editáveis", async () => {
    const s = await semear();
    const r = await criarPrazo(s.anaA, { titulo: "antes", dia: "2026-10-30", responsavelId: s.ana.id, projetoId: s.card.id });
    if (!r.ok) throw new Error(r.erro);
    expect(await criarPrazo(s.anaA, { titulo: "x", dia: "2026-10-30", responsavelId: s.ana.id, projetoId: "nao-existe" })).toMatchObject({ ok: false, erro: "CARD_NAO_ENCONTRADO" });

    await db.projeto.update({ where: { id: s.card.id }, data: { deletadoEm: new Date() } });
    expect(await criarPrazo(s.anaA, { titulo: "x", dia: "2026-10-30", responsavelId: s.ana.id, projetoId: s.card.id })).toMatchObject({ ok: false, erro: "CARD_NAO_ENCONTRADO" });
    expect(await marcarPrazoFeito(s.anaA, r.id, true)).toMatchObject({ ok: false, erro: "PRAZO_NAO_ENCONTRADO" });
  });

  it("excluir é soft-delete: some da lista do card, linha continua", async () => {
    const s = await semear();
    const a = await criarPrazo(s.anaA, { titulo: "A", dia: "2026-10-30", responsavelId: s.ana.id, projetoId: s.card.id });
    const b = await criarPrazo(s.gilA, { titulo: "B", dia: "2026-10-29", responsavelId: s.bruno.id, projetoId: s.card.id });
    if (!a.ok || !b.ok) throw new Error("setup");
    expect(await excluirPrazo(s.anaA, a.id)).toEqual({ ok: true });
    expect(await excluirPrazo(s.anaA, a.id)).toMatchObject({ ok: false, erro: "PRAZO_NAO_ENCONTRADO" });
    expect((await db.prazo.findUniqueOrThrow({ where: { id: a.id } })).deletadoEm).not.toBeNull();

    const lista = await listarPrazosDoCard(s.card.id, s.anaA, "2026-10-30");
    expect(lista.map((p) => [p.titulo, p.estado, p.podeMexer])).toEqual([["B", "vencido", false]]);
    expect(lista[0].responsavel.nome).toBe("Bruno Lima");
  });
});

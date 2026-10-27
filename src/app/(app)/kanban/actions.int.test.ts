// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { invalidarCachePipelines } from "@/lib/fases/cache";

const { exigirUsuario } = vi.hoisted(() => ({ exigirUsuario: vi.fn() }));
vi.mock("@/lib/auth/atual", () => ({ exigirUsuario }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { criarCardAction, editarCampoAction } from "./actions";

const db = dbTeste();

async function semear() {
  const p = await db.pipeline.create({
    data: { chave: "vendas", nome: "Vendas", fases: { create: [{ chave: "primeiro_contato", nome: "Primeiro Contato", ordem: 0 }] } },
    include: { fases: true },
  });
  const u = await db.usuario.create({ data: { nome: "Ana Vendas", email: "ana@ij.test" } });
  exigirUsuario.mockResolvedValue({ id: u.id, papel: "VENDEDOR" });
  return { p, fase: p.fases[0], u };
}

beforeEach(async () => {
  await limparBanco(["transicao_fase", "timeline", "oportunidade", "fase", "pipeline", "sessao", "usuario"]);
  invalidarCachePipelines();
  exigirUsuario.mockReset();
});

describe("descrição do card (actions)", () => {
  it("editar descrição grava o texto (com quebras de linha) e uma Timeline CAMPO_ALTERADO", async () => {
    const { p, fase, u } = await semear();
    const c = await db.oportunidade.create({ data: { titulo: "Padaria", pipelineId: p.id, faseId: fase.id, responsavelId: u.id, criadoVia: "UI" } });

    expect(await editarCampoAction(c.id, "descricao", "  Site novo\n\nCom loja  ")).toEqual({ ok: true });
    expect((await db.oportunidade.findUniqueOrThrow({ where: { id: c.id } })).descricao).toBe("Site novo\n\nCom loja");

    const tl = await db.timeline.findMany({ where: { oportunidadeId: c.id, tipo: "CAMPO_ALTERADO" } });
    expect(tl).toHaveLength(1);
    expect(tl[0].payload).toEqual({ campo: "descricao", antes: null, depois: "Site novo\n\nCom loja" });
    expect(tl[0].usuarioId).toBe(u.id);

    // Limpar também vira Timeline; mesmo valor não gera nada.
    expect(await editarCampoAction(c.id, "descricao", "")).toEqual({ ok: true });
    expect(await editarCampoAction(c.id, "descricao", "")).toEqual({ ok: true });
    const todas = await db.timeline.findMany({ where: { oportunidadeId: c.id, tipo: "CAMPO_ALTERADO" }, orderBy: { em: "asc" } });
    expect(todas.map((t) => t.payload)).toEqual([
      { campo: "descricao", antes: null, depois: "Site novo\n\nCom loja" },
      { campo: "descricao", antes: "Site novo\n\nCom loja", depois: null },
    ]);
  });

  it("descrição acima de 5000 caracteres é recusada com mensagem em português", async () => {
    const { p, fase, u } = await semear();
    const c = await db.oportunidade.create({ data: { titulo: "Padaria", pipelineId: p.id, faseId: fase.id, responsavelId: u.id, criadoVia: "UI" } });
    expect(await editarCampoAction(c.id, "descricao", "x".repeat(5001))).toEqual({ erro: "Descrição: no máximo 5000 caracteres." });
    expect((await db.oportunidade.findUniqueOrThrow({ where: { id: c.id } })).descricao).toBeNull();
  });

  it("novo card pelo + aceita descrição opcional", async () => {
    const { p, fase } = await semear();
    const com = await criarCardAction(p.id, fase.id, "Com descrição", "linha 1\nlinha 2");
    expect(com).toMatchObject({ ok: true });
    const sem = await criarCardAction(p.id, fase.id, "Sem descrição");
    expect(sem).toMatchObject({ ok: true });
    const porTitulo = Object.fromEntries((await db.oportunidade.findMany()).map((o) => [o.titulo, o.descricao]));
    expect(porTitulo).toEqual({ "Com descrição": "linha 1\nlinha 2", "Sem descrição": null });

    expect(await criarCardAction(p.id, fase.id, "Longa", "x".repeat(5001))).toEqual({ erro: "Descrição: no máximo 5000 caracteres." });
    expect(await db.oportunidade.count()).toBe(2);
  });
});

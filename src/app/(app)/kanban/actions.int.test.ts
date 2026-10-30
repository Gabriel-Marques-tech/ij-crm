// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { invalidarCachePipelines } from "@/lib/fases/cache";

const { exigirUsuario } = vi.hoisted(() => ({ exigirUsuario: vi.fn() }));
vi.mock("@/lib/auth/atual", async () => {
  const { podeEscrever } = await import("@/lib/auth/papeis");
  return {
    exigirUsuario,
    // Mesma regra do real (`exigirPapel("VENDEDOR")`): VISUALIZADOR → redirect /403.
    exigirEscrita: async () => {
      const u = await exigirUsuario();
      if (!podeEscrever(u.papel)) throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/403;307;" });
      return u;
    },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { adicionarNota, criarCard, editarCard, listarQuadro, listarResponsaveis, moverCard, obterCard } from "@/lib/projetos/projetos";
import { adicionarNotaAction, criarCardAction, editarCampoAction, moverCardAction } from "./actions";

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
    const c = await db.projeto.create({ data: { titulo: "Padaria", pipelineId: p.id, faseId: fase.id, responsavelId: u.id, criadoVia: "UI" } });

    expect(await editarCampoAction(c.id, "descricao", "  Site novo\n\nCom loja  ")).toEqual({ ok: true });
    expect((await db.projeto.findUniqueOrThrow({ where: { id: c.id } })).descricao).toBe("Site novo\n\nCom loja");

    const tl = await db.timeline.findMany({ where: { projetoId: c.id, tipo: "CAMPO_ALTERADO" } });
    expect(tl).toHaveLength(1);
    expect(tl[0].payload).toEqual({ campo: "descricao", antes: null, depois: "Site novo\n\nCom loja" });
    expect(tl[0].usuarioId).toBe(u.id);

    // Limpar também vira Timeline; mesmo valor não gera nada.
    expect(await editarCampoAction(c.id, "descricao", "")).toEqual({ ok: true });
    expect(await editarCampoAction(c.id, "descricao", "")).toEqual({ ok: true });
    const todas = await db.timeline.findMany({ where: { projetoId: c.id, tipo: "CAMPO_ALTERADO" }, orderBy: { em: "asc" } });
    expect(todas.map((t) => t.payload)).toEqual([
      { campo: "descricao", antes: null, depois: "Site novo\n\nCom loja" },
      { campo: "descricao", antes: "Site novo\n\nCom loja", depois: null },
    ]);
  });

  it("descrição longa: a Timeline guarda só uma prévia (300, sem partir emoji) marcada como truncada", async () => {
    const { p, fase, u } = await semear();
    const c = await db.projeto.create({ data: { titulo: "Padaria", pipelineId: p.id, faseId: fase.id, responsavelId: u.id, criadoVia: "UI" } });
    const longa = `${"a".repeat(299)}😀${"b".repeat(4000)}`;
    expect(await editarCampoAction(c.id, "descricao", longa)).toEqual({ ok: true });
    expect((await db.projeto.findUniqueOrThrow({ where: { id: c.id } })).descricao).toBe(longa);
    const [tl] = await db.timeline.findMany({ where: { projetoId: c.id, tipo: "CAMPO_ALTERADO" } });
    expect(tl.payload).toEqual({ campo: "descricao", antes: null, depois: "a".repeat(299), truncado: true });

    await editarCampoAction(c.id, "descricao", "curta");
    const ultima = await db.timeline.findFirstOrThrow({ where: { projetoId: c.id, tipo: "CAMPO_ALTERADO" }, orderBy: { em: "desc" } });
    expect(ultima.payload).toEqual({ campo: "descricao", antes: "a".repeat(299), depois: "curta", truncado: true });
  });

  it("quadro recebe só a prévia (300 caracteres) e a marca de truncada; o detalhe tem o texto inteiro", async () => {
    const { p, fase, u } = await semear();
    const longa = "z".repeat(5000);
    const c = await db.projeto.create({ data: { titulo: "Longa", descricao: longa, pipelineId: p.id, faseId: fase.id, responsavelId: u.id, criadoVia: "UI" } });
    await db.projeto.create({ data: { titulo: "Curta", descricao: "oi", pipelineId: p.id, faseId: fase.id, responsavelId: u.id, criadoVia: "UI" } });
    await db.projeto.create({ data: { titulo: "Sem", pipelineId: p.id, faseId: fase.id, responsavelId: u.id, criadoVia: "UI" } });
    const q = await listarQuadro("vendas");
    const por = Object.fromEntries(q!.cards.map((k) => [k.titulo, [k.descricaoPrevia, k.descricaoTruncada]]));
    expect(por).toEqual({ Longa: ["z".repeat(300), true], Curta: ["oi", false], Sem: [null, false] });
    expect(JSON.stringify(q)).not.toContain(longa);
    expect((await obterCard(c.id))?.descricao).toBe(longa);
  });

  it("descrição acima de 5000 caracteres é recusada com mensagem em português", async () => {
    const { p, fase, u } = await semear();
    const c = await db.projeto.create({ data: { titulo: "Padaria", pipelineId: p.id, faseId: fase.id, responsavelId: u.id, criadoVia: "UI" } });
    expect(await editarCampoAction(c.id, "descricao", "x".repeat(5001))).toEqual({ erro: "Descrição: no máximo 5000 caracteres." });
    expect((await db.projeto.findUniqueOrThrow({ where: { id: c.id } })).descricao).toBeNull();
  });

  it("novo card pelo + aceita descrição opcional", async () => {
    const { p, fase } = await semear();
    const com = await criarCardAction(p.id, fase.id, "Com descrição", "linha 1\nlinha 2");
    expect(com).toMatchObject({ ok: true });
    const sem = await criarCardAction(p.id, fase.id, "Sem descrição");
    expect(sem).toMatchObject({ ok: true });
    const porTitulo = Object.fromEntries((await db.projeto.findMany()).map((o) => [o.titulo, o.descricao]));
    expect(porTitulo).toEqual({ "Com descrição": "linha 1\nlinha 2", "Sem descrição": null });

    expect(await criarCardAction(p.id, fase.id, "Longa", "x".repeat(5001))).toEqual({ erro: "Descrição: no máximo 5000 caracteres." });
    expect(await db.projeto.count()).toBe(2);
  });
});

describe("papel VISUALIZADOR (somente leitura)", () => {
  async function comVisualizador() {
    const base = await semear();
    const vera = await db.usuario.create({ data: { nome: "Vera Visualizadora", email: "vera@ij.test", papel: "VISUALIZADOR" } });
    const c = await db.projeto.create({ data: { titulo: "Padaria", pipelineId: base.p.id, faseId: base.fase.id, responsavelId: base.u.id, criadoVia: "UI" } });
    return { ...base, vera, c };
  }

  it("actions: criar, editar, mover e comentar → /403, nada gravado", async () => {
    const { p, fase, vera, c } = await comVisualizador();
    const outra = await db.fase.create({ data: { pipelineId: p.id, chave: "proposta", nome: "Proposta", ordem: 1 } });
    exigirUsuario.mockResolvedValue({ id: vera.id, papel: "VISUALIZADOR" });
    const proibido = { digest: "NEXT_REDIRECT;replace;/403;307;" };
    await expect(criarCardAction(p.id, fase.id, "Do visualizador")).rejects.toMatchObject(proibido);
    await expect(editarCampoAction(c.id, "titulo", "Mudou")).rejects.toMatchObject(proibido);
    await expect(moverCardAction(c.id, outra.id)).rejects.toMatchObject(proibido);
    await expect(adicionarNotaAction(c.id, "oi")).rejects.toMatchObject(proibido);

    expect(await db.projeto.count()).toBe(1);
    const card = await db.projeto.findUniqueOrThrow({ where: { id: c.id } });
    expect([card.titulo, card.faseId]).toEqual(["Padaria", fase.id]);
    expect(await db.timeline.count()).toBe(0);
  });

  it("serviço também recusa (SEM_PERMISSAO) quando o ator traz papel VISUALIZADOR", async () => {
    const { p, fase, vera, c } = await comVisualizador();
    const ator = { id: vera.id, papel: "VISUALIZADOR" as const };
    expect(await criarCard({ pipelineId: p.id, faseId: fase.id, titulo: "x" }, ator)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await editarCard(c.id, { titulo: "x" }, ator)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await moverCard(c.id, fase.id, ator)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await adicionarNota(c.id, "oi", ator)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await db.timeline.count()).toBe(0);
  });

  it("não aparece entre os responsáveis e não pode virar responsável de card", async () => {
    const { u, vera, c } = await comVisualizador();
    expect((await listarResponsaveis()).map((r) => r.id)).toEqual([u.id]);
    expect(await editarCampoAction(c.id, "responsavelId", vera.id)).toEqual({ erro: "Responsável inválido ou inativo." });
    expect((await db.projeto.findUniqueOrThrow({ where: { id: c.id } })).responsavelId).toBe(u.id);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { PIPELINES, semear } from "../../../prisma/seed";

const db = dbTeste();

beforeEach(async () => {
  await limparBanco(["transicao_fase", "timeline", "oportunidade", "fase", "pipeline"]);
});

describe("seed", () => {
  it("primeira instalação cria pipelines e fases na ordem do Pipefy", async () => {
    await semear(db, { log: () => {} });
    const vendas = await db.pipeline.findUniqueOrThrow({ where: { chave: "vendas" }, include: { fases: { orderBy: { ordem: "asc" } } } });
    expect(vendas.fases.map((f) => f.chave)).toEqual(PIPELINES[0].fases.map((f) => f.chave));
    expect(vendas.fases.map((f) => f.ordem)).toEqual(PIPELINES[0].fases.map((_, i) => i));
    expect(await db.fase.count()).toBe(PIPELINES.reduce((n, p) => n + p.fases.length, 0));
  });

  it("re-seed não ressuscita fase excluída nem desfaz edições do gestor", async () => {
    await semear(db, { log: () => {} });
    const vendas = await db.pipeline.findUniqueOrThrow({ where: { chave: "vendas" } });
    await db.fase.delete({ where: { pipelineId_chave: { pipelineId: vendas.id, chave: "reuniao_intermediaria" } } });
    await db.fase.update({
      where: { pipelineId_chave: { pipelineId: vendas.id, chave: "primeiro_contato" } },
      data: { nome: "Prospecção", ordem: 99, arquivadaEm: new Date() },
    });

    await semear(db, { log: () => {} });

    expect(await db.fase.findUnique({ where: { pipelineId_chave: { pipelineId: vendas.id, chave: "reuniao_intermediaria" } } })).toBeNull();
    const pc = await db.fase.findUniqueOrThrow({ where: { pipelineId_chave: { pipelineId: vendas.id, chave: "primeiro_contato" } } });
    expect(pc).toMatchObject({ nome: "Prospecção", ordem: 99 });
    expect(pc.arquivadaEm).not.toBeNull();
    expect(await db.pipeline.count()).toBe(PIPELINES.length);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { adicionarNota, criarCard, editarCard, listarQuadro, moverCard, obterCard } from "./oportunidades";

const db = dbTeste();

async function semear() {
  const vendas = await db.pipeline.create({
    data: {
      chave: "vendas",
      nome: "Vendas",
      ordem: 0,
      fases: {
        create: [
          { chave: "primeiro_contato", nome: "Primeiro Contato", ordem: 0, limiteDiasAlerta: 7 },
          { chave: "em_negociacao", nome: "Em negociação", ordem: 1 },
          { chave: "contrato_assinado", nome: "Contrato assinado", ordem: 2, isTerminal: true, tipoTerminal: "GANHO" },
          { chave: "perdido", nome: "Perdido", ordem: 3, isTerminal: true, tipoTerminal: "PERDIDO" },
        ],
      },
    },
    include: { fases: { orderBy: { ordem: "asc" } } },
  });
  const projetos = await db.pipeline.create({
    data: {
      chave: "projetos",
      nome: "Projetos",
      ordem: 1,
      fases: { create: [{ chave: "em_execucao", nome: "Em execução", ordem: 0 }, { chave: "finalizado", nome: "Finalizado", ordem: 1, isTerminal: true, tipoTerminal: "GANHO" }] },
    },
    include: { fases: { orderBy: { ordem: "asc" } } },
  });
  const vendedora = await db.usuario.create({ data: { nome: "Ana Vendas", email: "ana@ij.test" } });
  const outro = await db.usuario.create({ data: { nome: "Bruno Lima", email: "bruno@ij.test" } });
  return { vendas, projetos, vendedora, outro };
}

const fase = (p: { fases: { chave: string; id: string }[] }, chave: string) => p.fases.find((f) => f.chave === chave)!;

beforeEach(async () => {
  await limparBanco(["transicao_fase", "timeline", "oportunidade", "fase", "pipeline", "sessao", "usuario"]);
  invalidarCachePipelines();
});

describe("criarCard", () => {
  it("cria em qualquer coluna só com título: UI, responsável = quem criou, fase_desde = agora, CRIACAO + entrada", async () => {
    const { vendas, vendedora } = await semear();
    const antes = Date.now();
    const r = await criarCard({ pipelineId: vendas.id, faseId: fase(vendas, "em_negociacao").id, titulo: "  Padaria   do Zé " }, vendedora);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const op = await db.oportunidade.findUniqueOrThrow({ where: { id: r.id } });
    expect(op.titulo).toBe("Padaria do Zé");
    expect(op.criadoVia).toBe("UI");
    expect(op.responsavelId).toBe(vendedora.id);
    expect(op.faseId).toBe(fase(vendas, "em_negociacao").id);
    expect(op.faseDesde.getTime()).toBeGreaterThanOrEqual(antes - 1000);

    const trans = await db.transicaoFase.findMany({ where: { oportunidadeId: op.id } });
    expect(trans).toMatchObject([{ deFaseId: null, paraFaseId: op.faseId, origem: "UI", usuarioId: vendedora.id }]);
    const tl = await db.timeline.findMany({ where: { oportunidadeId: op.id } });
    expect(tl).toMatchObject([{ tipo: "CRIACAO", usuarioId: vendedora.id, payload: { faseId: op.faseId, via: "UI" } }]);
  });

  it("aceita coluna terminal também (card em qualquer fase)", async () => {
    const { vendas, vendedora } = await semear();
    const r = await criarCard({ pipelineId: vendas.id, faseId: fase(vendas, "perdido").id, titulo: "Já perdido" }, vendedora);
    expect(r.ok).toBe(true);
  });

  it("recusa título vazio, fase de outro quadro e fase arquivada", async () => {
    const { vendas, projetos, vendedora } = await semear();
    expect(await criarCard({ pipelineId: vendas.id, faseId: fase(vendas, "em_negociacao").id, titulo: "  " }, vendedora)).toEqual({ ok: false, erro: "TITULO_INVALIDO" });
    expect(await criarCard({ pipelineId: vendas.id, faseId: fase(projetos, "em_execucao").id, titulo: "X" }, vendedora)).toEqual({ ok: false, erro: "FASE_DE_OUTRO_PIPELINE" });
    await db.fase.update({ where: { id: fase(vendas, "em_negociacao").id }, data: { arquivadaEm: new Date() } });
    expect(await criarCard({ pipelineId: vendas.id, faseId: fase(vendas, "em_negociacao").id, titulo: "X" }, vendedora)).toEqual({ ok: false, erro: "FASE_ARQUIVADA" });
    expect(await db.oportunidade.count()).toBe(0);
  });
});

describe("moverCard", () => {
  it("grava TransicaoFase (de, para, quem, UI) + Timeline MOVIMENTACAO e atualiza fase_desde", async () => {
    const { vendas, vendedora, outro } = await semear();
    const c = await criarCard({ pipelineId: vendas.id, faseId: fase(vendas, "em_negociacao").id, titulo: "Acme" }, vendedora);
    if (!c.ok) throw new Error(c.erro);
    const velho = new Date("2026-01-01T00:00:00Z");
    await db.oportunidade.update({ where: { id: c.id }, data: { faseDesde: velho } });

    // qualquer direção: para trás
    const r = await moverCard(c.id, fase(vendas, "primeiro_contato").id, outro);
    expect(r).toEqual({ ok: true, mudou: true, terminal: null });

    const op = await db.oportunidade.findUniqueOrThrow({ where: { id: c.id } });
    expect(op.faseId).toBe(fase(vendas, "primeiro_contato").id);
    expect(op.faseDesde.getTime()).toBeGreaterThan(velho.getTime());

    const t = await db.transicaoFase.findFirstOrThrow({ where: { oportunidadeId: c.id, deFaseId: { not: null } } });
    expect(t).toMatchObject({ deFaseId: fase(vendas, "em_negociacao").id, paraFaseId: fase(vendas, "primeiro_contato").id, usuarioId: outro.id, origem: "UI" });
    expect(t.em.getTime()).toBe(op.faseDesde.getTime());

    const tl = await db.timeline.findFirstOrThrow({ where: { oportunidadeId: c.id, tipo: "MOVIMENTACAO" } });
    expect(tl).toMatchObject({ usuarioId: outro.id, payload: { deFaseId: fase(vendas, "em_negociacao").id, paraFaseId: fase(vendas, "primeiro_contato").id } });
  });

  it("mesma fase → no-op sem histórico", async () => {
    const { vendas, vendedora } = await semear();
    const c = await criarCard({ pipelineId: vendas.id, faseId: fase(vendas, "em_negociacao").id, titulo: "Acme" }, vendedora);
    if (!c.ok) throw new Error(c.erro);
    expect(await moverCard(c.id, fase(vendas, "em_negociacao").id, vendedora)).toEqual({ ok: true, mudou: false, terminal: null });
    expect(await db.transicaoFase.count()).toBe(1);
    expect(await db.timeline.count({ where: { tipo: "MOVIMENTACAO" } })).toBe(0);
  });

  it("para terminal: move e informa o tipo (gancho do GAB-32)", async () => {
    const { vendas, vendedora } = await semear();
    const c = await criarCard({ pipelineId: vendas.id, faseId: fase(vendas, "em_negociacao").id, titulo: "Acme" }, vendedora);
    if (!c.ok) throw new Error(c.erro);
    expect(await moverCard(c.id, fase(vendas, "contrato_assinado").id, vendedora)).toEqual({ ok: true, mudou: true, terminal: "GANHO" });
  });

  it("recusa destino de outro pipeline, arquivado ou inexistente, e card soft-deletado", async () => {
    const { vendas, projetos, vendedora } = await semear();
    const c = await criarCard({ pipelineId: vendas.id, faseId: fase(vendas, "em_negociacao").id, titulo: "Acme" }, vendedora);
    if (!c.ok) throw new Error(c.erro);
    expect(await moverCard(c.id, fase(projetos, "em_execucao").id, vendedora)).toEqual({ ok: false, erro: "FASE_DE_OUTRO_PIPELINE" });
    await db.fase.update({ where: { id: fase(vendas, "primeiro_contato").id }, data: { arquivadaEm: new Date() } });
    expect(await moverCard(c.id, fase(vendas, "primeiro_contato").id, vendedora)).toEqual({ ok: false, erro: "FASE_ARQUIVADA" });
    expect(await moverCard(c.id, "nao-existe", vendedora)).toEqual({ ok: false, erro: "FASE_NAO_ENCONTRADA" });

    await db.oportunidade.update({ where: { id: c.id }, data: { deletadoEm: new Date() } });
    expect(await moverCard(c.id, fase(vendas, "perdido").id, vendedora)).toEqual({ ok: false, erro: "CARD_NAO_ENCONTRADO" });

    const op = await db.oportunidade.findUniqueOrThrow({ where: { id: c.id } });
    expect(op.faseId).toBe(fase(vendas, "em_negociacao").id);
    expect(await db.transicaoFase.count()).toBe(1); // só a de criação
  });

  it("movimentos concorrentes do mesmo card serializam: um histórico por movimento real", async () => {
    const { vendas, vendedora } = await semear();
    const c = await criarCard({ pipelineId: vendas.id, faseId: fase(vendas, "primeiro_contato").id, titulo: "Acme" }, vendedora);
    if (!c.ok) throw new Error(c.erro);
    const destino = fase(vendas, "em_negociacao").id;
    const rs = await Promise.all([moverCard(c.id, destino, vendedora), moverCard(c.id, destino, vendedora), moverCard(c.id, destino, vendedora)]);
    expect(rs.filter((r) => r.ok && r.mudou)).toHaveLength(1);
    expect(await db.transicaoFase.count({ where: { deFaseId: { not: null } } })).toBe(1);
  });
});

describe("editarCard", () => {
  it("cada campo alterado vira CAMPO_ALTERADO com antes/depois; igual não gera nada", async () => {
    const { vendas, vendedora, outro } = await semear();
    const c = await criarCard({ pipelineId: vendas.id, faseId: fase(vendas, "em_negociacao").id, titulo: "Acme" }, vendedora);
    if (!c.ok) throw new Error(c.erro);

    const r1 = await editarCard(c.id, { dor: "Site lento", orcamentoPrevisto: "12500.00", origem: "RD" }, vendedora);
    expect(r1).toEqual({ ok: true, alterados: ["dor", "orcamentoPrevisto", "origem"] });

    const r2 = await editarCard(
      c.id,
      { dor: "Site lento", orcamentoPrevisto: "13000.00", responsavelId: outro.id, revisar: true, proximaAcaoEm: new Date("2026-11-03T03:00:00Z") },
      vendedora,
    );
    expect(r2).toEqual({ ok: true, alterados: ["orcamentoPrevisto", "responsavelId", "revisar", "proximaAcaoEm"] });

    const op = await db.oportunidade.findUniqueOrThrow({ where: { id: c.id } });
    expect(op.orcamentoPrevisto?.toFixed(2)).toBe("13000.00");
    expect(op.responsavelId).toBe(outro.id);
    expect(op.revisar).toBe(true);

    const tl = await db.timeline.findMany({ where: { oportunidadeId: c.id, tipo: "CAMPO_ALTERADO" }, orderBy: { em: "asc" } });
    const payloads = tl.map((t) => t.payload);
    expect(payloads).toEqual([
      { campo: "dor", antes: null, depois: "Site lento" },
      { campo: "orcamentoPrevisto", antes: null, depois: "12500.00" },
      { campo: "origem", antes: null, depois: "RD" },
      { campo: "orcamentoPrevisto", antes: "12500.00", depois: "13000.00" },
      { campo: "responsavelId", antes: vendedora.id, depois: outro.id },
      { campo: "revisar", antes: false, depois: true },
      { campo: "proximaAcaoEm", antes: null, depois: "2026-11-03" },
    ]);
    expect(tl.every((t) => t.usuarioId === vendedora.id)).toBe(true);
  });

  it("recusa responsável inexistente ou inativo e card soft-deletado", async () => {
    const { vendas, vendedora, outro } = await semear();
    const c = await criarCard({ pipelineId: vendas.id, faseId: fase(vendas, "em_negociacao").id, titulo: "Acme" }, vendedora);
    if (!c.ok) throw new Error(c.erro);
    expect(await editarCard(c.id, { responsavelId: "nao-existe" }, vendedora)).toEqual({ ok: false, erro: "RESPONSAVEL_INVALIDO" });
    await db.usuario.update({ where: { id: outro.id }, data: { ativo: false } });
    expect(await editarCard(c.id, { responsavelId: outro.id }, vendedora)).toEqual({ ok: false, erro: "RESPONSAVEL_INVALIDO" });
    expect(await editarCard(c.id, { titulo: "" }, vendedora)).toEqual({ ok: false, erro: "TITULO_INVALIDO" });
    await db.oportunidade.update({ where: { id: c.id }, data: { deletadoEm: new Date() } });
    expect(await editarCard(c.id, { dor: "x" }, vendedora)).toEqual({ ok: false, erro: "CARD_NAO_ENCONTRADO" });
    expect(await db.timeline.count({ where: { tipo: "CAMPO_ALTERADO" } })).toBe(0);
  });
});

describe("adicionarNota", () => {
  it("grava NOTA com autor e hora; recusa vazia", async () => {
    const { vendas, vendedora } = await semear();
    const c = await criarCard({ pipelineId: vendas.id, faseId: fase(vendas, "em_negociacao").id, titulo: "Acme" }, vendedora);
    if (!c.ok) throw new Error(c.erro);
    expect(await adicionarNota(c.id, "   ", vendedora)).toEqual({ ok: false, erro: "NOTA_INVALIDA" });
    expect(await adicionarNota(c.id, " Ligou, pediu proposta até sexta ", vendedora)).toEqual({ ok: true });
    const nota = await db.timeline.findFirstOrThrow({ where: { oportunidadeId: c.id, tipo: "NOTA" } });
    expect(nota).toMatchObject({ usuarioId: vendedora.id, payload: { texto: "Ligou, pediu proposta até sexta" } });
    expect(nota.em).toBeInstanceOf(Date);
  });
});

describe("leitura", () => {
  it("listarQuadro traz fases ativas em ordem e só cards vivos do quadro", async () => {
    const { vendas, projetos, vendedora } = await semear();
    const a = await criarCard({ pipelineId: vendas.id, faseId: fase(vendas, "primeiro_contato").id, titulo: "Vivo" }, vendedora);
    const b = await criarCard({ pipelineId: vendas.id, faseId: fase(vendas, "primeiro_contato").id, titulo: "Apagado" }, vendedora);
    await criarCard({ pipelineId: projetos.id, faseId: fase(projetos, "em_execucao").id, titulo: "Projeto" }, vendedora);
    if (!a.ok || !b.ok) throw new Error();
    await db.oportunidade.update({ where: { id: b.id }, data: { deletadoEm: new Date() } });
    await db.fase.update({ where: { id: fase(vendas, "em_negociacao").id }, data: { arquivadaEm: new Date() } });
    invalidarCachePipelines();

    const q = await listarQuadro("vendas");
    expect(q?.fases.map((f) => f.chave)).toEqual(["primeiro_contato", "contrato_assinado", "perdido"]);
    expect(q?.cards.map((c) => c.titulo)).toEqual(["Vivo"]);
    expect(q?.cards[0]).toMatchObject({ responsavel: { id: vendedora.id, nome: "Ana Vendas" }, faseId: fase(vendas, "primeiro_contato").id });
    expect(await listarQuadro("nao-existe")).toBeNull();
  });

  it("obterCard traz timeline em ordem cronológica; soft-deletado → null", async () => {
    const { vendas, vendedora } = await semear();
    const c = await criarCard({ pipelineId: vendas.id, faseId: fase(vendas, "primeiro_contato").id, titulo: "Acme" }, vendedora);
    if (!c.ok) throw new Error(c.erro);
    await moverCard(c.id, fase(vendas, "em_negociacao").id, vendedora);
    await adicionarNota(c.id, "oi", vendedora);
    const d = await obterCard(c.id);
    expect(d?.timeline.map((t) => t.tipo)).toEqual(["CRIACAO", "MOVIMENTACAO", "NOTA"]);
    expect(d?.timeline[2].usuario?.nome).toBe("Ana Vendas");
    await db.oportunidade.update({ where: { id: c.id }, data: { deletadoEm: new Date() } });
    expect(await obterCard(c.id)).toBeNull();
  });
});

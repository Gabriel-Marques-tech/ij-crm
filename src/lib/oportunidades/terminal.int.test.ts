import { beforeEach, describe, expect, it } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { criarCard, moverCard } from "./oportunidades";

const db = dbTeste();

async function semear() {
  const vendas = await db.pipeline.create({
    data: {
      chave: "vendas",
      nome: "Vendas",
      ordem: 0,
      fases: {
        create: [
          { chave: "primeiro_contato", nome: "Primeiro Contato", ordem: 0 },
          { chave: "em_negociacao", nome: "Em negociação", ordem: 1 },
          { chave: "contrato_assinado", nome: "Contrato assinado", ordem: 2, isTerminal: true, tipoTerminal: "GANHO" },
          { chave: "perdido", nome: "Perdido", ordem: 3, isTerminal: true, tipoTerminal: "PERDIDO" },
        ],
      },
    },
    include: { fases: true },
  });
  // `em_execucao` NÃO é a primeira por posição: a regra acha pela chave.
  const projetos = await db.pipeline.create({
    data: {
      chave: "projetos",
      nome: "Projetos",
      ordem: 1,
      fases: {
        create: [
          { chave: "kickoff", nome: "Kickoff", ordem: 0 },
          { chave: "em_execucao", nome: "Em execução", ordem: 1 },
          { chave: "finalizado", nome: "Finalizado", ordem: 2, isTerminal: true, tipoTerminal: "GANHO" },
        ],
      },
    },
    include: { fases: true },
  });
  const ana = await db.usuario.create({ data: { nome: "Ana Vendas", email: "ana@ij.test" } });
  const bruno = await db.usuario.create({ data: { nome: "Bruno Lima", email: "bruno@ij.test" } });
  const empresa = await db.empresa.create({ data: { nome: "Padaria do Zé" } });
  const contato = await db.contato.create({ data: { nome: "Zé", empresaId: empresa.id } });
  const r = await criarCard({ pipelineId: vendas.id, faseId: fase(vendas, "em_negociacao").id, titulo: "Site da padaria" }, ana);
  if (!r.ok) throw new Error(r.erro);
  await db.oportunidade.update({ where: { id: r.id }, data: { empresaId: empresa.id, contatoId: contato.id, estado: "SP", cidade: "Campinas" } });
  return { vendas, projetos, ana, bruno, empresa, contato, vendaId: r.id };
}

const fase = (p: { fases: { chave: string; id: string }[] }, chave: string) => p.fases.find((f) => f.chave === chave)!;
const tl = (oportunidadeId: string) => db.timeline.findMany({ where: { oportunidadeId }, orderBy: [{ em: "asc" }, { id: "asc" }] });
const projetosDe = (vendaId: string) => db.oportunidade.findMany({ where: { origemOportunidadeId: vendaId } });

beforeEach(async () => {
  await limparBanco(["transicao_fase", "timeline", "oportunidade", "contato", "empresa", "fase", "pipeline", "sessao", "usuario"]);
  invalidarCachePipelines();
});

describe("ganho em vendas", () => {
  it("grava data_ganho e cria UM card de projeto em em_execucao, ligado à venda, com histórico nos dois", async () => {
    const { vendas, projetos, ana, bruno, empresa, contato, vendaId } = await semear();
    // Quem move (Bruno) não é o responsável (Ana): o projeto herda o responsável da venda.
    const antes = Date.now();
    const r = await moverCard(vendaId, fase(vendas, "contrato_assinado").id, bruno, { dadosTerminal: {} });
    expect(r).toEqual({ ok: true, mudou: true, terminal: "GANHO" });

    const venda = await db.oportunidade.findUniqueOrThrow({ where: { id: vendaId } });
    expect(venda.valorFechado).toBeNull();
    expect(venda.dataGanho!.getTime()).toBeGreaterThanOrEqual(antes - 1000);

    const ps = await projetosDe(vendaId);
    expect(ps).toHaveLength(1);
    const p = ps[0];
    expect(p).toMatchObject({
      pipelineId: projetos.id,
      faseId: fase(projetos, "em_execucao").id,
      titulo: "Site da padaria",
      responsavelId: ana.id,
      empresaId: empresa.id,
      contatoId: contato.id,
      estado: "SP",
      cidade: "Campinas",
      criadoVia: "UI",
      origemOportunidadeId: vendaId,
    });
    expect(p.faseDesde.getTime()).toBe(venda.dataGanho!.getTime());

    expect(await db.transicaoFase.findMany({ where: { oportunidadeId: p.id } })).toMatchObject([
      { deFaseId: null, paraFaseId: fase(projetos, "em_execucao").id, usuarioId: bruno.id, origem: "SISTEMA" },
    ]);
    expect(await tl(p.id)).toMatchObject([
      { tipo: "CRIACAO", usuarioId: bruno.id, payload: { faseId: fase(projetos, "em_execucao").id, via: "GANHO", origemOportunidadeId: vendaId } },
    ]);
    const tv = await tl(vendaId);
    expect(tv.map((t) => t.tipo)).toEqual(["CRIACAO", "MOVIMENTACAO", "CAMPO_ALTERADO", "VINCULO_PROJETO"]);
    expect(tv[2].payload).toMatchObject({ campo: "dataGanho", antes: null, depois: venda.dataGanho!.toISOString() });
    expect(tv[3].payload).toEqual({ projetoId: p.id, criado: true });
  });

  it("sem o objeto de dados do fechamento (chamada direta, sem diálogo) o ganho é recusado e nada muda", async () => {
    const { vendas, ana, vendaId } = await semear();
    expect(await moverCard(vendaId, fase(vendas, "contrato_assinado").id, ana)).toEqual({ ok: false, erro: "DADOS_TERMINAL_OBRIGATORIOS" });
    const venda = await db.oportunidade.findUniqueOrThrow({ where: { id: vendaId } });
    expect(venda).toMatchObject({ faseId: fase(vendas, "em_negociacao").id, dataGanho: null });
    expect(await db.oportunidade.count()).toBe(1);
  });

  it("valor fechado opcional em BRL é gravado (com histórico); inválido recusa o movimento inteiro", async () => {
    const { vendas, ana, vendaId } = await semear();
    const ganho = fase(vendas, "contrato_assinado").id;

    expect(await moverCard(vendaId, ganho, ana, { dadosTerminal: { valorFechado: "quarenta mil" } })).toEqual({ ok: false, erro: "VALOR_FECHADO_INVALIDO" });
    const intacta = await db.oportunidade.findUniqueOrThrow({ where: { id: vendaId } });
    expect(intacta.faseId).toBe(fase(vendas, "em_negociacao").id);
    expect(intacta.dataGanho).toBeNull();
    expect(await db.oportunidade.count()).toBe(1);
    expect(await db.transicaoFase.count({ where: { oportunidadeId: vendaId } })).toBe(1);

    expect((await moverCard(vendaId, ganho, ana, { dadosTerminal: { valorFechado: "R$ 45.000,50" } })).ok).toBe(true);
    const venda = await db.oportunidade.findUniqueOrThrow({ where: { id: vendaId } });
    expect(venda.valorFechado?.toFixed(2)).toBe("45000.50");
    const campos = (await tl(vendaId)).filter((t) => t.tipo === "CAMPO_ALTERADO").map((t) => t.payload);
    expect(campos).toEqual([
      { campo: "valorFechado", antes: null, depois: "45000.50" },
      expect.objectContaining({ campo: "dataGanho", antes: null }),
    ]);
  });

  it("idempotente: ganho → reabrir → ganho de novo = 1 card de projeto; reabrir limpa data/valor com histórico", async () => {
    const { vendas, ana, vendaId } = await semear();
    const ganho = fase(vendas, "contrato_assinado").id;
    const negociacao = fase(vendas, "em_negociacao").id;

    await moverCard(vendaId, ganho, ana, { dadosTerminal: { valorFechado: "10.000" } });
    const [projeto] = await projetosDe(vendaId);
    const dataPrimeiroGanho = (await db.oportunidade.findUniqueOrThrow({ where: { id: vendaId } })).dataGanho!;

    expect(await moverCard(vendaId, negociacao, ana)).toEqual({ ok: true, mudou: true, terminal: null });
    const reaberta = await db.oportunidade.findUniqueOrThrow({ where: { id: vendaId } });
    expect(reaberta.dataGanho).toBeNull();
    expect(reaberta.valorFechado).toBeNull();
    const aposReabrir = (await tl(vendaId)).slice(-3);
    expect(aposReabrir.map((t) => [t.tipo, (t.payload as { campo?: string }).campo])).toEqual([
      ["MOVIMENTACAO", undefined],
      ["CAMPO_ALTERADO", "valorFechado"],
      ["CAMPO_ALTERADO", "dataGanho"],
    ]);
    expect(aposReabrir[1].payload).toEqual({ campo: "valorFechado", antes: "10000.00", depois: null });
    expect(aposReabrir[2].payload).toEqual({ campo: "dataGanho", antes: dataPrimeiroGanho.toISOString(), depois: null });
    // O projeto continua onde estava.
    expect(await db.oportunidade.findUniqueOrThrow({ where: { id: projeto.id } })).toMatchObject({ deletadoEm: null });

    expect((await moverCard(vendaId, ganho, ana, { dadosTerminal: {} })).ok).toBe(true);
    expect(await projetosDe(vendaId)).toHaveLength(1);
    expect(await db.oportunidade.count()).toBe(2);
    expect((await db.oportunidade.findUniqueOrThrow({ where: { id: vendaId } })).dataGanho).not.toBeNull();
    expect((await tl(vendaId)).at(-1)!.payload).toEqual({ projetoId: projeto.id, criado: false });
    expect((await tl(projeto.id)).map((t) => [t.tipo, t.payload])).toEqual([
      ["CRIACAO", expect.objectContaining({ via: "GANHO", origemOportunidadeId: vendaId })],
      ["VINCULO_PROJETO", { vendaId, criado: false }],
    ]);
    // Histórico completo das transições da venda: criação, ganho, reabertura, ganho.
    expect(await db.transicaoFase.count({ where: { oportunidadeId: vendaId } })).toBe(4);
  });

  it("dois ganhos concorrentes do mesmo card = 1 card de projeto (o segundo vira no-op)", async () => {
    const { vendas, ana, bruno, vendaId } = await semear();
    const ganho = fase(vendas, "contrato_assinado").id;
    const rs = await Promise.all([
      moverCard(vendaId, ganho, ana, { dadosTerminal: {} }),
      moverCard(vendaId, ganho, bruno, { dadosTerminal: {} }),
    ]);
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(rs.map((r) => r.ok && r.mudou).sort()).toEqual([false, true]);
    expect(await projetosDe(vendaId)).toHaveLength(1);
    expect(await db.timeline.count({ where: { oportunidadeId: vendaId, tipo: "VINCULO_PROJETO" } })).toBe(1);
  });

  it("projeto soft-deletado não é recriado no re-ganho (um projeto por venda, para sempre)", async () => {
    const { vendas, ana, vendaId } = await semear();
    const ganho = fase(vendas, "contrato_assinado").id;
    await moverCard(vendaId, ganho, ana, { dadosTerminal: {} });
    const [projeto] = await projetosDe(vendaId);
    await db.oportunidade.update({ where: { id: projeto.id }, data: { deletadoEm: new Date() } });
    await moverCard(vendaId, fase(vendas, "em_negociacao").id, ana);
    expect((await moverCard(vendaId, ganho, ana, { dadosTerminal: {} })).ok).toBe(true);
    expect(await projetosDe(vendaId)).toHaveLength(1);
    expect((await tl(vendaId)).at(-1)!.payload).toEqual({ projetoId: projeto.id, criado: false });
  });

  it("o banco garante: duas oportunidades com a mesma origem → violação de unicidade", async () => {
    const { projetos, ana, vendaId } = await semear();
    const dados = { pipelineId: projetos.id, faseId: fase(projetos, "em_execucao").id, titulo: "P", responsavelId: ana.id, criadoVia: "UI" as const, origemOportunidadeId: vendaId };
    await db.oportunidade.create({ data: dados });
    await expect(db.oportunidade.create({ data: dados })).rejects.toMatchObject({ code: "P2002" });
  });

  it("fase inicial de projetos (em_execucao) arquivada ou ausente → erro de regra, nada muda", async () => {
    const { vendas, projetos, ana, vendaId } = await semear();
    const ganho = fase(vendas, "contrato_assinado").id;
    await db.fase.update({ where: { id: fase(projetos, "em_execucao").id }, data: { arquivadaEm: new Date() } });
    expect(await moverCard(vendaId, ganho, ana, { dadosTerminal: {} })).toEqual({ ok: false, erro: "FASE_INICIAL_PROJETOS_INDISPONIVEL" });

    await db.fase.delete({ where: { id: fase(projetos, "em_execucao").id } });
    expect(await moverCard(vendaId, ganho, ana, { dadosTerminal: {} })).toEqual({ ok: false, erro: "FASE_INICIAL_PROJETOS_INDISPONIVEL" });

    const venda = await db.oportunidade.findUniqueOrThrow({ where: { id: vendaId } });
    expect(venda.faseId).toBe(fase(vendas, "em_negociacao").id);
    expect(venda.dataGanho).toBeNull();
    expect(await db.oportunidade.count()).toBe(1);
  });
});

describe("perdido", () => {
  it("motivo obrigatório (da lista; “outro” com texto); sem ele o card não move", async () => {
    const { vendas, ana, vendaId } = await semear();
    const perdido = fase(vendas, "perdido").id;
    expect(await moverCard(vendaId, perdido, ana)).toEqual({ ok: false, erro: "DADOS_TERMINAL_OBRIGATORIOS" });
    expect(await moverCard(vendaId, perdido, ana, { dadosTerminal: {} })).toEqual({ ok: false, erro: "MOTIVO_PERDA_OBRIGATORIO" });
    expect(await moverCard(vendaId, perdido, ana, { dadosTerminal: { motivo: "achismo" } })).toEqual({ ok: false, erro: "MOTIVO_PERDA_INVALIDO" });
    expect(await moverCard(vendaId, perdido, ana, { dadosTerminal: { motivo: "outro", detalhe: " " } })).toEqual({
      ok: false,
      erro: "MOTIVO_PERDA_DETALHE_OBRIGATORIO",
    });
    const intacta = await db.oportunidade.findUniqueOrThrow({ where: { id: vendaId } });
    expect(intacta.faseId).toBe(fase(vendas, "em_negociacao").id);
    expect(intacta.motivoPerda).toBeNull();
    expect(await db.transicaoFase.count({ where: { oportunidadeId: vendaId } })).toBe(1);
  });

  it("grava motivo_perda com histórico; não cria projeto; reabrir limpa o motivo com histórico", async () => {
    const { vendas, ana, vendaId } = await semear();
    const r = await moverCard(vendaId, fase(vendas, "perdido").id, ana, { dadosTerminal: { motivo: "concorrente", detalhe: "fechou com a X" } });
    expect(r).toEqual({ ok: true, mudou: true, terminal: "PERDIDO" });
    expect((await db.oportunidade.findUniqueOrThrow({ where: { id: vendaId } })).motivoPerda).toBe("Concorrente: fechou com a X");
    expect((await tl(vendaId)).at(-1)!.payload).toEqual({ campo: "motivoPerda", antes: null, depois: "Concorrente: fechou com a X" });
    expect(await projetosDe(vendaId)).toHaveLength(0);

    await moverCard(vendaId, fase(vendas, "primeiro_contato").id, ana);
    expect((await db.oportunidade.findUniqueOrThrow({ where: { id: vendaId } })).motivoPerda).toBeNull();
    expect((await tl(vendaId)).at(-1)!.payload).toEqual({ campo: "motivoPerda", antes: "Concorrente: fechou com a X", depois: null });
  });

  it("ganho → perdido direto: limpa data/valor do ganho, grava motivo e mantém o projeto já criado", async () => {
    const { vendas, ana, vendaId } = await semear();
    await moverCard(vendaId, fase(vendas, "contrato_assinado").id, ana, { dadosTerminal: { valorFechado: "500" } });
    expect((await moverCard(vendaId, fase(vendas, "perdido").id, ana, { dadosTerminal: { motivo: "timing" } })).ok).toBe(true);
    const venda = await db.oportunidade.findUniqueOrThrow({ where: { id: vendaId } });
    expect(venda).toMatchObject({ dataGanho: null, valorFechado: null, motivoPerda: "Timing" });
    expect(await projetosDe(vendaId)).toHaveLength(1);
  });
});

describe("projetos", () => {
  it("mover projeto para o terminal (finalizado) não pede dados nem cria nada", async () => {
    const { vendas, projetos, ana, vendaId } = await semear();
    await moverCard(vendaId, fase(vendas, "contrato_assinado").id, ana, { dadosTerminal: {} });
    const [projeto] = await projetosDe(vendaId);
    expect(await moverCard(projeto.id, fase(projetos, "finalizado").id, ana)).toEqual({ ok: true, mudou: true, terminal: "GANHO" });
    const p = await db.oportunidade.findUniqueOrThrow({ where: { id: projeto.id } });
    expect(p).toMatchObject({ faseId: fase(projetos, "finalizado").id, dataGanho: null, valorFechado: null });
    expect(await db.oportunidade.count()).toBe(2);
    expect(await projetosDe(projeto.id)).toHaveLength(0);
  });
});

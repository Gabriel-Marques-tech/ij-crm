import { beforeEach, describe, expect, it } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { invalidarCachePipelines } from "./cache";
import {
  criarFase,
  desarquivarFase,
  editarFase,
  listarPipelines,
  listarPipelinesParaGestao,
  moverFase,
  removerFase,
  reordenarFases,
} from "./fases";

const db = dbTeste();

async function semearPipelines() {
  const vendas = await db.pipeline.create({
    data: {
      chave: "vendas",
      nome: "Vendas",
      ordem: 0,
      fases: {
        create: [
          { chave: "primeiro_contato", nome: "Primeiro Contato", ordem: 0, cor: "#8a5cf6", limiteDiasAlerta: 7 },
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
      fases: {
        create: [
          { chave: "em_execucao", nome: "Em execução", ordem: 0 },
          { chave: "finalizado", nome: "Finalizado", ordem: 1, isTerminal: true, tipoTerminal: "GANHO" },
        ],
      },
    },
    include: { fases: { orderBy: { ordem: "asc" } } },
  });
  return { vendas, projetos };
}

async function gestor() {
  return db.usuario.create({ data: { nome: "Gestora", email: "gestora@ij.test", papel: "GESTOR" } });
}

async function card(pipelineId: string, faseId: string, responsavelId: string, titulo = "Lead") {
  return db.oportunidade.create({ data: { pipelineId, faseId, titulo, responsavelId, criadoVia: "UI" } });
}

const faseDe = (p: { fases: { chave: string; id: string }[] }, chave: string) => p.fases.find((f) => f.chave === chave)!;

beforeEach(async () => {
  await limparBanco(["transicao_fase", "timeline", "oportunidade", "fase", "pipeline", "sessao", "usuario"]);
  invalidarCachePipelines();
});

describe("listarPipelines", () => {
  it("devolve pipelines e fases ativas em ordem; arquivadas só sob pedido", async () => {
    const { vendas } = await semearPipelines();
    await db.fase.update({ where: { id: faseDe(vendas, "em_negociacao").id }, data: { arquivadaEm: new Date() } });
    invalidarCachePipelines();

    const lista = await listarPipelines();
    expect(lista.map((p) => p.chave)).toEqual(["vendas", "projetos"]);
    expect(lista[0].fases.map((f) => f.chave)).toEqual(["primeiro_contato", "contrato_assinado", "perdido"]);

    const comArquivadas = await listarPipelines({ incluirArquivadas: true });
    expect(comArquivadas[0].fases.map((f) => f.chave)).toEqual(["primeiro_contato", "em_negociacao", "contrato_assinado", "perdido"]);
  });

  it("é servido do cache: escrita direta no banco só aparece depois de invalidar", async () => {
    const { projetos } = await semearPipelines();
    expect((await listarPipelines())[1].fases).toHaveLength(2);
    await db.fase.create({ data: { pipelineId: projetos.id, chave: "x", nome: "X", ordem: 9 } });
    expect((await listarPipelines())[1].fases).toHaveLength(2);
    invalidarCachePipelines();
    expect((await listarPipelines())[1].fases).toHaveLength(3);
  });
});

describe("criarFase", () => {
  it("deriva a chave do nome, entra no fim e invalida o cache", async () => {
    const { vendas } = await semearPipelines();
    await listarPipelines(); // aquece o cache
    const r = await criarFase(vendas.id, { nome: "Reunião Diagnóstica", cor: "#4CC9F0", limiteDiasAlerta: 10 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const f = await db.fase.findUniqueOrThrow({ where: { id: r.faseId } });
    expect(f.chave).toBe("reuniao_diagnostica");
    expect(f.ordem).toBe(4);
    expect(f.cor).toBe("#4cc9f0");
    expect(f.isTerminal).toBe(false);
    const lista = await listarPipelines();
    expect(lista[0].fases.at(-1)?.chave).toBe("reuniao_diagnostica");
  });

  it("chave colide (mesmo com fase arquivada) → ganha sufixo; chave nunca muda ao renomear", async () => {
    const { vendas } = await semearPipelines();
    await db.fase.update({ where: { id: faseDe(vendas, "perdido").id }, data: { arquivadaEm: new Date() } });
    const r = await criarFase(vendas.id, { nome: "Perdido", tipoTerminal: "PERDIDO" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await db.fase.findUniqueOrThrow({ where: { id: r.faseId } })).chave).toBe("perdido_2");
    expect(await editarFase(r.faseId, { nome: "Perdemos" })).toEqual({ ok: true });
    const f = await db.fase.findUniqueOrThrow({ where: { id: r.faseId } });
    expect(f.nome).toBe("Perdemos");
    expect(f.chave).toBe("perdido_2");
  });

  it("terminal grava is_terminal + tipo juntos (CHECK do banco)", async () => {
    const { projetos } = await semearPipelines();
    const r = await criarFase(projetos.id, { nome: "Cancelado", tipoTerminal: "PERDIDO" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const f = await db.fase.findUniqueOrThrow({ where: { id: r.faseId } });
    expect(f.isTerminal).toBe(true);
    expect(f.tipoTerminal).toBe("PERDIDO");
  });

  it("valida nome, cor e limite; pipeline inexistente", async () => {
    const { vendas } = await semearPipelines();
    expect(await criarFase(vendas.id, { nome: " " })).toEqual({ ok: false, erro: "NOME_INVALIDO" });
    expect(await criarFase(vendas.id, { nome: "Xa", cor: "azul" })).toEqual({ ok: false, erro: "COR_INVALIDA" });
    expect(await criarFase(vendas.id, { nome: "Xa", limiteDiasAlerta: 0 })).toEqual({ ok: false, erro: "LIMITE_INVALIDO" });
    expect(await criarFase("nao-existe", { nome: "Xa" })).toEqual({ ok: false, erro: "PIPELINE_NAO_ENCONTRADO" });
  });
});

describe("editarFase", () => {
  it("edita nome, cor, limite e terminal", async () => {
    const { vendas } = await semearPipelines();
    const f = faseDe(vendas, "em_negociacao");
    expect(await editarFase(f.id, { nome: "Negociando", cor: "#ff4d3a", limiteDiasAlerta: null, tipoTerminal: "GANHO" })).toEqual({ ok: true });
    const d = await db.fase.findUniqueOrThrow({ where: { id: f.id } });
    expect(d).toMatchObject({ nome: "Negociando", cor: "#ff4d3a", limiteDiasAlerta: null, isTerminal: true, tipoTerminal: "GANHO", chave: "em_negociacao" });
  });

  it("não deixa vendas ficar sem GANHO ou sem PERDIDO; projetos só exige GANHO", async () => {
    const { vendas, projetos } = await semearPipelines();
    expect(await editarFase(faseDe(vendas, "contrato_assinado").id, { tipoTerminal: null })).toEqual({ ok: false, erro: "TERMINAL_GANHO_OBRIGATORIO" });
    expect(await editarFase(faseDe(vendas, "perdido").id, { tipoTerminal: "GANHO" })).toEqual({ ok: false, erro: "TERMINAL_PERDIDO_OBRIGATORIO" });
    expect(await editarFase(faseDe(projetos, "finalizado").id, { tipoTerminal: "PERDIDO" })).toEqual({ ok: false, erro: "TERMINAL_GANHO_OBRIGATORIO" });
    // Com um segundo GANHO, o primeiro pode deixar de ser terminal.
    await criarFase(vendas.id, { nome: "Assinado 2", tipoTerminal: "GANHO" });
    expect(await editarFase(faseDe(vendas, "contrato_assinado").id, { tipoTerminal: null })).toEqual({ ok: true });
  });

  it("fase arquivada não é editável", async () => {
    const { vendas } = await semearPipelines();
    const f = faseDe(vendas, "em_negociacao");
    await db.fase.update({ where: { id: f.id }, data: { arquivadaEm: new Date() } });
    expect(await editarFase(f.id, { nome: "Xa" })).toEqual({ ok: false, erro: "FASE_ARQUIVADA" });
  });
});

describe("reordenarFases / moverFase", () => {
  it("persiste ordem 0..n-1 na sequência pedida", async () => {
    const { vendas } = await semearPipelines();
    const ids = vendas.fases.map((f) => f.id);
    const nova = [ids[1], ids[0], ids[3], ids[2]];
    expect(await reordenarFases(vendas.id, nova)).toEqual({ ok: true });
    const fases = await db.fase.findMany({ where: { pipelineId: vendas.id }, orderBy: { ordem: "asc" } });
    expect(fases.map((f) => f.id)).toEqual(nova);
    expect(fases.map((f) => f.ordem)).toEqual([0, 1, 2, 3]);
  });

  it("rejeita lista que não é permutação das fases ativas", async () => {
    const { vendas } = await semearPipelines();
    const ids = vendas.fases.map((f) => f.id);
    expect(await reordenarFases(vendas.id, ids.slice(1))).toEqual({ ok: false, erro: "ORDEM_INVALIDA" });
    expect(await reordenarFases(vendas.id, [...ids.slice(0, 3), "intrusa"])).toEqual({ ok: false, erro: "ORDEM_INVALIDA" });
  });

  it("subir/descer troca com a vizinha e respeita as pontas", async () => {
    const { vendas } = await semearPipelines();
    const f = faseDe(vendas, "em_negociacao");
    expect(await moverFase(f.id, "SUBIR")).toEqual({ ok: true });
    let chaves = (await listarPipelines())[0].fases.map((x) => x.chave);
    expect(chaves).toEqual(["em_negociacao", "primeiro_contato", "contrato_assinado", "perdido"]);
    expect(await moverFase(f.id, "SUBIR")).toEqual({ ok: true }); // já no topo: no-op
    chaves = (await listarPipelines())[0].fases.map((x) => x.chave);
    expect(chaves[0]).toBe("em_negociacao");
  });
});

describe("removerFase", () => {
  it("sem cards e sem histórico → exclui de verdade", async () => {
    const { vendas } = await semearPipelines();
    const f = faseDe(vendas, "em_negociacao");
    expect(await removerFase(f.id, {}, { id: "sistema" })).toEqual({ ok: true, acao: "EXCLUIR" });
    expect(await db.fase.findUnique({ where: { id: f.id } })).toBeNull();
  });

  it("com cards exige destino; migra cards, grava TransicaoFase SISTEMA e arquiva", async () => {
    const { vendas } = await semearPipelines();
    const g = await gestor();
    const origem = faseDe(vendas, "em_negociacao");
    const destino = faseDe(vendas, "primeiro_contato");
    const c1 = await card(vendas.id, origem.id, g.id, "A");
    const c2 = await card(vendas.id, origem.id, g.id, "B");
    const antes = new Date(Date.now() - 60_000);
    await db.oportunidade.updateMany({ where: { id: { in: [c1.id, c2.id] } }, data: { faseDesde: antes } });

    expect(await removerFase(origem.id, {}, g)).toEqual({ ok: false, erro: "DESTINO_OBRIGATORIO" });
    expect(await removerFase(origem.id, { destinoFaseId: origem.id }, g)).toEqual({ ok: false, erro: "DESTINO_INVALIDO" });

    expect(await removerFase(origem.id, { destinoFaseId: destino.id }, g)).toEqual({ ok: true, acao: "ARQUIVAR" });

    const cards = await db.oportunidade.findMany({ where: { id: { in: [c1.id, c2.id] } } });
    expect(cards.every((c) => c.faseId === destino.id)).toBe(true);
    expect(cards.every((c) => c.faseDesde.getTime() > antes.getTime())).toBe(true);

    const transicoes = await db.transicaoFase.findMany({ where: { deFaseId: origem.id } });
    expect(transicoes).toHaveLength(2);
    expect(transicoes.every((t) => t.paraFaseId === destino.id && t.origem === "SISTEMA" && t.usuarioId === g.id)).toBe(true);

    const f = await db.fase.findUniqueOrThrow({ where: { id: origem.id } });
    expect(f.arquivadaEm).not.toBeNull();
    expect((await listarPipelines())[0].fases.map((x) => x.chave)).not.toContain("em_negociacao");
  });

  it("sem cards mas com histórico → arquiva (não tenta apagar)", async () => {
    const { vendas } = await semearPipelines();
    const g = await gestor();
    const a = faseDe(vendas, "primeiro_contato");
    const b = faseDe(vendas, "em_negociacao");
    const c = await card(vendas.id, b.id, g.id);
    await db.transicaoFase.create({ data: { oportunidadeId: c.id, deFaseId: a.id, paraFaseId: b.id, origem: "UI", usuarioId: g.id } });
    expect(await removerFase(a.id, {}, g)).toEqual({ ok: true, acao: "ARQUIVAR" });
    expect((await db.fase.findUniqueOrThrow({ where: { id: a.id } })).arquivadaEm).not.toBeNull();
  });

  it("não remove o último GANHO/PERDIDO de vendas", async () => {
    const { vendas } = await semearPipelines();
    expect(await removerFase(faseDe(vendas, "perdido").id, {}, { id: "x" })).toEqual({ ok: false, erro: "TERMINAL_PERDIDO_OBRIGATORIO" });
    expect(await removerFase(faseDe(vendas, "contrato_assinado").id, {}, { id: "x" })).toEqual({ ok: false, erro: "TERMINAL_GANHO_OBRIGATORIO" });
  });

  it("destino arquivado ou de outro pipeline é recusado", async () => {
    const { vendas, projetos } = await semearPipelines();
    const g = await gestor();
    const origem = faseDe(vendas, "em_negociacao");
    await card(vendas.id, origem.id, g.id);
    expect(await removerFase(origem.id, { destinoFaseId: faseDe(projetos, "em_execucao").id }, g)).toEqual({ ok: false, erro: "DESTINO_INVALIDO" });
    const arq = faseDe(vendas, "primeiro_contato");
    await db.fase.update({ where: { id: arq.id }, data: { arquivadaEm: new Date() } });
    expect(await removerFase(origem.id, { destinoFaseId: arq.id }, g)).toEqual({ ok: false, erro: "DESTINO_INVALIDO" });
  });
});

describe("desarquivarFase", () => {
  it("volta a fase ao fim do quadro", async () => {
    const { vendas } = await semearPipelines();
    const f = faseDe(vendas, "primeiro_contato");
    await db.fase.update({ where: { id: f.id }, data: { arquivadaEm: new Date() } });
    invalidarCachePipelines();
    expect(await desarquivarFase(f.id)).toEqual({ ok: true });
    const chaves = (await listarPipelines())[0].fases.map((x) => x.chave);
    expect(chaves).toEqual(["em_negociacao", "contrato_assinado", "perdido", "primeiro_contato"]);
  });
});

describe("listarPipelinesParaGestao", () => {
  it("traz contagem de cards e transições por fase", async () => {
    const { vendas } = await semearPipelines();
    const g = await gestor();
    const a = faseDe(vendas, "primeiro_contato");
    const b = faseDe(vendas, "em_negociacao");
    const c = await card(vendas.id, b.id, g.id);
    await db.transicaoFase.create({ data: { oportunidadeId: c.id, deFaseId: a.id, paraFaseId: b.id, origem: "UI" } });
    const lista = await listarPipelinesParaGestao();
    const fa = lista[0].fases.find((f) => f.chave === "primeiro_contato")!;
    const fb = lista[0].fases.find((f) => f.chave === "em_negociacao")!;
    expect(fa.uso).toEqual({ cards: 0, transicoes: 1 });
    expect(fb.uso).toEqual({ cards: 1, transicoes: 1 });
  });
});

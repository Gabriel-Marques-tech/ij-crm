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
  travarPipelines,
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
  return db.projeto.create({ data: { pipelineId, faseId, titulo, responsavelId, criadoVia: "UI" } });
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

  it("devolve cópias: mexer no resultado não contamina a próxima leitura", async () => {
    await semearPipelines();
    const a = await listarPipelines();
    a[0].nome = "Hackeado";
    a[0].fases.pop();
    a[0].fases[0].nome = "Outro";
    const b = await listarPipelines();
    expect(b[0].nome).toBe("Vendas");
    expect(b[0].fases).toHaveLength(4);
    expect(b[0].fases[0].nome).toBe("Primeiro Contato");
    const g = await listarPipelinesParaGestao();
    g[0].fases.splice(0);
    expect((await listarPipelinesParaGestao())[0].fases).toHaveLength(4);
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

  it("criações concorrentes no mesmo quadro recebem ordens distintas (lock do pipeline)", async () => {
    const { projetos } = await semearPipelines();
    const rs = await Promise.all([
      criarFase(projetos.id, { nome: "Alfa" }),
      criarFase(projetos.id, { nome: "Beta" }),
      criarFase(projetos.id, { nome: "Gama" }),
    ]);
    expect(rs.every((r) => r.ok)).toBe(true);
    const ordens = (await db.fase.findMany({ where: { pipelineId: projetos.id }, select: { ordem: true } })).map((f) => f.ordem).sort();
    expect(ordens).toEqual([0, 1, 2, 3, 4]);
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
  it("fase com cards vivos não muda de tipo terminal (cards não passariam pelo gancho); o resto edita", async () => {
    const { vendas } = await semearPipelines();
    const g = await gestor();
    const aberta = faseDe(vendas, "em_negociacao");
    await card(vendas.id, aberta.id, g.id);
    expect(await editarFase(aberta.id, { tipoTerminal: "GANHO" })).toEqual({ ok: false, erro: "FASE_COM_CARDS_TERMINAL" });
    const ganho = faseDe(vendas, "contrato_assinado");
    await card(vendas.id, ganho.id, g.id);
    // Segundo GANHO: sem ele a regra "≥1 GANHO" responderia antes.
    await db.fase.create({ data: { pipelineId: vendas.id, chave: "ganho_2", nome: "Ganho 2", ordem: 99, isTerminal: true, tipoTerminal: "GANHO" } });
    expect(await editarFase(ganho.id, { tipoTerminal: null })).toEqual({ ok: false, erro: "FASE_COM_CARDS_TERMINAL" });
    expect(await editarFase(ganho.id, { tipoTerminal: "PERDIDO" })).toEqual({ ok: false, erro: "FASE_COM_CARDS_TERMINAL" });
    // Mesmo tipo (o formulário reenvia o atual) e outros campos passam.
    expect(await editarFase(ganho.id, { nome: "Assinado", tipoTerminal: "GANHO" })).toEqual({ ok: true });
    expect(await editarFase(aberta.id, { nome: "Negociando", tipoTerminal: null })).toEqual({ ok: true });
    const f = await db.fase.findUniqueOrThrow({ where: { id: aberta.id } });
    expect(f).toMatchObject({ nome: "Negociando", isTerminal: false, tipoTerminal: null });
    // Card soft-deletado não conta.
    const vazia = faseDe(vendas, "primeiro_contato");
    await db.projeto.create({ data: { pipelineId: vendas.id, faseId: vazia.id, titulo: "m", responsavelId: g.id, criadoVia: "UI", deletadoEm: new Date() } });
    expect(await editarFase(vazia.id, { tipoTerminal: "PERDIDO" })).toEqual({ ok: true });
  });

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
    await db.projeto.updateMany({ where: { id: { in: [c1.id, c2.id] } }, data: { faseDesde: antes } });

    expect(await removerFase(origem.id, {}, g)).toEqual({ ok: false, erro: "DESTINO_OBRIGATORIO" });
    expect(await removerFase(origem.id, { destinoFaseId: origem.id }, g)).toEqual({ ok: false, erro: "DESTINO_INVALIDO" });

    expect(await removerFase(origem.id, { destinoFaseId: destino.id }, g)).toEqual({ ok: true, acao: "ARQUIVAR" });

    const cards = await db.projeto.findMany({ where: { id: { in: [c1.id, c2.id] } } });
    expect(cards.every((c) => c.faseId === destino.id)).toBe(true);
    expect(cards.every((c) => c.faseDesde.getTime() > antes.getTime())).toBe(true);

    const transicoes = await db.transicaoFase.findMany({ where: { deFaseId: origem.id } });
    expect(transicoes).toHaveLength(2);
    expect(transicoes.every((t) => t.paraFaseId === destino.id && t.origem === "SISTEMA" && t.usuarioId === g.id)).toBe(true);

    const timeline = await db.timeline.findMany({ where: { projetoId: { in: [c1.id, c2.id] } }, orderBy: { projetoId: "asc" } });
    expect(timeline).toHaveLength(2);
    for (const t of timeline) {
      expect(t.tipo).toBe("MOVIMENTACAO");
      expect(t.usuarioId).toBe(g.id);
      expect(t.payload).toEqual({ deFaseId: origem.id, paraFaseId: destino.id, motivo: "fase_arquivada" });
    }

    const f = await db.fase.findUniqueOrThrow({ where: { id: origem.id } });
    expect(f.arquivadaEm).not.toBeNull();
    expect((await listarPipelines())[0].fases.map((x) => x.chave)).not.toContain("em_negociacao");
  });

  it("cards soft-deletados: não contam, não migram, não ganham histórico; mas seguram a FK → arquiva", async () => {
    const { vendas } = await semearPipelines();
    const g = await gestor();
    const origem = faseDe(vendas, "em_negociacao");
    const destino = faseDe(vendas, "primeiro_contato");
    const vivo = await card(vendas.id, origem.id, g.id, "vivo");
    const morto = await db.projeto.create({
      data: { pipelineId: vendas.id, faseId: origem.id, titulo: "morto", responsavelId: g.id, criadoVia: "UI", deletadoEm: new Date() },
    });

    const uso = (await listarPipelinesParaGestao())[0].fases.find((f) => f.id === origem.id)!.uso;
    expect(uso.cards).toBe(1);

    expect(await removerFase(origem.id, { destinoFaseId: destino.id }, g)).toEqual({ ok: true, acao: "ARQUIVAR" });
    expect((await db.projeto.findUniqueOrThrow({ where: { id: vivo.id } })).faseId).toBe(destino.id);
    expect((await db.projeto.findUniqueOrThrow({ where: { id: morto.id } })).faseId).toBe(origem.id);
    expect(await db.transicaoFase.count({ where: { projetoId: morto.id } })).toBe(0);
    expect(await db.timeline.count({ where: { projetoId: morto.id } })).toBe(0);
  });

  it("só card soft-deletado na fase: sem destino, sem migração, arquiva em vez de excluir (FK)", async () => {
    const { vendas } = await semearPipelines();
    const g = await gestor();
    const origem = faseDe(vendas, "em_negociacao");
    await db.projeto.create({
      data: { pipelineId: vendas.id, faseId: origem.id, titulo: "morto", responsavelId: g.id, criadoVia: "UI", deletadoEm: new Date() },
    });
    expect(await removerFase(origem.id, {}, g)).toEqual({ ok: true, acao: "ARQUIVAR" });
    expect((await db.fase.findUniqueOrThrow({ where: { id: origem.id } })).arquivadaEm).not.toBeNull();
  });

  it("sem cards mas com histórico → arquiva (não tenta apagar)", async () => {
    const { vendas } = await semearPipelines();
    const g = await gestor();
    const a = faseDe(vendas, "primeiro_contato");
    const b = faseDe(vendas, "em_negociacao");
    const c = await card(vendas.id, b.id, g.id);
    await db.transicaoFase.create({ data: { projetoId: c.id, deFaseId: a.id, paraFaseId: b.id, origem: "UI", usuarioId: g.id } });
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

describe("removerFase × fases terminais (GAB-32)", () => {
  it("cards de fase aberta não vão para ganho/perdido, e de terminal não voltam para aberta: nada muda", async () => {
    const { vendas } = await semearPipelines();
    const g = await gestor();
    const aberta = faseDe(vendas, "em_negociacao");
    const c = await card(vendas.id, aberta.id, g.id);
    for (const destino of ["contrato_assinado", "perdido"]) {
      expect(await removerFase(aberta.id, { destinoFaseId: faseDe(vendas, destino).id }, g)).toEqual({ ok: false, erro: "DESTINO_TERMINAL_INCOMPATIVEL" });
    }
    // Segundo PERDIDO para a fase perdida poder sair sem quebrar "≥1 PERDIDO".
    const perdido2 = await db.fase.create({ data: { pipelineId: vendas.id, chave: "perdido_2", nome: "Perdido 2", ordem: 99, isTerminal: true, tipoTerminal: "PERDIDO" } });
    const perdido = faseDe(vendas, "perdido");
    const p = await db.projeto.create({ data: { pipelineId: vendas.id, faseId: perdido.id, titulo: "P", responsavelId: g.id, criadoVia: "UI", motivoPerda: "Preço" } });
    expect(await removerFase(perdido.id, { destinoFaseId: aberta.id }, g)).toEqual({ ok: false, erro: "DESTINO_TERMINAL_INCOMPATIVEL" });
    expect(await removerFase(perdido.id, { destinoFaseId: faseDe(vendas, "contrato_assinado").id }, g)).toEqual({ ok: false, erro: "DESTINO_TERMINAL_INCOMPATIVEL" });
    expect((await db.projeto.findUniqueOrThrow({ where: { id: c.id } })).faseId).toBe(aberta.id);
    expect((await db.projeto.findUniqueOrThrow({ where: { id: p.id } })).faseId).toBe(perdido.id);

    // Mesmo tipo terminal: migra mantendo os dados do fechamento.
    expect(await removerFase(perdido.id, { destinoFaseId: perdido2.id }, g)).toEqual({ ok: true, acao: "ARQUIVAR" });
    expect(await db.projeto.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ faseId: perdido2.id, motivoPerda: "Preço" });
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
    await db.transicaoFase.create({ data: { projetoId: c.id, deFaseId: a.id, paraFaseId: b.id, origem: "UI" } });
    const lista = await listarPipelinesParaGestao();
    const fa = lista[0].fases.find((f) => f.chave === "primeiro_contato")!;
    const fb = lista[0].fases.find((f) => f.chave === "em_negociacao")!;
    expect(fa.uso).toEqual({ cards: 0, transicoes: 1 });
    expect(fb.uso).toEqual({ cards: 1, transicoes: 1 });
  });
});

describe("travarPipelines", () => {
  it("trava cada pipeline uma vez, em ordem crescente de id, qualquer que seja a ordem pedida", async () => {
    const ordem: unknown[] = [];
    const txFalso = {
      $queryRaw: async (_partes: TemplateStringsArray, ...valores: unknown[]) => {
        ordem.push(valores[0]);
        return [{ id: valores[0] }];
      },
    } as unknown as Parameters<typeof travarPipelines>[0];
    expect(await travarPipelines(txFalso, ["c", "a", "b", "a"])).toBe(true);
    expect(ordem).toEqual(["a", "b", "c"]);
  });

  it("pipeline inexistente no conjunto → false", async () => {
    const { vendas } = await semearPipelines();
    expect(await db.$transaction((tx) => travarPipelines(tx, [vendas.id, "nao-existe"]))).toBe(false);
  });

  it("operações cruzadas (vendas+projetos × projetos+vendas) não dão deadlock", async () => {
    const { vendas, projetos } = await semearPipelines();
    const op = (ids: string[]) =>
      db.$transaction(async (tx) => {
        await travarPipelines(tx, ids);
        await tx.$executeRaw`SELECT pg_sleep(0.1)`;
        return true;
      });
    const rs = await Promise.all([op([vendas.id, projetos.id]), op([projetos.id, vendas.id]), op([vendas.id, projetos.id]), op([projetos.id, vendas.id])]);
    expect(rs).toEqual([true, true, true, true]);
  });
});

describe("marcos do ciclo único (GAB-81)", () => {
  async function semeado() {
    const { semear } = await import("../../../prisma/seed");
    await semear(db, { log: () => {} });
    invalidarCachePipelines();
    const ps = await listarPipelines();
    const vendas = ps.find((p) => p.chave === "vendas")!;
    const projetos = ps.find((p) => p.chave === "projetos")!;
    const f = (chave: string) => [...vendas.fases, ...projetos.fases].find((x) => x.chave === chave)!;
    return { vendas, projetos, f };
  }

  it("seed: marcos nos quadros certos, Handoff primeiro em Projetos", async () => {
    const { vendas, projetos } = await semeado();
    expect(vendas.fases.filter((x) => x.marco).map((x) => x.marco)).toEqual(["PROPOSTA", "MONTANDO_CONTRATO", "GANHO", "PERDIDO"]);
    expect(projetos.fases.map((x) => x.marco)).toEqual(["HANDOFF", "EXECUCAO", null, null, null, "FINALIZADO"]);
  });

  it("marco não é removido nem muda de tipo; nome/cor/alerta sim; subfase continua livre", async () => {
    const { f } = await semeado();
    const g = await gestor();
    expect(await removerFase(f("proposta").id, {}, g)).toEqual({ ok: false, erro: "MARCO_FIXO" });
    expect(await removerFase(f("handoff").id, {}, g)).toEqual({ ok: false, erro: "MARCO_FIXO" });
    expect(await editarFase(f("contrato_assinado").id, { tipoTerminal: null })).toEqual({ ok: false, erro: "MARCO_FIXO" });
    expect(await editarFase(f("montando_contrato").id, { tipoTerminal: "GANHO" })).toEqual({ ok: false, erro: "MARCO_FIXO" });
    expect(await editarFase(f("contrato_assinado").id, { nome: "Ganho (contrato assinado)", cor: "#1e9b6b", limiteDiasAlerta: 3 })).toEqual({ ok: true });
    expect((await db.fase.findUniqueOrThrow({ where: { id: f("contrato_assinado").id } })).chave).toBe("contrato_assinado");
    expect(await removerFase(f("reuniao_intermediaria").id, {}, g)).toEqual({ ok: true, acao: "EXCLUIR" });
  });

  it("reordenar: subfase passa entre marcos; marco não sai da ordem; Handoff fica em primeiro", async () => {
    const { vendas, projetos, f } = await semeado();
    const ids = (p: { fases: { id: string }[] }) => p.fases.map((x) => x.id);
    // subfase para depois de Montando contrato: ok
    const v = ids(vendas).filter((id) => id !== f("em_negociacao").id);
    v.splice(v.indexOf(f("montando_contrato").id) + 1, 0, f("em_negociacao").id);
    expect(await reordenarFases(vendas.id, v)).toEqual({ ok: true });
    // Proposta depois de Montando contrato: recusa
    const troca = [...v];
    const [ip, imc] = [troca.indexOf(f("proposta").id), troca.indexOf(f("montando_contrato").id)];
    [troca[ip], troca[imc]] = [troca[imc], troca[ip]];
    expect(await reordenarFases(vendas.id, troca)).toEqual({ ok: false, erro: "ORDEM_MARCOS" });
    // botões: subir Proposta acima de uma subfase ok; Execução acima de Handoff não
    expect(await moverFase(f("proposta").id, "SUBIR")).toEqual({ ok: true });
    expect(await moverFase(f("execucao").id, "SUBIR")).toEqual({ ok: false, erro: "ORDEM_MARCOS" });
    expect(await moverFase(f("em_execucao").id, "SUBIR")).toEqual({ ok: true }); // fica entre Handoff e Execução
    expect(await moverFase(f("em_execucao").id, "SUBIR")).toEqual({ ok: false, erro: "ORDEM_MARCOS" }); // não passa de Handoff
    expect(projetos.fases[0].marco).toBe("HANDOFF");
  });

  it("WhatsApp: a lista de fases de Vendas (contexto da LLM) é a mesma da v1 — sem o marco Proposta", async () => {
    await semeado();
    const { FASES_DO_WHATSAPP } = await import("@/lib/whatsapp/ciclo-vendas");
    const fs = await db.fase.findMany({ where: { pipeline: { chave: "vendas" }, arquivadaEm: null, ...FASES_DO_WHATSAPP }, orderBy: { ordem: "asc" } });
    expect(fs.map((f) => f.chave)).toEqual([
      "primeiro_contato",
      "reuniao_diagnostica",
      "reuniao_intermediaria",
      "montando_proposta",
      "reuniao_proposta",
      "em_negociacao",
      "montando_contrato",
      "contrato_assinado",
      "perdido",
    ]);
  });
});

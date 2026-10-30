import { beforeEach, describe, expect, it } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { criarCard, moverCard } from "./projetos";

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
  await db.projeto.update({ where: { id: r.id }, data: { empresaId: empresa.id, contatoId: contato.id, estado: "SP", cidade: "Campinas" } });
  return { vendas, projetos, ana, bruno, empresa, contato, vendaId: r.id };
}

const fase = (p: { fases: { chave: string; id: string }[] }, chave: string) => p.fases.find((f) => f.chave === chave)!;
const tl = (projetoId: string) => db.timeline.findMany({ where: { projetoId }, orderBy: [{ em: "asc" }, { id: "asc" }] });
const projetosDe = (vendaId: string) => db.projeto.findMany({ where: { vendaOrigemId: vendaId } });

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

    const venda = await db.projeto.findUniqueOrThrow({ where: { id: vendaId } });
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
      vendaOrigemId: vendaId,
    });
    expect(p.faseDesde.getTime()).toBe(venda.dataGanho!.getTime());

    expect(await db.transicaoFase.findMany({ where: { projetoId: p.id } })).toMatchObject([
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
    const venda = await db.projeto.findUniqueOrThrow({ where: { id: vendaId } });
    expect(venda).toMatchObject({ faseId: fase(vendas, "em_negociacao").id, dataGanho: null });
    expect(await db.projeto.count()).toBe(1);
  });

  it("valor fechado opcional em BRL é gravado (com histórico); inválido recusa o movimento inteiro", async () => {
    const { vendas, ana, vendaId } = await semear();
    const ganho = fase(vendas, "contrato_assinado").id;

    expect(await moverCard(vendaId, ganho, ana, { dadosTerminal: { valorFechado: "quarenta mil" } })).toEqual({ ok: false, erro: "VALOR_FECHADO_INVALIDO" });
    const intacta = await db.projeto.findUniqueOrThrow({ where: { id: vendaId } });
    expect(intacta.faseId).toBe(fase(vendas, "em_negociacao").id);
    expect(intacta.dataGanho).toBeNull();
    expect(await db.projeto.count()).toBe(1);
    expect(await db.transicaoFase.count({ where: { projetoId: vendaId } })).toBe(1);

    expect((await moverCard(vendaId, ganho, ana, { dadosTerminal: { valorFechado: "R$ 45.000,50" } })).ok).toBe(true);
    const venda = await db.projeto.findUniqueOrThrow({ where: { id: vendaId } });
    expect(venda.valorFechado?.toFixed(2)).toBe("45000.50");
    const campos = (await tl(vendaId)).filter((t) => t.tipo === "CAMPO_ALTERADO").map((t) => t.payload);
    expect(campos).toEqual([
      { campo: "valorFechado", antes: null, depois: "45000.50" },
      expect.objectContaining({ campo: "dataGanho", antes: null }),
    ]);
  });

  it("idempotente: ganho → reabrir → ganho de novo = 1 card de projeto; reabrir MANTÉM data/valor; re-ganho atualiza a data", async () => {
    const { vendas, ana, bruno, vendaId } = await semear();
    const ganho = fase(vendas, "contrato_assinado").id;
    const negociacao = fase(vendas, "em_negociacao").id;

    await moverCard(vendaId, ganho, ana, { dadosTerminal: { valorFechado: "10.000" } });
    const [projeto] = await projetosDe(vendaId);
    const dataPrimeiroGanho = (await db.projeto.findUniqueOrThrow({ where: { id: vendaId } })).dataGanho!;

    expect(await moverCard(vendaId, negociacao, bruno)).toEqual({ ok: true, mudou: true, terminal: null });
    const reaberta = await db.projeto.findUniqueOrThrow({ where: { id: vendaId } });
    expect(reaberta.dataGanho).toEqual(dataPrimeiroGanho);
    expect(reaberta.valorFechado?.toFixed(2)).toBe("10000.00");
    // Na venda, só o movimento; nenhum campo mexido.
    expect((await tl(vendaId)).at(-1)!.tipo).toBe("MOVIMENTACAO");
    // O projeto continua onde estava, e a Timeline dele avisa quem reabriu a venda.
    expect(await db.projeto.findUniqueOrThrow({ where: { id: projeto.id } })).toMatchObject({ deletadoEm: null });
    expect((await tl(projeto.id)).at(-1)).toMatchObject({
      tipo: "VINCULO_PROJETO",
      usuarioId: bruno.id,
      payload: { vendaId, evento: "reaberta", paraFaseId: negociacao },
    });

    await new Promise((r) => setTimeout(r, 5));
    // Diálogo pré-preenche o valor guardado; o usuário confirma igual.
    expect((await moverCard(vendaId, ganho, ana, { dadosTerminal: { valorFechado: "10.000,00" } })).ok).toBe(true);
    expect(await projetosDe(vendaId)).toHaveLength(1);
    expect(await db.projeto.count()).toBe(2);
    const reganha = await db.projeto.findUniqueOrThrow({ where: { id: vendaId } });
    expect(reganha.dataGanho!.getTime()).toBeGreaterThan(dataPrimeiroGanho.getTime());
    expect(reganha.valorFechado?.toFixed(2)).toBe("10000.00");
    const finais = (await tl(vendaId)).slice(-3);
    expect(finais.map((t) => t.tipo)).toEqual(["MOVIMENTACAO", "CAMPO_ALTERADO", "VINCULO_PROJETO"]);
    expect(finais[1].payload).toEqual({ campo: "dataGanho", antes: dataPrimeiroGanho.toISOString(), depois: reganha.dataGanho!.toISOString() });
    expect(finais[2].payload).toEqual({ projetoId: projeto.id, criado: false });
    expect((await tl(projeto.id)).map((t) => [t.tipo, t.payload])).toEqual([
      ["CRIACAO", expect.objectContaining({ via: "GANHO", origemOportunidadeId: vendaId })],
      ["VINCULO_PROJETO", { vendaId, evento: "reaberta", paraFaseId: negociacao }],
      ["VINCULO_PROJETO", { vendaId, criado: false }],
    ]);
    // Histórico completo das transições da venda: criação, ganho, reabertura, ganho.
    expect(await db.transicaoFase.count({ where: { projetoId: vendaId } })).toBe(4);
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
    expect(await db.timeline.count({ where: { projetoId: vendaId, tipo: "VINCULO_PROJETO" } })).toBe(1);
  });

  it("outro escritor liga um projeto à venda no meio do ganho (P2002 no índice único) → sucesso idempotente, sem duplicar", async () => {
    const { vendas, projetos, ana, vendaId } = await semear();
    // Um INSERT em projeto esbarra no lock de pipeline (FK → KEY SHARE na
    // linha do pipeline), então a corrida real é de quem LIGA um card existente
    // à venda (ex.: import/LLM preenchendo origem_oportunidade_id): o UPDATE não
    // toca o pipeline. A transação dele segura a linha (não commitada): o ganho
    // não a vê, bloqueia no índice único ao inserir e recebe P2002 no commit dela.
    const solto = await db.projeto.create({
      data: { pipelineId: projetos.id, faseId: fase(projetos, "em_execucao").id, titulo: "Import", responsavelId: ana.id, criadoVia: "IMPORT" },
    });
    let commitEm = 0;
    const intruso = db.$transaction(async (tx) => {
      await tx.projeto.update({ where: { id: solto.id }, data: { vendaOrigemId: vendaId } });
      await tx.$executeRaw`SELECT pg_sleep(0.6)`;
      commitEm = Date.now();
    });
    await new Promise((r) => setTimeout(r, 150));
    const r = await moverCard(vendaId, fase(vendas, "contrato_assinado").id, ana, { dadosTerminal: { valorFechado: "100" } });
    const fimEm = Date.now();
    await intruso;
    expect(commitEm).toBeGreaterThan(0);
    expect(fimEm).toBeGreaterThanOrEqual(commitEm); // o ganho de fato esperou o intruso
    expect(r).toEqual({ ok: true, mudou: true, terminal: "GANHO" });
    const ps = await projetosDe(vendaId);
    expect(ps.map((p) => p.id)).toEqual([solto.id]);
    expect(await db.projeto.count()).toBe(2);
    const venda = await db.projeto.findUniqueOrThrow({ where: { id: vendaId } });
    expect(venda.faseId).toBe(fase(vendas, "contrato_assinado").id);
    expect(venda.valorFechado?.toFixed(2)).toBe("100.00");
    expect(await db.transicaoFase.count({ where: { projetoId: vendaId } })).toBe(2);
    expect((await tl(vendaId)).at(-1)!.payload).toEqual({ projetoId: solto.id, criado: false });
  });

  it("projeto soft-deletado não é recriado no re-ganho (um projeto por venda, para sempre)", async () => {
    const { vendas, ana, vendaId } = await semear();
    const ganho = fase(vendas, "contrato_assinado").id;
    await moverCard(vendaId, ganho, ana, { dadosTerminal: {} });
    const [projeto] = await projetosDe(vendaId);
    await db.projeto.update({ where: { id: projeto.id }, data: { deletadoEm: new Date() } });
    await moverCard(vendaId, fase(vendas, "em_negociacao").id, ana);
    expect((await moverCard(vendaId, ganho, ana, { dadosTerminal: {} })).ok).toBe(true);
    expect(await projetosDe(vendaId)).toHaveLength(1);
    expect((await tl(vendaId)).at(-1)!.payload).toEqual({ projetoId: projeto.id, criado: false });
  });

  it("o banco garante: dois projetos com a mesma origem → violação de unicidade", async () => {
    const { projetos, ana, vendaId } = await semear();
    const dados = { pipelineId: projetos.id, faseId: fase(projetos, "em_execucao").id, titulo: "P", responsavelId: ana.id, criadoVia: "UI" as const, vendaOrigemId: vendaId };
    await db.projeto.create({ data: dados });
    await expect(db.projeto.create({ data: dados })).rejects.toMatchObject({ code: "P2002" });
  });

  it("fase inicial de projetos (em_execucao) arquivada ou ausente → erro de regra, nada muda", async () => {
    const { vendas, projetos, ana, vendaId } = await semear();
    const ganho = fase(vendas, "contrato_assinado").id;
    await db.fase.update({ where: { id: fase(projetos, "em_execucao").id }, data: { arquivadaEm: new Date() } });
    expect(await moverCard(vendaId, ganho, ana, { dadosTerminal: {} })).toEqual({ ok: false, erro: "FASE_INICIAL_PROJETOS_INDISPONIVEL" });

    await db.fase.delete({ where: { id: fase(projetos, "em_execucao").id } });
    expect(await moverCard(vendaId, ganho, ana, { dadosTerminal: {} })).toEqual({ ok: false, erro: "FASE_INICIAL_PROJETOS_INDISPONIVEL" });

    const venda = await db.projeto.findUniqueOrThrow({ where: { id: vendaId } });
    expect(venda.faseId).toBe(fase(vendas, "em_negociacao").id);
    expect(venda.dataGanho).toBeNull();
    expect(await db.projeto.count()).toBe(1);
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
    const intacta = await db.projeto.findUniqueOrThrow({ where: { id: vendaId } });
    expect(intacta.faseId).toBe(fase(vendas, "em_negociacao").id);
    expect(intacta.motivoPerda).toBeNull();
    expect(await db.transicaoFase.count({ where: { projetoId: vendaId } })).toBe(1);
  });

  it("grava motivo_perda com histórico; não cria projeto; reabrir MANTÉM o motivo", async () => {
    const { vendas, ana, vendaId } = await semear();
    const r = await moverCard(vendaId, fase(vendas, "perdido").id, ana, { dadosTerminal: { motivo: "concorrente", detalhe: "fechou com a X" } });
    expect(r).toEqual({ ok: true, mudou: true, terminal: "PERDIDO" });
    expect((await db.projeto.findUniqueOrThrow({ where: { id: vendaId } })).motivoPerda).toBe("Concorrente: fechou com a X");
    expect((await tl(vendaId)).at(-1)!.payload).toEqual({ campo: "motivoPerda", antes: null, depois: "Concorrente: fechou com a X" });
    expect(await projetosDe(vendaId)).toHaveLength(0);

    await moverCard(vendaId, fase(vendas, "primeiro_contato").id, ana);
    expect((await db.projeto.findUniqueOrThrow({ where: { id: vendaId } })).motivoPerda).toBe("Concorrente: fechou com a X");
    expect((await tl(vendaId)).at(-1)!.tipo).toBe("MOVIMENTACAO");

    // Re-perda com outro motivo sobrescreve, com histórico.
    await moverCard(vendaId, fase(vendas, "perdido").id, ana, { dadosTerminal: { motivo: "timing" } });
    expect((await tl(vendaId)).at(-1)!.payload).toEqual({ campo: "motivoPerda", antes: "Concorrente: fechou com a X", depois: "Timing" });
  });

  it("ganho → perdido direto: mantém data/valor do ganho, grava motivo, mantém o projeto e avisa na Timeline dele", async () => {
    const { vendas, ana, vendaId } = await semear();
    await moverCard(vendaId, fase(vendas, "contrato_assinado").id, ana, { dadosTerminal: { valorFechado: "500" } });
    expect((await moverCard(vendaId, fase(vendas, "perdido").id, ana, { dadosTerminal: { motivo: "timing" } })).ok).toBe(true);
    const venda = await db.projeto.findUniqueOrThrow({ where: { id: vendaId } });
    expect(venda.motivoPerda).toBe("Timing");
    expect(venda.dataGanho).not.toBeNull();
    expect(venda.valorFechado?.toFixed(2)).toBe("500.00");
    const [projeto] = await projetosDe(vendaId);
    expect((await tl(projeto.id)).at(-1)!.payload).toEqual({ vendaId, evento: "perdida", paraFaseId: fase(vendas, "perdido").id });
  });
});

describe("projetos", () => {
  it("mover projeto para o terminal (finalizado) não pede dados nem cria nada", async () => {
    const { vendas, projetos, ana, vendaId } = await semear();
    await moverCard(vendaId, fase(vendas, "contrato_assinado").id, ana, { dadosTerminal: {} });
    const [projeto] = await projetosDe(vendaId);
    expect(await moverCard(projeto.id, fase(projetos, "finalizado").id, ana)).toEqual({ ok: true, mudou: true, terminal: "GANHO" });
    const p = await db.projeto.findUniqueOrThrow({ where: { id: projeto.id } });
    expect(p).toMatchObject({ faseId: fase(projetos, "finalizado").id, dataGanho: null, valorFechado: null });
    expect(await db.projeto.count()).toBe(2);
    expect(await projetosDe(projeto.id)).toHaveLength(0);
  });
});

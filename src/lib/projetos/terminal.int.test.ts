import { beforeEach, describe, expect, it } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { criarCard, listarQuadro, moverCard } from "./projetos";

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
          { chave: "contrato_assinado", nome: "Contrato assinado", ordem: 2, isTerminal: true, tipoTerminal: "GANHO", marco: "GANHO" },
          { chave: "perdido", nome: "Perdido", ordem: 3, isTerminal: true, tipoTerminal: "PERDIDO", marco: "PERDIDO" },
        ],
      },
    },
    include: { fases: true },
  });
  // GAB-81: o ganho leva o card ao marco Handoff, achado pelo marco (não pela chave/posição).
  const projetos = await db.pipeline.create({
    data: {
      chave: "projetos",
      nome: "Projetos",
      ordem: 1,
      fases: {
        create: [
          { chave: "recepcao", nome: "Recepção", ordem: 0, marco: "HANDOFF" },
          { chave: "em_execucao", nome: "Em execução", ordem: 1 },
          { chave: "finalizado", nome: "Finalizado", ordem: 2, isTerminal: true, tipoTerminal: "GANHO", marco: "FINALIZADO" },
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

describe("ganho em vendas (ciclo único, GAB-81)", () => {
  it("grava data_ganho e o MESMO card segue para o Handoff de Projetos; nenhum card novo", async () => {
    const { vendas, projetos, ana, bruno, empresa, vendaId } = await semear();
    const antes = Date.now();
    const r = await moverCard(vendaId, fase(vendas, "contrato_assinado").id, bruno, { dadosTerminal: {} });
    expect(r).toEqual({ ok: true, mudou: true, terminal: "GANHO" });

    const card = await db.projeto.findUniqueOrThrow({ where: { id: vendaId } });
    expect(card).toMatchObject({ pipelineId: projetos.id, faseId: fase(projetos, "recepcao").id, responsavelId: ana.id, empresaId: empresa.id, valorFechado: null });
    expect(card.dataGanho!.getTime()).toBeGreaterThanOrEqual(antes - 1000);
    expect(card.faseDesde.getTime()).toBeGreaterThan(card.dataGanho!.getTime());
    expect(await db.projeto.count()).toBe(1);

    const ts = await db.transicaoFase.findMany({ where: { projetoId: vendaId }, orderBy: { em: "asc" } });
    expect(ts.map((t) => [t.deFaseId, t.paraFaseId, t.origem])).toEqual([
      [null, fase(vendas, "em_negociacao").id, "UI"],
      [fase(vendas, "em_negociacao").id, fase(vendas, "contrato_assinado").id, "UI"],
      [fase(vendas, "contrato_assinado").id, fase(projetos, "recepcao").id, "SISTEMA"],
    ]);
    const tv = await tl(vendaId);
    expect(tv.map((t) => t.tipo)).toEqual(["CRIACAO", "MOVIMENTACAO", "CAMPO_ALTERADO", "MOVIMENTACAO"]);
    expect(tv[2].payload).toMatchObject({ campo: "dataGanho", antes: null, depois: card.dataGanho!.toISOString() });
    expect(tv[3]).toMatchObject({
      usuarioId: bruno.id,
      payload: { deFaseId: fase(vendas, "contrato_assinado").id, paraFaseId: fase(projetos, "recepcao").id, motivo: "ganho_handoff" },
    });
    // Aparece em exatamente um quadro.
    expect((await listarQuadro("vendas"))!.cards.map((c) => c.id)).toEqual([]);
    expect((await listarQuadro("projetos"))!.cards.map((c) => c.id)).toEqual([vendaId]);
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

  it("card ganho está em Projetos: fase de Vendas (reabrir, perder, ganhar de novo) não é destino pelo Kanban", async () => {
    const { vendas, ana, vendaId } = await semear();
    await moverCard(vendaId, fase(vendas, "contrato_assinado").id, ana, { dadosTerminal: { valorFechado: "10.000" } });
    for (const chave of ["em_negociacao", "contrato_assinado", "perdido"]) {
      expect(await moverCard(vendaId, fase(vendas, chave).id, ana, { dadosTerminal: { motivo: "timing" } })).toEqual({ ok: false, erro: "FASE_DE_OUTRO_PIPELINE" });
    }
    expect(await db.projeto.count()).toBe(1);
  });

  it("dois ganhos concorrentes do mesmo card: um só passa (o outro é recusado), um só Handoff", async () => {
    const { vendas, projetos, ana, bruno, vendaId } = await semear();
    const ganho = fase(vendas, "contrato_assinado").id;
    const rs = await Promise.all([
      moverCard(vendaId, ganho, ana, { dadosTerminal: {} }),
      moverCard(vendaId, ganho, bruno, { dadosTerminal: {} }),
    ]);
    expect(rs.filter((r) => r.ok && r.mudou)).toHaveLength(1);
    expect(rs.filter((r) => !r.ok).map((r) => !r.ok && r.erro)).toEqual([expect.stringMatching(/^(CONFLITO_CONCORRENTE|FASE_DE_OUTRO_PIPELINE)$/)]);
    expect(await db.projeto.count()).toBe(1);
    expect(await db.transicaoFase.count({ where: { projetoId: vendaId, paraFaseId: fase(projetos, "recepcao").id } })).toBe(1);
  });

  it("o banco ainda garante (coluna da v1): dois projetos com a mesma origem → violação de unicidade", async () => {
    const { projetos, ana, vendaId } = await semear();
    const dados = { pipelineId: projetos.id, faseId: fase(projetos, "em_execucao").id, titulo: "P", responsavelId: ana.id, criadoVia: "UI" as const, vendaOrigemId: vendaId };
    await db.projeto.create({ data: dados });
    await expect(db.projeto.create({ data: dados })).rejects.toMatchObject({ code: "P2002" });
  });

  it("re-ganho de venda de par NÃO unido: segue para o Handoff e avisa nos dois cards; o projeto anterior não é mexido", async () => {
    const { vendas, projetos, ana, bruno, vendaId } = await semear();
    const anterior = await db.projeto.create({
      data: { pipelineId: projetos.id, faseId: fase(projetos, "em_execucao").id, titulo: "Site (projeto v1)", responsavelId: bruno.id, criadoVia: "UI", vendaOrigemId: vendaId },
    });
    expect(await moverCard(vendaId, fase(vendas, "contrato_assinado").id, ana, { dadosTerminal: {} })).toMatchObject({ ok: true, mudou: true });
    expect(await db.projeto.findUniqueOrThrow({ where: { id: vendaId } })).toMatchObject({ faseId: fase(projetos, "recepcao").id, vendedorId: ana.id });
    expect(await db.projeto.findUniqueOrThrow({ where: { id: anterior.id } })).toMatchObject({ faseId: fase(projetos, "em_execucao").id, deletadoEm: null, vendaOrigemId: vendaId });
    expect((await tl(vendaId)).at(-1)).toMatchObject({ tipo: "VINCULO_PROJETO", usuarioId: ana.id, payload: { evento: "reganho_projeto_existente", projetoId: anterior.id } });
    expect((await tl(anterior.id)).at(-1)).toMatchObject({ tipo: "VINCULO_PROJETO", usuarioId: ana.id, payload: { evento: "reganho_projeto_existente", vendaId } });
    // Sem par anterior vivo (ou absorvido), nada de aviso.
    expect(await db.timeline.count({ where: { tipo: "VINCULO_PROJETO" } })).toBe(2);
  });

  it("marco Handoff arquivado ou ausente → erro de regra, nada muda", async () => {
    const { vendas, projetos, ana, vendaId } = await semear();
    const ganho = fase(vendas, "contrato_assinado").id;
    await db.fase.update({ where: { id: fase(projetos, "recepcao").id }, data: { arquivadaEm: new Date() } });
    expect(await moverCard(vendaId, ganho, ana, { dadosTerminal: {} })).toEqual({ ok: false, erro: "FASE_HANDOFF_INDISPONIVEL" });

    await db.fase.update({ where: { id: fase(projetos, "recepcao").id }, data: { arquivadaEm: null, marco: null } });
    expect(await moverCard(vendaId, ganho, ana, { dadosTerminal: {} })).toEqual({ ok: false, erro: "FASE_HANDOFF_INDISPONIVEL" });

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
});

describe("projetos", () => {
  it("o card ganho segue em Projetos até o terminal (finalizado), sem pedir dados nem criar nada; data do ganho fica", async () => {
    const { vendas, projetos, ana, vendaId } = await semear();
    await moverCard(vendaId, fase(vendas, "contrato_assinado").id, ana, { dadosTerminal: { valorFechado: "500" } });
    expect(await moverCard(vendaId, fase(projetos, "em_execucao").id, ana)).toEqual({ ok: true, mudou: true, terminal: null });
    expect(await moverCard(vendaId, fase(projetos, "finalizado").id, ana)).toEqual({ ok: true, mudou: true, terminal: "GANHO" });
    const p = await db.projeto.findUniqueOrThrow({ where: { id: vendaId } });
    expect(p).toMatchObject({ faseId: fase(projetos, "finalizado").id });
    expect(p.dataGanho).not.toBeNull();
    expect(p.valorFechado?.toFixed(2)).toBe("500.00");
    expect(await db.projeto.count()).toBe(1);
  });
});

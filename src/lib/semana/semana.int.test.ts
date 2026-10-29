import { beforeEach, describe, expect, it } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { inicioDoDia } from "@/lib/oportunidades/campos";
import { definirProximaAcao, marcarAcaoFeita } from "@/lib/oportunidades/feita";
import { carregarSemana, resolverVendedor } from "./semana";

const db = dbTeste();
const sp = (iso: string) => new Date(`${iso}-03:00`);
const dia = (d: string) => inicioDoDia(d)!;

async function semear() {
  const vendas = await db.pipeline.create({
    data: {
      chave: "vendas",
      nome: "Vendas",
      ordem: 0,
      fases: {
        create: [
          { chave: "primeiro_contato", nome: "Primeiro Contato", ordem: 0, limiteDiasAlerta: 7 },
          { chave: "contrato_assinado", nome: "Contrato assinado", ordem: 1, isTerminal: true, tipoTerminal: "GANHO" },
          { chave: "perdido", nome: "Perdido", ordem: 2, isTerminal: true, tipoTerminal: "PERDIDO" },
        ],
      },
    },
    include: { fases: true },
  });
  const projetos = await db.pipeline.create({
    data: { chave: "projetos", nome: "Projetos", ordem: 1, fases: { create: [{ chave: "em_execucao", nome: "Em execução", ordem: 0 }] } },
    include: { fases: true },
  });
  const ana = await db.usuario.create({ data: { nome: "Ana Vendas", email: "ana@ij.test" } });
  const bruno = await db.usuario.create({ data: { nome: "Bruno Lima", email: "bruno@ij.test" } });
  const gestora = await db.usuario.create({ data: { nome: "Gil Gestora", email: "gil@ij.test", papel: "GESTOR" } });
  const admin = await db.usuario.create({ data: { nome: "Alice Admin", email: "alice@ij.test", papel: "ADMIN" } });
  const inativo = await db.usuario.create({ data: { nome: "Ivo Inativo", email: "ivo@ij.test", ativo: false } });
  const empresa = await db.empresa.create({ data: { nome: "Padaria do Zé" } });
  return { vendas, projetos, ana, bruno, gestora, admin, inativo, empresa };
}

type S = Awaited<ReturnType<typeof semear>>;
const fase = (p: { fases: { chave: string; id: string }[] }, chave: string) => p.fases.find((f) => f.chave === chave)!.id;

async function card(s: S, titulo: string, extra: { responsavelId?: string; faseChave?: string; proximaAcao?: string | null; dia?: string | null; deletado?: boolean; projeto?: boolean; empresa?: boolean } = {}) {
  const pipeline = extra.projeto ? s.projetos : s.vendas;
  return db.oportunidade.create({
    data: {
      titulo,
      pipelineId: pipeline.id,
      faseId: fase(pipeline, extra.faseChave ?? (extra.projeto ? "em_execucao" : "primeiro_contato")),
      responsavelId: extra.responsavelId ?? s.ana.id,
      criadoVia: "UI",
      proximaAcao: extra.proximaAcao === undefined ? `ação ${titulo}` : extra.proximaAcao,
      proximaAcaoEm: extra.dia ? dia(extra.dia) : null,
      deletadoEm: extra.deletado ? new Date() : null,
      empresaId: extra.empresa ? s.empresa.id : null,
    },
  });
}

beforeEach(async () => {
  await limparBanco(["transicao_fase", "timeline", "oportunidade", "fase", "pipeline", "empresa", "sessao", "usuario"]);
  invalidarCachePipelines();
});

describe("carregarSemana", () => {
  it("só cards do responsável, vivos e em fase aberta (vendas e projetos), agrupados por dia de SP", async () => {
    const s = await semear();
    await card(s, "vencida", { dia: "2026-10-20", empresa: true });
    await card(s, "hoje", { dia: "2026-10-24" });
    await card(s, "semana", { dia: "2026-10-30", projeto: true });
    await card(s, "longe", { dia: "2026-12-01" });
    await card(s, "sem", { proximaAcao: null, dia: null });
    await card(s, "de outro", { dia: "2026-10-19", responsavelId: s.bruno.id });
    await card(s, "excluido", { dia: "2026-10-18", deletado: true });
    await card(s, "ganho", { dia: "2026-10-18", faseChave: "contrato_assinado" });
    await card(s, "perdido", { dia: "2026-10-18", faseChave: "perdido" });

    // 23:59 de SP = 02:59 UTC do dia 25 (testes rodam com TZ=UTC).
    const semana = await carregarSemana(s.ana.id, sp("2026-10-24T23:59:00"));
    expect(semana.destaque?.titulo).toBe("vencida");
    expect(semana.destaque).toMatchObject({ pipeline: { nome: "Vendas" }, fase: { nome: "Primeiro Contato" }, empresa: { nome: "Padaria do Zé" }, proximaAcao: "ação vencida" });
    expect(semana.hoje.map((c) => c.titulo)).toEqual(["hoje"]);
    expect(semana.semana.map((c) => c.titulo)).toEqual(["semana"]);
    expect(semana.semana[0].pipeline.nome).toBe("Projetos");
    expect(semana.sem.map((c) => c.titulo)).toEqual(["sem"]);
    expect(semana.depois).toBe(1);
    expect(semana.totais).toEqual({ vencida: 1, hoje: 1, semana: 1, sem: 1 });
  });
});

describe("resolverVendedor (filtro de vendedor)", () => {
  it("vendedor pedindo outro id vê só a própria semana", async () => {
    const s = await semear();
    const r = await resolverVendedor({ id: s.ana.id, papel: "VENDEDOR" }, s.bruno.id);
    expect(r.alvo).toEqual({ id: s.ana.id, nome: "Ana Vendas" });
    expect(r.podeTrocar).toBe(false);
    expect(r.opcoes).toEqual([]);
  });

  it("gestor e admin escolhem qualquer usuário ativo; opções sem inativos", async () => {
    const s = await semear();
    const g = await resolverVendedor({ id: s.gestora.id, papel: "GESTOR" }, s.bruno.id);
    expect(g.alvo).toEqual({ id: s.bruno.id, nome: "Bruno Lima" });
    expect(g.podeTrocar).toBe(true);
    expect(g.opcoes.map((o) => o.nome)).toEqual(["Alice Admin", "Ana Vendas", "Bruno Lima", "Gil Gestora"]);

    const a = await resolverVendedor({ id: s.admin.id, papel: "ADMIN" }, s.ana.id);
    expect(a.alvo.id).toBe(s.ana.id);
  });

  it("gestor pedindo inativo, inexistente ou nada → a própria semana", async () => {
    const s = await semear();
    for (const pedido of [s.inativo.id, "nao-existe", undefined, ""]) {
      const r = await resolverVendedor({ id: s.gestora.id, papel: "GESTOR" }, pedido);
      expect(r.alvo.id).toBe(s.gestora.id);
    }
  });

  it("VISUALIZADOR troca de semana, não está nas opções e, sem pedido válido, abre na do primeiro da lista", async () => {
    const s = await semear();
    const vera = await db.usuario.create({ data: { nome: "Vera Visualizadora", email: "vera@ij.test", papel: "VISUALIZADOR" } });
    const r = await resolverVendedor({ id: vera.id, papel: "VISUALIZADOR" }, s.bruno.id);
    expect(r.alvo).toEqual({ id: s.bruno.id, nome: "Bruno Lima" });
    expect(r.podeTrocar).toBe(true);
    expect(r.opcoes.map((o) => o.nome)).toEqual(["Alice Admin", "Ana Vendas", "Bruno Lima", "Gil Gestora"]);
    for (const pedido of [vera.id, undefined]) expect((await resolverVendedor({ id: vera.id, papel: "VISUALIZADOR" }, pedido)).alvo.nome).toBe("Alice Admin");
  });
});

describe("marcarAcaoFeita", () => {
  it("grava NOTA 'Feito: <ação>' com autor e a nova próxima ação (CAMPO_ALTERADO), na mesma transação", async () => {
    const s = await semear();
    const c = await card(s, "x", { proximaAcao: "Ligar para o Zé", dia: "2026-10-20" });
    const antes = Date.now();
    const r = await marcarAcaoFeita(
      c.id,
      { proximaAcao: "Ligar para o Zé", dia: "2026-10-20" },
      { tipo: "nova", proximaAcao: "Enviar proposta", proximaAcaoEm: dia("2026-10-28") },
      s.gestora,
    );
    expect(r).toEqual({ ok: true });

    const op = await db.oportunidade.findUniqueOrThrow({ where: { id: c.id } });
    expect(op.proximaAcao).toBe("Enviar proposta");
    expect(op.proximaAcaoEm).toEqual(dia("2026-10-28"));

    const tl = await db.timeline.findMany({ where: { oportunidadeId: c.id }, orderBy: [{ em: "asc" }, { id: "asc" }] });
    expect(tl.map((t) => t.tipo)).toEqual(["NOTA", "CAMPO_ALTERADO", "CAMPO_ALTERADO"]);
    expect(tl[0]).toMatchObject({
      usuarioId: s.gestora.id,
      payload: { texto: "Feito: Ligar para o Zé\nPróxima: Enviar proposta (28/10/2026)", feito: { acao: "Ligar para o Zé", dia: "2026-10-20" }, proxima: { acao: "Enviar proposta", dia: "2026-10-28" } },
    });
    expect(tl[0].em.getTime()).toBeGreaterThanOrEqual(antes - 1000);
    expect(tl[1].payload).toEqual({ campo: "proximaAcao", antes: "Ligar para o Zé", depois: "Enviar proposta" });
    expect(tl[2].payload).toEqual({ campo: "proximaAcaoEm", antes: "2026-10-20", depois: "2026-10-28" });
  });

  it("'deixar sem próxima ação' fica registrado explicitamente", async () => {
    const s = await semear();
    const c = await card(s, "x", { proximaAcao: "Visitar", dia: "2026-10-24" });
    expect(await marcarAcaoFeita(c.id, { proximaAcao: "Visitar", dia: "2026-10-24" }, { tipo: "nenhuma" }, s.ana)).toEqual({ ok: true });

    const op = await db.oportunidade.findUniqueOrThrow({ where: { id: c.id } });
    expect(op.proximaAcao).toBeNull();
    expect(op.proximaAcaoEm).toBeNull();
    const tl = await db.timeline.findMany({ where: { oportunidadeId: c.id }, orderBy: [{ em: "asc" }, { id: "asc" }] });
    expect(tl[0].payload).toMatchObject({ texto: "Feito: Visitar\nSem próxima ação definida.", proxima: null });
    expect(tl.slice(1).map((t) => t.payload)).toEqual([
      { campo: "proximaAcao", antes: "Visitar", depois: null },
      { campo: "proximaAcaoEm", antes: "2026-10-24", depois: null },
    ]);
  });

  it("ação sem descrição (só data) também pode ser marcada feita", async () => {
    const s = await semear();
    const c = await card(s, "x", { proximaAcao: null, dia: "2026-10-24" });
    expect(await marcarAcaoFeita(c.id, { proximaAcao: null, dia: "2026-10-24" }, { tipo: "nenhuma" }, s.ana)).toEqual({ ok: true });
    const nota = await db.timeline.findFirstOrThrow({ where: { oportunidadeId: c.id, tipo: "NOTA" } });
    expect((nota.payload as { texto: string }).texto).toBe("Feito: próxima ação de 24/10/2026\nSem próxima ação definida.");
  });

  it("recusa se a próxima ação mudou desde que a tela carregou (nada gravado)", async () => {
    const s = await semear();
    const c = await card(s, "x", { proximaAcao: "Ligar", dia: "2026-10-24" });
    expect(await marcarAcaoFeita(c.id, { proximaAcao: "Ligar", dia: "2026-10-23" }, { tipo: "nenhuma" }, s.ana)).toEqual({ ok: false, erro: "ACAO_MUDOU" });
    expect(await marcarAcaoFeita(c.id, { proximaAcao: "Outra", dia: "2026-10-24" }, { tipo: "nenhuma" }, s.ana)).toEqual({ ok: false, erro: "ACAO_MUDOU" });
    expect(await db.timeline.count()).toBe(0);
    expect((await db.oportunidade.findUniqueOrThrow({ where: { id: c.id } })).proximaAcao).toBe("Ligar");
  });

  it("sem próxima ação, soft-deletado ou inexistente → erro, nada gravado", async () => {
    const s = await semear();
    const vazio = await card(s, "vazio", { proximaAcao: null, dia: null });
    const excluido = await card(s, "excluido", { proximaAcao: "Ligar", dia: "2026-10-24", deletado: true });
    expect(await marcarAcaoFeita(vazio.id, { proximaAcao: null, dia: null }, { tipo: "nenhuma" }, s.ana)).toEqual({ ok: false, erro: "SEM_PROXIMA_ACAO" });
    expect(await marcarAcaoFeita(excluido.id, { proximaAcao: "Ligar", dia: "2026-10-24" }, { tipo: "nenhuma" }, s.ana)).toEqual({ ok: false, erro: "CARD_NAO_ENCONTRADO" });
    expect(await marcarAcaoFeita("nao-existe", { proximaAcao: "Ligar", dia: "2026-10-24" }, { tipo: "nenhuma" }, s.ana)).toEqual({ ok: false, erro: "CARD_NAO_ENCONTRADO" });
    expect(await db.timeline.count()).toBe(0);
  });

  it("depois de feita, o card sai de 'vencidas' e entra na faixa da nova data", async () => {
    const s = await semear();
    const c = await card(s, "x", { proximaAcao: "Ligar", dia: "2026-10-20" });
    await marcarAcaoFeita(c.id, { proximaAcao: "Ligar", dia: "2026-10-20" }, { tipo: "nova", proximaAcao: "Reunião", proximaAcaoEm: dia("2026-10-26") }, s.ana);
    const semana = await carregarSemana(s.ana.id, sp("2026-10-24T12:00:00"));
    expect(semana.totais.vencida).toBe(0);
    expect(semana.destaque).toMatchObject({ id: c.id, proximaAcao: "Reunião" });
    expect(semana.destaqueFaixa).toBe("semana");
  });
});

describe("definirProximaAcao (card sem próxima ação)", () => {
  it("define ação + data juntas, cada uma com CAMPO_ALTERADO, sem NOTA", async () => {
    const s = await semear();
    const c = await card(s, "x", { proximaAcao: null, dia: null });
    expect(await definirProximaAcao(c.id, { proximaAcao: "Ligar", proximaAcaoEm: dia("2026-10-27") }, s.ana)).toEqual({ ok: true });
    const op = await db.oportunidade.findUniqueOrThrow({ where: { id: c.id } });
    expect(op.proximaAcao).toBe("Ligar");
    expect(op.proximaAcaoEm).toEqual(dia("2026-10-27"));
    const tl = await db.timeline.findMany({ where: { oportunidadeId: c.id }, orderBy: [{ em: "asc" }, { id: "asc" }] });
    expect(tl.map((t) => t.tipo)).toEqual(["CAMPO_ALTERADO", "CAMPO_ALTERADO"]);
  });

  it("corrida: alguém definiu a próxima ação depois do render → ACAO_MUDOU, nada sobrescrito", async () => {
    const s = await semear();
    const c = await card(s, "x", { proximaAcao: null, dia: null });
    // Outra aba define primeiro.
    await db.oportunidade.update({ where: { id: c.id }, data: { proximaAcao: "Da outra aba", proximaAcaoEm: dia("2026-10-26") } });
    expect(await definirProximaAcao(c.id, { proximaAcao: "Minha", proximaAcaoEm: dia("2026-10-27") }, s.ana)).toEqual({ ok: false, erro: "ACAO_MUDOU" });
    const op = await db.oportunidade.findUniqueOrThrow({ where: { id: c.id } });
    expect(op.proximaAcao).toBe("Da outra aba");
    expect(op.proximaAcaoEm).toEqual(dia("2026-10-26"));
    expect(await db.timeline.count()).toBe(0);

    // Só a data preenchida também conta como "mudou".
    const d = await card(s, "y", { proximaAcao: null, dia: "2026-10-28" });
    expect(await definirProximaAcao(d.id, { proximaAcao: "Minha", proximaAcaoEm: dia("2026-10-27") }, s.ana)).toEqual({ ok: false, erro: "ACAO_MUDOU" });
  });

  it("duas abas ao mesmo tempo no mesmo card: só uma grava", async () => {
    const s = await semear();
    const c = await card(s, "x", { proximaAcao: null, dia: null });
    const rs = await Promise.all([
      definirProximaAcao(c.id, { proximaAcao: "A", proximaAcaoEm: dia("2026-10-27") }, s.ana),
      definirProximaAcao(c.id, { proximaAcao: "B", proximaAcaoEm: dia("2026-10-28") }, s.bruno),
    ]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.filter((r) => !r.ok)).toEqual([{ ok: false, erro: "ACAO_MUDOU" }]);
    expect(await db.timeline.count()).toBe(2);
  });

  it("soft-deletado → CARD_NAO_ENCONTRADO", async () => {
    const s = await semear();
    const c = await card(s, "x", { proximaAcao: null, dia: null, deletado: true });
    expect(await definirProximaAcao(c.id, { proximaAcao: "A", proximaAcaoEm: dia("2026-10-27") }, s.ana)).toEqual({ ok: false, erro: "CARD_NAO_ENCONTRADO" });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { diaEmFuso } from "@/lib/projetos/aging";
import { marcarAcaoFeita } from "@/lib/projetos/feita";
import { criarCard, moverCard } from "@/lib/projetos/projetos";
import { obterConfiguracao } from "@/lib/configuracao/servico";
import { CONFIG_RANKING, CONFIG_RANKING_PADRAO } from "./config";
import { resolverPeriodo } from "./periodo";
import { carregarDados, carregarRanking, carregarTop3, listarParticipantes, obterConfigRanking, podeVerRanking, salvarConfigRanking } from "./servico";

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
          { chave: "contrato_b", nome: "Contrato (novo)", ordem: 4, isTerminal: true, tipoTerminal: "GANHO" },
        ],
      },
    },
    include: { fases: true },
  });
  // GAB-81: o ganho leva o card ao Handoff de Projetos; a parte de vendas continua pontuando.
  const projetos = await db.pipeline.create({
    data: {
      chave: "projetos",
      nome: "Projetos",
      ordem: 1,
      fases: { create: [{ chave: "handoff", nome: "Handoff", ordem: 0, marco: "HANDOFF" }, { chave: "em_execucao", nome: "Em execução", ordem: 1 }] },
    },
    include: { fases: true },
  });
  const ana = await db.usuario.create({ data: { nome: "Ana Vendas", email: "ana@ij.test" } });
  const bruno = await db.usuario.create({ data: { nome: "Bruno Lima", email: "bruno@ij.test" } });
  const gil = await db.usuario.create({ data: { nome: "Gil Gestor", email: "gil@ij.test", papel: "GESTOR" } });
  const gaia = await db.usuario.create({ data: { nome: "Gaia Sem Cards", email: "gaia@ij.test", papel: "GESTOR" } });
  const ivo = await db.usuario.create({ data: { nome: "Ivo Inativo", email: "ivo@ij.test", ativo: false } });
  return { vendas, projetos, ana, bruno, gil, gaia, ivo };
}

type S = Awaited<ReturnType<typeof semear>>;
const fase = (s: S, chave: string) => s.vendas.fases.find((f) => f.chave === chave)!.id;

async function novoCard(s: S, por: { id: string }, titulo: string) {
  const r = await criarCard({ pipelineId: s.vendas.id, faseId: fase(s, "primeiro_contato"), titulo }, por);
  if (!r.ok) throw new Error(r.erro);
  return r.id;
}

async function ok<T extends { ok: boolean }>(p: Promise<T>) {
  const r = await p;
  expect(r.ok).toBe(true);
  return r;
}

beforeEach(async () => {
  await limparBanco(["configuracao", "transicao_fase", "timeline", "oportunidade", "fase", "pipeline", "sessao", "usuario"]);
  invalidarCachePipelines();
});

describe("ranking a partir do histórico real (criar, mover, marcar feita, ganhar)", () => {
  it("pontua criação, primeira entrada por fase, ações feitas e ganho com bônus; participantes certos", async () => {
    const s = await semear();
    const id = await novoCard(s, s.ana, "Padaria"); // +1
    await ok(moverCard(id, fase(s, "em_negociacao"), s.ana)); // +5
    await ok(moverCard(id, fase(s, "primeiro_contato"), s.ana)); // volta: 0
    await ok(moverCard(id, fase(s, "em_negociacao"), s.ana)); // reentrada: 0
    await db.projeto.update({ where: { id }, data: { proximaAcao: "ligar", proximaAcaoEm: new Date() } });
    const hoje = diaEmFuso(new Date());
    await ok(marcarAcaoFeita(id, { proximaAcao: "ligar", dia: hoje }, { tipo: "nova", proximaAcao: "mandar proposta", proximaAcaoEm: new Date() }, s.ana)); // +2
    await ok(marcarAcaoFeita(id, { proximaAcao: "mandar proposta", dia: hoje }, { tipo: "nenhuma" }, s.ana)); // mesmo card no dia: conta (+2; cota é 4/dia por vendedor)
    // Quem move para o ganho é o Bruno; o ganho é do responsável (Ana).
    await ok(moverCard(id, fase(s, "contrato_assinado"), s.bruno, { dadosTerminal: { valorFechado: "12.500" } })); // +112

    // Card do gestor com orçamento aberto: ele entra; gestor sem card, não; inativo, não.
    const gilCard = await novoCard(s, s.gil, "Escola"); // +1 para o Gil
    await db.projeto.update({ where: { id: gilCard }, data: { orcamentoPrevisto: "8000.50" } });

    const agora = new Date();
    const v = await carregarRanking(s.ana, resolverPeriodo("semana", undefined, agora), agora);
    expect(v.modo).toBe("completo");
    if (v.modo !== "completo") return;
    const nomes = v.ranking.linhas.map((l) => l.usuario.nome);
    expect(nomes).toEqual(["Ana Vendas", "Gil Gestor", "Bruno Lima"]);
    const ana = v.ranking.linhas[0];
    expect(ana.detalhe).toEqual({ ganho: 112, avanco: 5, acaoFeita: 4, cardCriado: 1 });
    expect(ana.pontos).toBe(122);
    expect(ana.fechado).toBe(12_500);
    expect(v.ranking.linhas[1]).toMatchObject({ pontos: 1, abertos: 1, emAberto: 8000.5 });
    expect(v.eu?.posicao).toBe(1);
    expect(v.feed.map((i) => i.tipo)).toEqual(["GANHO", "AVANCO"]);
  });

  it("ganho segue contando com o card em Projetos (sem pontuar o que anda lá); card excluído não pontua", async () => {
    const s = await semear();
    const id = await novoCard(s, s.ana, "Padaria");
    await ok(moverCard(id, fase(s, "contrato_assinado"), s.ana, { dadosTerminal: {} }));
    const agora = () => new Date();
    const pontosAna = async () => {
      const v = await carregarRanking(s.ana, resolverPeriodo("mes", undefined, agora()), agora());
      if (v.modo !== "completo") throw new Error("modo");
      return v.ranking.linhas.find((l) => l.usuario.id === s.ana.id)!;
    };
    const antes = await pontosAna();
    expect(antes.detalhe.ganho).toBe(100);
    expect((await db.projeto.findUniqueOrThrow({ where: { id } })).pipelineId).toBe(s.projetos.id);

    // Andar em Projetos não pontua (nem avanço, nem nada); o ganho continua.
    await ok(moverCard(id, s.projetos.fases.find((f) => f.chave === "em_execucao")!.id, s.ana));
    const l = await pontosAna();
    expect(l.detalhe).toEqual(antes.detalhe);
    expect(l.ganhos).toBe(1);
    expect(l.abertos).toBe(0);

    await db.projeto.update({ where: { id }, data: { deletadoEm: new Date() } });
    expect((await pontosAna()).pontos).toBe(0);
  });

  it("ganho fora do período (data_ganho no mês passado) não conta na semana", async () => {
    const s = await semear();
    const id = await novoCard(s, s.ana, "Velha");
    await ok(moverCard(id, fase(s, "contrato_assinado"), s.ana, { dadosTerminal: {} }));
    await db.projeto.update({ where: { id }, data: { dataGanho: new Date(Date.now() - 40 * 86_400_000) } });
    const agora = new Date();
    const v = await carregarRanking(s.ana, resolverPeriodo("semana", undefined, agora), agora);
    if (v.modo !== "completo") throw new Error("modo");
    expect(v.ranking.linhas.find((l) => l.usuario.id === s.ana.id)!.ganhos).toBe(0);
  });

  it("participantes: vendedores ativos + gestores com card vivo em Vendas", async () => {
    const s = await semear();
    const c = await novoCard(s, s.gil, "Do gestor");
    expect((await listarParticipantes()).participantes.map((p) => p.nome)).toEqual(["Ana Vendas", "Bruno Lima", "Gil Gestor"]);
    expect((await listarParticipantes()).inativos).toEqual([s.ivo.id]);
    await db.projeto.update({ where: { id: c }, data: { deletadoEm: new Date() } });
    expect((await listarParticipantes()).participantes.map((p) => p.nome)).toEqual(["Ana Vendas", "Bruno Lima"]);
  });

  it("participantes: VISUALIZADOR ativo nunca entra, nem sendo responsável de card vivo de Vendas", async () => {
    const s = await semear();
    const vera = await db.usuario.create({ data: { nome: "Vera Visualizadora", email: "vera@ij.test", papel: "VISUALIZADOR" } });
    // Ex-vendedor rebaixado: ainda dono de um card.
    await db.projeto.create({ data: { titulo: "Antigo", pipelineId: s.vendas.id, faseId: fase(s, "primeiro_contato"), responsavelId: vera.id, criadoVia: "UI" } });
    const { participantes } = await listarParticipantes();
    expect(participantes.map((p) => p.nome)).toEqual(["Ana Vendas", "Bruno Lima"]);
  });
});

describe("visibilidade e configuração", () => {
  it("ranking escondido: vendedor recebe só a própria linha (sem posição) e o próprio feed; gestor vê tudo", async () => {
    const s = await semear();
    const a = await novoCard(s, s.ana, "da Ana");
    const b = await novoCard(s, s.bruno, "do Bruno");
    await ok(moverCard(a, fase(s, "em_negociacao"), s.ana));
    await ok(moverCard(b, fase(s, "em_negociacao"), s.bruno));
    await ok(salvarConfigRanking({ ...CONFIG_RANKING_PADRAO, mostrarAosVendedores: false }, s.gil, null));

    const agora = new Date();
    const periodo = resolverPeriodo("semana", undefined, agora);
    const vend = await carregarRanking(s.ana, periodo, agora);
    expect(vend.modo).toBe("proprio");
    expect(vend).not.toHaveProperty("ranking");
    expect(vend.eu?.usuario.id).toBe(s.ana.id);
    expect(vend.eu).not.toHaveProperty("posicao");
    expect(vend.feed.every((i) => i.usuario.id === s.ana.id)).toBe(true);
    expect(JSON.stringify(vend)).not.toContain("Bruno");

    const top = await carregarTop3(s.ana, agora);
    expect(top.modo).toBe("proprio");
    expect(JSON.stringify(top)).not.toContain("Bruno");

    const gest = await carregarRanking(s.gil, periodo, agora);
    expect(gest.modo).toBe("completo");
    expect((await carregarTop3(s.gil, agora)).modo).toBe("completo");
  });

  it("VISUALIZADOR vê o ranking completo mesmo escondido dos vendedores, sem linha própria; não mexe nos pesos", async () => {
    const s = await semear();
    const vera = await db.usuario.create({ data: { nome: "Vera Visualizadora", email: "vera@ij.test", papel: "VISUALIZADOR" } });
    const a = await novoCard(s, s.ana, "da Ana");
    await ok(moverCard(a, fase(s, "em_negociacao"), s.ana));
    await ok(salvarConfigRanking({ ...CONFIG_RANKING_PADRAO, mostrarAosVendedores: false }, s.gil, null));
    const config = await obterConfigRanking();
    expect(podeVerRanking(vera, config)).toBe(true);
    expect(podeVerRanking(s.ana, config)).toBe(false);

    const agora = new Date();
    const v = await carregarRanking(vera, resolverPeriodo("semana", undefined, agora), agora);
    if (v.modo !== "completo") throw new Error("modo");
    expect(v.eu).toBeNull();
    expect(v.ranking.linhas.map((l) => l.usuario.nome)).toEqual(expect.arrayContaining(["Ana Vendas", "Bruno Lima"]));
    expect(v.ranking.linhas.some((l) => l.usuario.id === vera.id)).toBe(false);
    expect(v.feed.some((i) => i.usuario.id === s.ana.id)).toBe(true);

    const top = await carregarTop3(vera, agora);
    expect(top).toMatchObject({ modo: "completo", eu: null });

    expect(await salvarConfigRanking(CONFIG_RANKING_PADRAO, vera, null)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
  });

  it("pesos: só GESTOR+, validados; inválido não grava; leitura sem linha = padrão", async () => {
    const s = await semear();
    expect(await obterConfigRanking()).toEqual(CONFIG_RANKING_PADRAO);
    expect(await salvarConfigRanking({ ...CONFIG_RANKING_PADRAO, mostrarAosVendedores: false }, s.ana, null)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    const ruim = await salvarConfigRanking({ ...CONFIG_RANKING_PADRAO, pesos: { ...CONFIG_RANKING_PADRAO.pesos, avanco: -1 } }, s.gil, null);
    expect(ruim).toMatchObject({ ok: false, erro: "DADOS_INVALIDOS" });
    expect(await obterConfigRanking()).toEqual(CONFIG_RANKING_PADRAO);

    const novo = { ...CONFIG_RANKING_PADRAO, pesos: { ...CONFIG_RANKING_PADRAO.pesos, cardCriado: 10 } };
    await ok(salvarConfigRanking(novo, s.gil, null));
    expect(await obterConfigRanking()).toEqual(novo);
    const linha = await db.configuracao.findUniqueOrThrow({ where: { chave: "ranking" } });
    expect(linha.atualizadoPor).toBe(s.gil.id);

    // Config gravada antes de `acoesPorDia` existir mantém os pesos e ganha o limite padrão (4).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { acoesPorDia, ...pesosAntigos } = novo.pesos;
    await db.configuracao.update({ where: { chave: "ranking" }, data: { valor: { ...novo, pesos: pesosAntigos } } });
    expect(await obterConfigRanking()).toEqual(novo);
    expect((await obterConfigRanking()).pesos.acoesPorDia).toBe(4);
    const limite = await salvarConfigRanking({ ...novo, pesos: { ...novo.pesos, acoesPorDia: 101 } }, s.gil, (await obterConfiguracao(CONFIG_RANKING)).atualizadoEm);
    expect(limite).toMatchObject({ ok: false, erro: "DADOS_INVALIDOS" });

    // JSON quebrado no banco (edição manual, versão antiga) vira o padrão, não erro.
    await db.configuracao.update({ where: { chave: "ranking" }, data: { valor: { pesos: "x" } } });
    expect(await obterConfigRanking()).toEqual(CONFIG_RANKING_PADRAO);
  });
});

// ---------------------------------------------------------------- review do PR #21

const sp = (iso: string) => new Date(`${iso}-03:00`);

/** Card com histórico gravado direto (sem passar pelo núcleo): para origens SISTEMA/IMPORT e datas fixas. */
async function cardComHistorico(
  s: S,
  dono: { id: string },
  titulo: string,
  passos: { para: string; origem: "UI" | "WHATSAPP" | "SISTEMA" | "IMPORT"; em: Date }[],
  extra: { dataGanho?: Date; valorFechado?: string } = {},
) {
  const ultimo = passos.at(-1)!;
  const op = await db.projeto.create({
    data: {
      titulo,
      pipelineId: s.vendas.id,
      faseId: fase(s, ultimo.para),
      responsavelId: dono.id,
      criadoVia: passos[0].origem === "IMPORT" ? "IMPORT" : "UI",
      criadoEm: passos[0].em,
      faseDesde: ultimo.em,
      dataGanho: extra.dataGanho ?? null,
      valorFechado: extra.valorFechado ?? null,
    },
  });
  let de: string | null = null;
  for (const p of passos) {
    await db.transicaoFase.create({ data: { projetoId: op.id, deFaseId: de, paraFaseId: fase(s, p.para), usuarioId: dono.id, origem: p.origem, em: p.em } });
    de = fase(s, p.para);
  }
  return op.id;
}

describe("review: feed, origens, fuso, desativados", () => {
  afterEach(() => vi.restoreAllMocks());

  it("ranking oculto: 40 avanços mais novos de outro vendedor não escondem o do próprio", async () => {
    const s = await semear();
    const agora = new Date();
    const t = (minAtras: number) => new Date(agora.getTime() - minAtras * 60_000);
    await cardComHistorico(s, s.ana, "Meu card", [
      { para: "primeiro_contato", origem: "UI", em: t(300) },
      { para: "em_negociacao", origem: "UI", em: t(200) },
    ]);
    for (let i = 0; i < 40; i++) {
      await cardComHistorico(s, s.bruno, `Do Bruno ${i}`, [
        { para: "primeiro_contato", origem: "UI", em: t(150) },
        { para: "em_negociacao", origem: "UI", em: t(100 - i) },
      ]);
    }
    await ok(salvarConfigRanking({ ...CONFIG_RANKING_PADRAO, mostrarAosVendedores: false }, s.gil, null));
    const v = await carregarRanking(s.ana, resolverPeriodo("mes", undefined, agora), agora);
    expect(v.modo).toBe("proprio");
    expect(v.feed.map((i) => i.titulo)).toEqual(["Meu card"]);
  });

  it("SISTEMA/IMPORT: perda por migração não conta; ganho importado não conta; ganho migrado entre fases de ganho continua contando", async () => {
    const s = await semear();
    const agora = new Date();
    const t = (minAtras: number) => new Date(agora.getTime() - minAtras * 60_000);
    await cardComHistorico(s, s.ana, "Perdido pelo sistema", [
      { para: "primeiro_contato", origem: "UI", em: t(60) },
      { para: "perdido", origem: "SISTEMA", em: t(30) },
    ]);
    await cardComHistorico(s, s.ana, "Ganho importado", [
      { para: "primeiro_contato", origem: "IMPORT", em: t(60) },
      { para: "contrato_assinado", origem: "IMPORT", em: t(30) },
    ], { dataGanho: t(30), valorFechado: "9000" });
    await cardComHistorico(s, s.ana, "Ganho migrado", [
      { para: "primeiro_contato", origem: "UI", em: t(60) },
      { para: "contrato_assinado", origem: "UI", em: t(30) },
      { para: "contrato_b", origem: "SISTEMA", em: t(10) },
    ], { dataGanho: t(30), valorFechado: "1000" });
    const v = await carregarRanking(s.gil, resolverPeriodo("mes", undefined, agora), agora);
    if (v.modo !== "completo") throw new Error("modo");
    const ana = v.ranking.linhas.find((l) => l.usuario.id === s.ana.id)!;
    expect(ana.perdidos).toBe(0);
    expect(ana.ganhos).toBe(1);
    expect(ana.fechado).toBe(1_000);
  });

  it("fronteira domingo 23:59 / segunda 00:00 de SP vale mesmo com a sessão do Postgres em America/Sao_Paulo", async () => {
    const s = await semear();
    const domingo = sp("2026-10-18T23:59:59.999");
    const segunda = sp("2026-10-19T00:00:00");
    for (const [titulo, em] of [["domingo", domingo], ["segunda", segunda]] as const) {
      await cardComHistorico(s, s.ana, titulo, [
        { para: "primeiro_contato", origem: "UI", em: new Date(em.getTime() - 3_600_000) },
        { para: "contrato_assinado", origem: "UI", em },
      ], { dataGanho: em });
      await cardComHistorico(s, s.bruno, `perdido ${titulo}`, [
        { para: "primeiro_contato", origem: "UI", em: new Date(em.getTime() - 3_600_000) },
        { para: "perdido", origem: "UI", em },
      ]);
    }
    const agora = sp("2026-10-26T12:00:00");
    const semana = resolverPeriodo("semana", "2026-10-18", agora);
    const seguinte = resolverPeriodo("semana", "2026-10-19", agora);
    const [d1, d2] = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'America/Sao_Paulo'");
      return [await carregarDados(semana, tx), await carregarDados(seguinte, tx)];
    });
    expect(d1.ganhos.map((g) => g.titulo)).toEqual(["domingo"]);
    expect(d2.ganhos.map((g) => g.titulo)).toEqual(["segunda"]);
    expect(d1.ganhos[0].dataGanho).toEqual(domingo);
    expect(d1.perdas).toHaveLength(1);
    expect(d2.perdas).toHaveLength(1);
    expect(d1.perdas[0].em).toEqual(domingo);
  });

  it("desativado sai da lista e dos destaques, mas o ganho dele conta no Time", async () => {
    const s = await semear();
    const id = await novoCard(s, s.ana, "Padaria");
    await ok(moverCard(id, fase(s, "contrato_assinado"), s.ana, { dadosTerminal: { valorFechado: "5.000" } }));
    await db.usuario.update({ where: { id: s.ana.id }, data: { ativo: false } });
    const agora = new Date();
    const v = await carregarRanking(s.gil, resolverPeriodo("mes", undefined, agora), agora);
    if (v.modo !== "completo") throw new Error("modo");
    expect(v.ranking.linhas.map((l) => l.usuario.id)).not.toContain(s.ana.id);
    expect(v.ranking.time.ganhos).toBe(1);
    expect(v.ranking.time.fechado).toBe(5_000);
    expect(v.ranking.destaques.find((d) => d.chave === "liderVendas")!.vencedores).toEqual([]);
  });
});

describe("review: configuração — concorrência otimista e valor inválido", () => {
  afterEach(() => vi.restoreAllMocks());

  it("dois gestores com a mesma versão: o segundo recebe conflito em vez de sobrescrever", async () => {
    const s = await semear();
    const admin = await db.usuario.create({ data: { nome: "Alice Admin", email: "alice@ij.test", papel: "ADMIN" } });
    const a = { ...CONFIG_RANKING_PADRAO, mostrarAosVendedores: false };
    const b = { ...CONFIG_RANKING_PADRAO, pesos: { ...CONFIG_RANKING_PADRAO.pesos, avanco: 9 } };

    // Sem linha ainda: os dois carregaram "padrão" (versão null).
    await ok(salvarConfigRanking(a, s.gil, null));
    expect(await salvarConfigRanking(b, admin, null)).toMatchObject({ ok: false, erro: "CONFLITO" });

    const v1 = (await obterConfiguracao(CONFIG_RANKING)).atualizadoEm!;
    await ok(salvarConfigRanking(b, admin, v1));
    expect(await salvarConfigRanking(a, s.gil, v1)).toMatchObject({ ok: false, erro: "CONFLITO" });
    expect(await obterConfigRanking()).toEqual(b);
  });

  it("valor salvo inválido: usa o padrão, marca inválido e loga a chave (sem o valor)", async () => {
    const s = await semear();
    await db.configuracao.create({ data: { chave: "ranking", valor: { pesos: "segredo-xyz" }, atualizadoPor: s.gil.id } });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const c = await obterConfiguracao(CONFIG_RANKING);
    expect(c).toMatchObject({ valor: CONFIG_RANKING_PADRAO, padrao: true, invalido: true });
    expect(c.atualizadoEm).not.toBeNull(); // versão real, para o próximo salvar não dar conflito falso
    const linhas = log.mock.calls.map((a) => a.join(" "));
    expect(linhas.some((l) => l.includes("configuracao.ranking") && l.includes("ref="))).toBe(true);
    expect(linhas.join("\n")).not.toContain("segredo-xyz");
  });
});

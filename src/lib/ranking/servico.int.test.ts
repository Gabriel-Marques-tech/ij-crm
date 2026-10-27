import { beforeEach, describe, expect, it } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { diaEmFuso } from "@/lib/oportunidades/aging";
import { marcarAcaoFeita } from "@/lib/oportunidades/feita";
import { criarCard, moverCard } from "@/lib/oportunidades/oportunidades";
import { CONFIG_RANKING_PADRAO } from "./config";
import { resolverPeriodo } from "./periodo";
import { carregarRanking, carregarTop3, listarParticipantes, obterConfigRanking, salvarConfigRanking } from "./servico";

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
  await db.pipeline.create({ data: { chave: "projetos", nome: "Projetos", ordem: 1, fases: { create: [{ chave: "em_execucao", nome: "Em execução", ordem: 0 }] } } });
  const ana = await db.usuario.create({ data: { nome: "Ana Vendas", email: "ana@ij.test" } });
  const bruno = await db.usuario.create({ data: { nome: "Bruno Lima", email: "bruno@ij.test" } });
  const gil = await db.usuario.create({ data: { nome: "Gil Gestor", email: "gil@ij.test", papel: "GESTOR" } });
  const gaia = await db.usuario.create({ data: { nome: "Gaia Sem Cards", email: "gaia@ij.test", papel: "GESTOR" } });
  const ivo = await db.usuario.create({ data: { nome: "Ivo Inativo", email: "ivo@ij.test", ativo: false } });
  return { vendas, ana, bruno, gil, gaia, ivo };
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
    await db.oportunidade.update({ where: { id }, data: { proximaAcao: "ligar", proximaAcaoEm: new Date() } });
    const hoje = diaEmFuso(new Date());
    await ok(marcarAcaoFeita(id, { proximaAcao: "ligar", dia: hoje }, { tipo: "nova", proximaAcao: "mandar proposta", proximaAcaoEm: new Date() }, s.ana)); // +2
    await ok(marcarAcaoFeita(id, { proximaAcao: "mandar proposta", dia: hoje }, { tipo: "nenhuma" }, s.ana)); // mesmo card no dia: conta (+2; cota é 4/dia por vendedor)
    // Quem move para o ganho é o Bruno; o ganho é do responsável (Ana).
    await ok(moverCard(id, fase(s, "contrato_assinado"), s.bruno, { dadosTerminal: { valorFechado: "12.500" } })); // +112

    // Card do gestor com orçamento aberto: ele entra; gestor sem card, não; inativo, não.
    const gilCard = await novoCard(s, s.gil, "Escola"); // +1 para o Gil
    await db.oportunidade.update({ where: { id: gilCard }, data: { orcamentoPrevisto: "8000.50" } });

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

  it("venda reaberta deixa de contar o ganho; re-ganho conta de novo; card excluído não pontua", async () => {
    const s = await semear();
    const id = await novoCard(s, s.ana, "Padaria");
    await ok(moverCard(id, fase(s, "contrato_assinado"), s.ana, { dadosTerminal: {} }));
    const agora = () => new Date();
    const pontosAna = async () => {
      const v = await carregarRanking(s.ana, resolverPeriodo("mes", undefined, agora()), agora());
      if (v.modo !== "completo") throw new Error("modo");
      return v.ranking.linhas.find((l) => l.usuario.id === s.ana.id)!;
    };
    expect((await pontosAna()).detalhe.ganho).toBe(100);

    await ok(moverCard(id, fase(s, "em_negociacao"), s.ana)); // reabre (avanço de 0 → 1 também é 1ª entrada)
    expect((await pontosAna()).detalhe.ganho).toBe(0);
    await ok(moverCard(id, fase(s, "contrato_assinado"), s.ana, { dadosTerminal: {} }));
    const l = await pontosAna();
    expect(l.detalhe.ganho).toBe(100);
    expect(l.ganhos).toBe(1);

    await db.oportunidade.update({ where: { id }, data: { deletadoEm: new Date() } });
    expect((await pontosAna()).pontos).toBe(0);
  });

  it("ganho fora do período (data_ganho no mês passado) não conta na semana", async () => {
    const s = await semear();
    const id = await novoCard(s, s.ana, "Velha");
    await ok(moverCard(id, fase(s, "contrato_assinado"), s.ana, { dadosTerminal: {} }));
    await db.oportunidade.update({ where: { id }, data: { dataGanho: new Date(Date.now() - 40 * 86_400_000) } });
    const agora = new Date();
    const v = await carregarRanking(s.ana, resolverPeriodo("semana", undefined, agora), agora);
    if (v.modo !== "completo") throw new Error("modo");
    expect(v.ranking.linhas.find((l) => l.usuario.id === s.ana.id)!.ganhos).toBe(0);
  });

  it("participantes: vendedores ativos + gestores com card vivo em Vendas", async () => {
    const s = await semear();
    const c = await novoCard(s, s.gil, "Do gestor");
    expect((await listarParticipantes()).map((p) => p.nome)).toEqual(["Ana Vendas", "Bruno Lima", "Gil Gestor"]);
    await db.oportunidade.update({ where: { id: c }, data: { deletadoEm: new Date() } });
    expect((await listarParticipantes()).map((p) => p.nome)).toEqual(["Ana Vendas", "Bruno Lima"]);
  });
});

describe("visibilidade e configuração", () => {
  it("ranking escondido: vendedor recebe só a própria linha (sem posição) e o próprio feed; gestor vê tudo", async () => {
    const s = await semear();
    const a = await novoCard(s, s.ana, "da Ana");
    const b = await novoCard(s, s.bruno, "do Bruno");
    await ok(moverCard(a, fase(s, "em_negociacao"), s.ana));
    await ok(moverCard(b, fase(s, "em_negociacao"), s.bruno));
    await ok(salvarConfigRanking({ ...CONFIG_RANKING_PADRAO, mostrarAosVendedores: false }, s.gil));

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

  it("pesos: só GESTOR+, validados; inválido não grava; leitura sem linha = padrão", async () => {
    const s = await semear();
    expect(await obterConfigRanking()).toEqual(CONFIG_RANKING_PADRAO);
    expect(await salvarConfigRanking({ ...CONFIG_RANKING_PADRAO, mostrarAosVendedores: false }, s.ana)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    const ruim = await salvarConfigRanking({ ...CONFIG_RANKING_PADRAO, pesos: { ...CONFIG_RANKING_PADRAO.pesos, avanco: -1 } }, s.gil);
    expect(ruim).toMatchObject({ ok: false, erro: "DADOS_INVALIDOS" });
    expect(await obterConfigRanking()).toEqual(CONFIG_RANKING_PADRAO);

    const novo = { ...CONFIG_RANKING_PADRAO, pesos: { ...CONFIG_RANKING_PADRAO.pesos, cardCriado: 10 } };
    await ok(salvarConfigRanking(novo, s.gil));
    expect(await obterConfigRanking()).toEqual(novo);
    const linha = await db.configuracao.findUniqueOrThrow({ where: { chave: "ranking" } });
    expect(linha.atualizadoPor).toBe(s.gil.id);

    // Config gravada antes de `acoesPorDia` existir mantém os pesos e ganha o limite padrão (4).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { acoesPorDia, ...pesosAntigos } = novo.pesos;
    await db.configuracao.update({ where: { chave: "ranking" }, data: { valor: { ...novo, pesos: pesosAntigos } } });
    expect(await obterConfigRanking()).toEqual(novo);
    expect((await obterConfigRanking()).pesos.acoesPorDia).toBe(4);
    const limite = await salvarConfigRanking({ ...novo, pesos: { ...novo.pesos, acoesPorDia: 101 } }, s.gil);
    expect(limite).toMatchObject({ ok: false, erro: "DADOS_INVALIDOS" });

    // JSON quebrado no banco (edição manual, versão antiga) vira o padrão, não erro.
    await db.configuracao.update({ where: { chave: "ranking" }, data: { valor: { pesos: "x" } } });
    expect(await obterConfigRanking()).toEqual(CONFIG_RANKING_PADRAO);
  });
});

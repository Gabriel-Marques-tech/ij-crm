import { describe, expect, it } from "vitest";
import { CONFIG_RANKING_PADRAO, type ConfigRanking } from "./config";
import { acoesQueContam, avancosQueContam, calcularRanking, montarFeed, pontosDoGanho, type DadosRanking, type Transicao } from "./calculo";
import { resolverPeriodo } from "./periodo";

const sp = (iso: string) => new Date(`${iso}-03:00`);
const SEMANA = resolverPeriodo("semana", "2026-10-21", sp("2026-10-26T12:00:00")); // 19/10 a 25/10
const CFG = CONFIG_RANKING_PADRAO;
const P = CFG.pesos;

const ana = { id: "ana", nome: "Ana", fotoEm: null };
const bia = { id: "bia", nome: "Bia", fotoEm: 123 };
const caio = { id: "caio", nome: "Caio", fotoEm: null };

const vazio = (): DadosRanking => ({ ganhos: [], perdas: [], transicoes: [], acoes: [], criacoes: [], abertos: [] });

let seq = 0;
function tr(op: string, para: { id: string; ordem: number; terminal?: boolean }, de: number | null, em: Date, extra: Partial<Transicao> = {}): Transicao {
  return {
    id: `t${++seq}`,
    oportunidadeId: op,
    titulo: `card ${op}`,
    usuarioId: "ana",
    origem: "UI",
    em,
    paraFaseId: para.id,
    paraFaseNome: para.id.toUpperCase(),
    paraOrdem: para.ordem,
    paraTerminal: para.terminal ?? false,
    deOrdem: de,
    ...extra,
  };
}
const A = { id: "a", ordem: 0 };
const B = { id: "b", ordem: 1 };
const C = { id: "c", ordem: 2 };
const GANHO = { id: "ganho", ordem: 9, terminal: true };

describe("pontosDoGanho", () => {
  it("100 + 1 por R$ 1.000 completo, com teto de bônus", () => {
    expect(pontosDoGanho(null, P)).toBe(100);
    expect(pontosDoGanho(999.99, P)).toBe(100);
    expect(pontosDoGanho(12_500, P)).toBe(112);
    expect(pontosDoGanho(5_000_000, P)).toBe(200); // teto 100
  });

  it("respeita pesos editados", () => {
    expect(pontosDoGanho(12_000, { ...P, ganho: 50, bonusPorMil: 2, tetoBonus: 10 })).toBe(60);
    expect(pontosDoGanho(12_000, { ...P, bonusPorMil: 0 })).toBe(100);
  });
});

describe("avancosQueContam — só a primeira entrada de cada card em cada fase", () => {
  it("avanço conta; volta e reentrada não; terminal e ordem menor não", () => {
    const t = [
      tr("1", A, null, sp("2026-10-10T10:00:00")), // criação (antes do período)
      tr("1", B, 0, sp("2026-10-20T10:00:00")), // avanço ✓
      tr("1", A, 1, sp("2026-10-20T11:00:00")), // voltou: ordem menor ✗
      tr("1", B, 0, sp("2026-10-20T12:00:00")), // reentrada em B ✗
      tr("1", C, 1, sp("2026-10-21T12:00:00")), // avanço ✓
      tr("1", GANHO, 2, sp("2026-10-22T12:00:00")), // terminal ✗
    ];
    const r = avancosQueContam(t, SEMANA);
    expect(r.map((x) => x.paraFaseId)).toEqual(["b", "c"]);
  });

  it("primeira entrada antes do período: reentrada dentro do período não conta", () => {
    const t = [tr("2", A, null, sp("2026-10-01T10:00:00")), tr("2", B, 0, sp("2026-10-05T10:00:00")), tr("2", A, 1, sp("2026-10-06T10:00:00")), tr("2", B, 0, sp("2026-10-20T10:00:00"))];
    expect(avancosQueContam(t, SEMANA)).toEqual([]);
  });

  it("criação direto numa fase conta como a primeira entrada dela; import e sem autor não pontuam", () => {
    const t = [
      tr("3", B, null, sp("2026-10-19T09:00:00")),
      tr("3", A, 1, sp("2026-10-19T10:00:00")),
      tr("3", B, 0, sp("2026-10-19T11:00:00")), // já entrou em B na criação ✗
      tr("4", B, 0, sp("2026-10-19T11:00:00"), { origem: "IMPORT" }),
      tr("5", B, 0, sp("2026-10-19T11:00:00"), { usuarioId: null }),
    ];
    expect(avancosQueContam(t, SEMANA)).toEqual([]);
  });

  it("empate de instante desempata pelo id da transição (ordem estável)", () => {
    const em = sp("2026-10-20T10:00:00");
    const t = [{ ...tr("6", B, 0, em), id: "z" }, { ...tr("6", B, 0, em), id: "a", usuarioId: "bia" }];
    expect(avancosQueContam(t, SEMANA).map((x) => x.usuarioId)).toEqual(["bia"]);
  });
});

describe("acoesQueContam — máx. N por vendedor por dia (SP)", () => {
  const acao = (usuarioId: string, oportunidadeId: string, iso: string) => ({ oportunidadeId, usuarioId, em: sp(iso) });

  it("vendedor com 6 ações no mesmo dia: contam as 4 primeiras (padrão)", () => {
    const acoes = ["09", "10", "11", "12", "13", "14"].map((h, i) => acao("ana", String(i % 2), `2026-10-20T${h}:00:00`));
    const r = acoesQueContam(acoes, SEMANA, P.acoesPorDia);
    expect(P.acoesPorDia).toBe(4);
    expect(r).toHaveLength(4);
    expect(r.map((a) => a.em)).toEqual(acoes.slice(0, 4).map((a) => a.em));
  });

  it("mesmo card várias vezes no dia conta (não há mais limite por card)", () => {
    const acoes = [acao("ana", "1", "2026-10-20T09:00:00"), acao("ana", "1", "2026-10-20T10:00:00"), acao("ana", "1", "2026-10-20T11:00:00")];
    expect(acoesQueContam(acoes, SEMANA, 4)).toHaveLength(3);
  });

  it("o limite é por vendedor: outra pessoa tem a própria cota no mesmo dia/card", () => {
    const acoes = [
      ...["09", "10", "11", "12", "13"].map((h) => acao("ana", "1", `2026-10-20T${h}:00:00`)),
      acao("bia", "1", "2026-10-20T15:00:00"),
    ];
    const r = acoesQueContam(acoes, SEMANA, 4);
    expect(r.filter((a) => a.usuarioId === "ana")).toHaveLength(4);
    expect(r.filter((a) => a.usuarioId === "bia")).toHaveLength(1);
  });

  it("o dia é o de SP: 23:59 e 00:00 do dia seguinte são cotas diferentes (mesmo dia em UTC)", () => {
    // 20/10 20:00–23:59 SP = 21/10 23:00Z..02:59Z; 21/10 00:00 SP = 21/10 03:00Z.
    const acoes = [
      acao("ana", "1", "2026-10-20T21:00:00"),
      acao("ana", "1", "2026-10-20T22:00:00"),
      acao("ana", "1", "2026-10-20T23:00:00"),
      acao("ana", "1", "2026-10-20T23:59:00"),
      acao("ana", "1", "2026-10-20T23:59:30"), // 5ª do dia 20: fora
      acao("ana", "1", "2026-10-21T00:00:00"), // 1ª do dia 21: conta
    ];
    const r = acoesQueContam(acoes, SEMANA, 4);
    expect(r).toHaveLength(5);
    expect(r.at(-1)!.em).toEqual(sp("2026-10-21T00:00:00"));
  });

  it("limite configurável (inclusive 0 = ação feita não pontua) e fora do período não conta", () => {
    const acoes = ["09", "10", "11"].map((h) => acao("ana", "1", `2026-10-20T${h}:00:00`));
    expect(acoesQueContam(acoes, SEMANA, 2)).toHaveLength(2);
    expect(acoesQueContam(acoes, SEMANA, 0)).toEqual([]);
    expect(acoesQueContam([acao("ana", "1", "2026-10-26T00:00:00")], SEMANA, 4)).toEqual([]);
  });

  it("calcularRanking aplica o limite configurado", () => {
    const d = vazio();
    d.acoes.push(...["09", "10", "11", "12", "13", "14"].map((h) => acao("ana", "1", `2026-10-20T${h}:00:00`)));
    const l = calcularRanking([ana], d, SEMANA, CFG).linhas[0];
    expect(l.acoesFeitas).toBe(4);
    expect(l.detalhe.acaoFeita).toBe(8);
    const cfg = { ...CFG, pesos: { ...P, acoesPorDia: 6 } };
    expect(calcularRanking([ana], d, SEMANA, cfg).linhas[0].detalhe.acaoFeita).toBe(12);
  });
});

describe("calcularRanking — pontuação e desempate", () => {
  it("soma por categoria com detalhamento; fora do período e de não participantes não entra", () => {
    const d = vazio();
    d.ganhos.push(
      { oportunidadeId: "g1", titulo: "Padaria", responsavelId: "ana", dataGanho: sp("2026-10-20T10:00:00"), valorFechado: 12_500, criadoEm: sp("2026-10-10T10:00:00") },
      { oportunidadeId: "g2", titulo: "Fora", responsavelId: "ana", dataGanho: sp("2026-10-26T00:00:00"), valorFechado: 1_000, criadoEm: sp("2026-10-10T10:00:00") },
      { oportunidadeId: "g3", titulo: "Inativo", responsavelId: "ivo", dataGanho: sp("2026-10-20T10:00:00"), valorFechado: 1_000, criadoEm: sp("2026-10-10T10:00:00") },
    );
    d.transicoes.push(tr("1", A, null, sp("2026-10-19T08:00:00")), tr("1", B, 0, sp("2026-10-19T09:00:00")));
    d.acoes.push({ oportunidadeId: "1", usuarioId: "ana", em: sp("2026-10-21T09:00:00") });
    d.criacoes.push({ oportunidadeId: "1", usuarioId: "ana", em: sp("2026-10-19T08:00:00") }, { oportunidadeId: "9", usuarioId: "bia", em: sp("2026-10-18T23:59:00") });

    const r = calcularRanking([ana, bia], d, SEMANA, CFG);
    const l = r.linhas.find((x) => x.usuario.id === "ana")!;
    expect(l.pontos).toBe(112 + 5 + 2 + 1);
    expect(l.detalhe).toEqual({ ganho: 112, avanco: 5, acaoFeita: 2, cardCriado: 1 });
    expect(l.ganhos).toBe(1);
    expect(l.fechado).toBe(12_500);
    expect(r.linhas.find((x) => x.usuario.id === "bia")!.pontos).toBe(0);
    expect(r.linhas.map((x) => x.usuario.id)).toEqual(["ana", "bia"]);
    expect(r.linhas.map((x) => x.posicao)).toEqual([1, 2]);
  });

  it("desempate: mais ganhos → maior valor fechado → quem chegou primeiro", () => {
    const g = (id: string, resp: string, dia: string, valor: number) => ({
      oportunidadeId: id,
      titulo: id,
      responsavelId: resp,
      dataGanho: sp(`${dia}T10:00:00`),
      valorFechado: valor,
      criadoEm: sp("2026-10-01T10:00:00"),
    });
    const cfg: ConfigRanking = { ...CFG, pesos: { ...P, bonusPorMil: 0, cardCriado: 100 } };

    // ana: 1 ganho (100) ; bia: 0 ganhos, 1 card criado (100) → ana na frente por ganhos.
    let d = vazio();
    d.ganhos.push(g("x", "ana", "2026-10-22", 1_000));
    d.criacoes.push({ oportunidadeId: "c", usuarioId: "bia", em: sp("2026-10-19T10:00:00") });
    expect(calcularRanking([bia, ana], d, SEMANA, cfg).linhas.map((l) => l.usuario.id)).toEqual(["ana", "bia"]);

    // mesmos pontos e ganhos: maior R$ fechado na frente.
    d = vazio();
    d.ganhos.push(g("x", "ana", "2026-10-20", 1_000), g("y", "bia", "2026-10-22", 9_000));
    expect(calcularRanking([ana, bia], d, SEMANA, cfg).linhas.map((l) => l.usuario.id)).toEqual(["bia", "ana"]);

    // tudo igual: quem chegou primeiro à pontuação.
    d = vazio();
    d.ganhos.push(g("x", "ana", "2026-10-22", 1_000), g("y", "bia", "2026-10-20", 1_000));
    const r = calcularRanking([ana, bia, caio], d, SEMANA, cfg);
    expect(r.linhas.map((l) => l.usuario.id)).toEqual(["bia", "ana", "caio"]);
    expect(r.linhas[0].alcancouEm).toEqual(sp("2026-10-20T10:00:00"));
    expect(r.linhas[2].alcancouEm).toBeNull();
  });
});

describe("calcularRanking — métricas e destaques", () => {
  function dados(): DadosRanking {
    const d = vazio();
    const g = (id: string, resp: string, valor: number | null, diasAteGanho: number) => {
      const dataGanho = sp("2026-10-21T10:00:00");
      return { oportunidadeId: id, titulo: `T ${id}`, responsavelId: resp, dataGanho, valorFechado: valor, criadoEm: new Date(dataGanho.getTime() - diasAteGanho * 86_400_000) };
    };
    d.ganhos.push(g("a1", "ana", 10_000, 10), g("a2", "ana", 30_000, 20), g("a3", "ana", null, 30), g("b1", "bia", 30_000, 4));
    d.perdas.push(
      { oportunidadeId: "p1", responsavelId: "ana", em: sp("2026-10-20T10:00:00") },
      { oportunidadeId: "p2", responsavelId: "bia", em: sp("2026-10-20T10:00:00") },
      { oportunidadeId: "p3", responsavelId: "bia", em: sp("2026-10-20T10:00:00") },
      { oportunidadeId: "p4", responsavelId: "bia", em: sp("2026-10-27T10:00:00") }, // fora
    );
    d.abertos.push({ responsavelId: "ana", quantidade: 4, orcamento: 12_000.5 }, { responsavelId: "caio", quantidade: 2, orcamento: 0 });
    return d;
  }

  it("conversão, ticket médio (só ganhos com valor), tempo até ganho e R$ em aberto", () => {
    const r = calcularRanking([ana, bia, caio], dados(), SEMANA, CFG);
    const a = r.linhas.find((l) => l.usuario.id === "ana")!;
    expect(a.ganhos).toBe(3);
    expect(a.perdidos).toBe(1);
    expect(a.conversao).toBe(0.75);
    expect(a.fechado).toBe(40_000);
    expect(a.ticketMedio).toBe(20_000);
    expect(a.tempoMedioGanhoDias).toBe(20);
    expect(a.abertos).toBe(4);
    expect(a.emAberto).toBe(12_000.5);
    const c = r.linhas.find((l) => l.usuario.id === "caio")!;
    expect(c.conversao).toBeNull();
    expect(c.ticketMedio).toBeNull();
    expect(c.tempoMedioGanhoDias).toBeNull();

    expect(r.time.ganhos).toBe(4);
    expect(r.time.perdidos).toBe(3);
    expect(r.time.conversao).toBeCloseTo(4 / 7);
    expect(r.time.fechado).toBe(70_000);
    expect(r.time.ticketMedio).toBeCloseTo(70_000 / 3);
    expect(r.time.tempoMedioGanhoDias).toBe(16);
    expect(r.time.abertos).toBe(6);
    expect(r.time.emAberto).toBe(12_000.5);
  });

  it("destaques com mínimos, empates (todos) e '—' sem dados", () => {
    const r = calcularRanking([ana, bia, caio], dados(), SEMANA, CFG);
    const d = Object.fromEntries(r.destaques.map((x) => [x.chave, x]));
    expect(d.liderVendas.vencedores.map((v) => v.usuario.id)).toEqual(["ana"]);
    expect(d.liderVendas.valor).toBe(40_000);
    expect(d.maisGanhos.vencedores.map((v) => v.usuario.id)).toEqual(["ana"]);
    // empate no maior ticket: os dois aparecem, com o card.
    expect(d.maiorTicket.valor).toBe(30_000);
    expect(d.maiorTicket.vencedores.map((v) => [v.usuario.id, v.card?.id])).toEqual([
      ["ana", "a2"],
      ["bia", "b1"],
    ]);
    // bia tem 3 fechados (1 ganho + 2 perdidos) = 33%; ana 75%.
    expect(d.melhorConversao.vencedores.map((v) => v.usuario.id)).toEqual(["ana"]);
    // fechamento mais rápido exige 2 ganhos: bia (4 dias, 1 ganho) fica de fora.
    expect(d.fechamentoMaisRapido.vencedores.map((v) => v.usuario.id)).toEqual(["ana"]);
    expect(d.fechamentoMaisRapido.valor).toBe(20);
    // ninguém avançou nem fez ação: vazio com dica.
    expect(d.maisAvancos.vencedores).toEqual([]);
    expect(d.maisAvancos.valor).toBeNull();
    expect(d.maisAcoes.vencedores).toEqual([]);
  });

  it("mínimo de fechados configurável deixa a conversão sem vencedor", () => {
    const cfg = { ...CFG, minimos: { ...CFG.minimos, fechadosConversao: 5 } };
    const d = Object.fromEntries(calcularRanking([ana, bia], dados(), SEMANA, cfg).destaques.map((x) => [x.chave, x]));
    expect(d.melhorConversao.vencedores).toEqual([]);
    expect(d.melhorConversao.dica).toContain("5");
  });
});

describe("montarFeed", () => {
  it("ganhos e avanços dos últimos 7 dias, mais recentes primeiro, só de participantes", () => {
    const agora = sp("2026-10-26T12:00:00");
    const d = vazio();
    d.ganhos.push(
      { oportunidadeId: "g1", titulo: "Padaria", responsavelId: "ana", dataGanho: sp("2026-10-25T10:00:00"), valorFechado: 5_000, criadoEm: sp("2026-10-01T10:00:00") },
      { oportunidadeId: "g2", titulo: "Velho", responsavelId: "ana", dataGanho: sp("2026-10-19T11:00:00"), valorFechado: 5_000, criadoEm: sp("2026-10-01T10:00:00") },
    );
    d.transicoes.push(tr("1", A, null, sp("2026-10-01T08:00:00")), tr("1", B, 0, sp("2026-10-24T09:00:00"), { usuarioId: "bia" }), tr("2", B, 0, sp("2026-10-24T09:00:00"), { usuarioId: "ivo" }));
    const f = montarFeed([ana, bia], d, agora);
    expect(f.map((i) => [i.tipo, i.oportunidadeId, i.usuario.id])).toEqual([
      ["GANHO", "g1", "ana"],
      ["AVANCO", "1", "bia"],
    ]);
  });
});

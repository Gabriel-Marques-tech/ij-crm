import { beforeEach, describe, expect, it } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { inicioDoDia } from "@/lib/oportunidades/campos";
import { criarPrazo, marcarPrazoFeito } from "@/lib/prazos/prazos";
import { carregarItensDaSemana, resolverVisao } from "./calendario";
import { resolverSemana } from "./semana";

const db = dbTeste();
const sp = (iso: string) => new Date(`${iso}-03:00`);
// Terça 27/10/2026, 10:00 de SP. Semana: 26/10 (seg) a 01/11 (dom).
const AGORA = sp("2026-10-27T10:00:00");
const SEMANA = resolverSemana(undefined, AGORA);

async function semear() {
  const vendas = await db.pipeline.create({
    data: {
      chave: "vendas",
      nome: "Vendas",
      ordem: 0,
      fases: {
        create: [
          { chave: "primeiro_contato", nome: "Primeiro Contato", ordem: 0 },
          { chave: "ganho", nome: "Ganho", ordem: 1, isTerminal: true, tipoTerminal: "GANHO" },
        ],
      },
    },
    include: { fases: true },
  });
  const ana = await db.usuario.create({ data: { nome: "Ana Vendas", email: "ana@ij.test" } });
  const bruno = await db.usuario.create({ data: { nome: "Bruno Lima", email: "bruno@ij.test" } });
  const ivo = await db.usuario.create({ data: { nome: "Ivo Inativo", email: "ivo@ij.test", ativo: false } });
  const principal = await db.empresa.create({ data: { nome: "Padaria Central" } });
  const mesclada = await db.empresa.create({ data: { nome: "Padaria do Zé", mergedIntoId: principal.id } });
  const fase = (chave: string) => vendas.fases.find((f) => f.chave === chave)!.id;
  const card = (titulo: string, dia: string | null, extra: { resp?: string; fase?: string; deletado?: boolean; empresaId?: string } = {}) =>
    db.oportunidade.create({
      data: {
        titulo,
        pipelineId: vendas.id,
        faseId: fase(extra.fase ?? "primeiro_contato"),
        responsavelId: extra.resp ?? ana.id,
        criadoVia: "UI",
        proximaAcao: `ação ${titulo}`,
        proximaAcaoEm: dia ? inicioDoDia(dia) : null,
        deletadoEm: extra.deletado ? new Date() : null,
        empresaId: extra.empresaId ?? null,
      },
    });
  return { ana, bruno, ivo, mesclada, card };
}

beforeEach(async () => {
  await limparBanco(["prazo", "transicao_fase", "timeline", "oportunidade", "fase", "pipeline", "empresa", "usuario"]);
  invalidarCachePipelines();
});

describe("carregarItensDaSemana", () => {
  it("ações: só cards abertos e vivos com próxima ação NA semana; vencida = antes de hoje; empresa mesclada pelo nome da principal", async () => {
    const s = await semear();
    await s.card("segunda", "2026-10-26", { empresaId: s.mesclada.id });
    await s.card("hoje", "2026-10-27");
    await s.card("domingo", "2026-11-01");
    await s.card("semana passada", "2026-10-25");
    await s.card("semana que vem", "2026-11-02");
    await s.card("sem data", null);
    await s.card("excluído", "2026-10-28", { deletado: true });
    await s.card("ganho", "2026-10-28", { fase: "ganho" });
    await s.card("do Bruno", "2026-10-28", { resp: s.bruno.id });

    const { acoes } = await carregarItensDaSemana({ responsavelIds: [s.ana.id] }, SEMANA, { id: s.ana.id, papel: "VENDEDOR" });
    expect(acoes.map((a) => [a.titulo, a.dia, a.vencida])).toEqual([
      ["segunda", "2026-10-26", true],
      ["hoje", "2026-10-27", false],
      ["domingo", "2026-11-01", false],
    ]);
    expect(acoes[0]).toMatchObject({ acao: "ação segunda", empresa: "Padaria Central", fase: "Primeiro Contato", responsavel: { id: s.ana.id, nome: "Ana Vendas", fotoEm: null } });

    const time = await carregarItensDaSemana("time", SEMANA, { id: s.ana.id, papel: "VENDEDOR" });
    expect(time.acoes.map((a) => a.titulo)).toContain("do Bruno");
  });

  it("prazos: estados vencido/feito/pendente, card na lixeira esconde o prazo, excluído some, permissão por item", async () => {
    const s = await semear();
    const gil = { id: (await db.usuario.create({ data: { nome: "Gil", email: "gil@ij.test", papel: "GESTOR" } })).id, papel: "GESTOR" as const };
    const ana = { id: s.ana.id, papel: "VENDEDOR" as const };
    const vivo = await s.card("vivo", null);
    const lixo = await s.card("lixo", null);
    const mk = async (titulo: string, dia: string, resp = s.ana.id, cardId?: string) => {
      const r = await criarPrazo(gil, { titulo, dia, responsavelId: resp, oportunidadeId: cardId ?? null });
      if (!r.ok) throw new Error(r.erro);
      return r.id;
    };
    await mk("vencido", "2026-10-26", s.ana.id, vivo.id);
    const feito = await mk("feito ontem", "2026-10-26");
    await marcarPrazoFeito(gil, feito, true);
    await mk("hoje", "2026-10-27");
    await mk("do Bruno", "2026-10-29", s.bruno.id);
    await mk("no lixo", "2026-10-29", s.ana.id, lixo.id);
    await mk("fora", "2026-11-02");
    await db.oportunidade.update({ where: { id: lixo.id }, data: { deletadoEm: new Date() } });

    const meu = await carregarItensDaSemana({ responsavelIds: [s.ana.id] }, SEMANA, ana);
    expect(meu.prazos.map((p) => [p.titulo, p.dia, p.estado])).toEqual([
      ["vencido", "2026-10-26", "vencido"],
      ["feito ontem", "2026-10-26", "feito"],
      ["hoje", "2026-10-27", "pendente"],
    ]);
    expect(meu.prazos[0].card).toEqual({ id: vivo.id, titulo: "vivo" });
    expect(meu.prazos.every((p) => p.podeMexer)).toBe(true);

    const time = await carregarItensDaSemana("time", SEMANA, ana);
    const doBruno = time.prazos.find((p) => p.titulo === "do Bruno")!;
    expect(doBruno.podeMexer).toBe(false);
    expect(time.prazos.map((p) => p.titulo)).not.toContain("no lixo");
  });
});

describe("resolverVisao", () => {
  it("padrão = Meu; time; pessoa só se ativa (senão volta para Meu); pessoa = eu vira Meu", async () => {
    const s = await semear();
    const ator = { id: s.ana.id, papel: "VENDEDOR" as const };
    expect((await resolverVisao(ator, {})).modo).toBe("meu");
    expect((await resolverVisao(ator, { ver: "time" })).modo).toBe("time");
    const p = await resolverVisao(ator, { pessoa: s.bruno.id });
    expect(p).toMatchObject({ modo: "pessoa", pessoa: { id: s.bruno.id, nome: "Bruno Lima" } });
    expect(p.opcoes.map((o) => o.nome)).toEqual(["Ana Vendas", "Bruno Lima"]);
    expect((await resolverVisao(ator, { pessoa: s.ivo.id })).modo).toBe("meu");
    expect((await resolverVisao(ator, { pessoa: s.ana.id })).modo).toBe("meu");
    expect((await resolverVisao(ator, { pessoa: "lixo" })).modo).toBe("meu");
  });
});

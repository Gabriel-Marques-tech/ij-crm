// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import type { Papel } from "@prisma/client";
import { dbTeste, limparBanco } from "@/test/db";
import { segundaDe } from "@/lib/calendario/semana";
import { somarDias } from "@/lib/projetos/proxima-acao";
import type { AtorGG } from "./organizacao";
import {
  cancelarDemanda,
  carregarRaci,
  criarEvento,
  criarKpi,
  criarProcesso,
  definirRaci,
  eventosDoUsuario,
  lembrarEventosGG,
  medirFonte,
  listarAusencias,
  registrarAusencia,
  registrarDemanda,
  registrarMedicao,
  saldoDemandas,
} from "./rotina";

const db = dbTeste();
const HOJE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

async function semear() {
  await db.areaOrg.createMany({ data: [{ id: "gg", nome: "Gente & Gestão", ehGG: true }, { id: "rh", nome: "RH", tipo: "FRENTE", superiorId: "gg" }, { id: "proj", nome: "Projetos", ladoCrm: "PROJETOS" }] });
  await db.cargoOrg.createMany({ data: [{ id: "ger", nome: "Gerente", categoria: "LIDERANCA" }, { id: "sm", nome: "Scrum Master", categoria: "LIDERANCA" }, { id: "dir", nome: "Diretor", categoria: "DIRETORIA" }] });
  await db.posicao.createMany({ data: [{ id: "p_grh", nome: "Gerência de RH", areaId: "rh", cargoId: "ger" }, { id: "p_sm", nome: "Scrum Master", areaId: "proj", cargoId: "sm" }] });
  const conta = async (nome: string, papel: Papel, posicaoId: string | null) => {
    const u = await db.usuario.create({ data: { nome, email: `${nome.toLowerCase()}@ij.test`, papel } });
    const m = await db.membro.create({ data: { nome, email: u.email, status: "ATIVO", usuarioId: u.id } });
    if (posicaoId) await db.ocupacao.create({ data: { membroId: m.id, posicaoId, principal: true } });
    return { ator: { id: u.id, nome, papel } as AtorGG, membroId: m.id };
  };
  const helena = await conta("Helena", "VISUALIZADOR", "p_grh"); // G&G edita mesmo sem papel de gestão no CRM
  const lucas = await conta("Lucas", "PROJETOS", "p_sm");
  const pedro = await conta("Pedro", "PROJETOS", "p_sm");
  const admin = await db.usuario.create({ data: { nome: "Alice", email: "alice@ij.test", papel: "ADMIN" } });
  return { helena, lucas, pedro, admin: { id: admin.id, nome: "Alice", papel: "ADMIN" } as AtorGG };
}

beforeEach(async () => {
  await limparBanco(["projeto_entrega", "projeto_checkin", "oportunidade", "fase", "pipeline", "aviso", "lembrete_evento", "ausencia", "evento_agenda", "demanda", "medicao_kpi", "kpi", "raci", "processo", "ocupacao", "vinculo_ij", "membro", "posicao", "cargo_org", "area_org", "usuario"]);
});

describe("demandas Rosa/Azul", () => {
  it("assina com o membro da conta; limite 2 rosas por semestre, mesmo em paralelo; cancelar libera", async () => {
    const { helena, lucas, admin } = await semear();
    expect(await registrarDemanda({ membroId: lucas.membroId, tipo: "ROSA", justificativa: "x" }, lucas.ator)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await registrarDemanda({ membroId: lucas.membroId, tipo: "ROSA", justificativa: "x" }, admin)).toEqual({ ok: false, erro: "SEM_MEMBRO" });
    const rs = await Promise.all([1, 2, 3, 4].map((i) => registrarDemanda({ membroId: lucas.membroId, tipo: "ROSA", justificativa: `Votação ${i}` }, helena.ator)));
    expect(rs.filter((r) => r.ok)).toHaveLength(2);
    expect(rs.find((r) => !r.ok)).toMatchObject({ erro: "LIMITE", detalhe: "Limite semestral atingido: 2 demandas rosas por membro." });
    expect(await saldoDemandas(lucas.membroId)).toEqual({ ROSA: 2, AZUL: 0 });
    const d = await db.demanda.findFirstOrThrow({ where: { membroId: lucas.membroId } });
    expect(d.registranteNome).toBe("Helena");
    expect(await cancelarDemanda(d.id, helena.ator)).toEqual({ ok: true });
    expect(await saldoDemandas(lucas.membroId)).toEqual({ ROSA: 1, AZUL: 0 });
  });
});

describe("agenda e ausências", () => {
  it("ausência só depois do evento e uma por pessoa; cada um vê só as próprias faltas", async () => {
    const { helena, lucas, pedro } = await semear();
    const passado = await criarEvento({ titulo: "RG", data: somarDias(HOJE, -1), horario: "19:00", categoria: "RG", areaId: null }, helena.ator);
    const futuro = await criarEvento({ titulo: "RG 2", data: somarDias(HOJE, 3), horario: null, categoria: "RG", areaId: null }, helena.ator);
    if (!passado.ok || !futuro.ok) throw new Error();
    expect(await registrarAusencia({ eventoId: futuro.id!, membroId: lucas.membroId, justificada: true, observacao: null }, helena.ator)).toEqual({ ok: false, erro: "EVENTO_FUTURO" });
    expect(await registrarAusencia({ eventoId: passado.id!, membroId: lucas.membroId, justificada: false, observacao: null }, helena.ator)).toEqual({ ok: true });
    expect(await registrarAusencia({ eventoId: passado.id!, membroId: lucas.membroId, justificada: true, observacao: null }, helena.ator)).toEqual({ ok: false, erro: "JA_REGISTRADA" });
    expect((await listarAusencias(lucas.ator)).map((a) => a.membro)).toEqual(["Lucas"]);
    expect(await listarAusencias(pedro.ator)).toEqual([]);
    expect(await listarAusencias(helena.ator)).toHaveLength(1);
  });

  it("evento de área atinge quem é da área (e das frentes); lembrete uma vez por pessoa", async () => {
    const { helena, lucas } = await semear();
    await criarEvento({ titulo: "Reunião de Projetos", data: somarDias(HOJE, 2), horario: "18:30", categoria: "REUNIAO", areaId: "proj" }, helena.ator);
    await criarEvento({ titulo: "Reunião de G&G", data: somarDias(HOJE, 1), horario: null, categoria: "REUNIAO", areaId: "gg" }, helena.ator);
    await criarEvento({ titulo: "RG", data: HOJE, horario: null, categoria: "RG", areaId: null }, helena.ator);
    await criarEvento({ titulo: "RG de G&G", data: HOJE, horario: null, categoria: "RG", areaId: "gg" }, helena.ator); // RG vai para todos, mesmo com área
    expect((await eventosDoUsuario(lucas.ator.id, HOJE, somarDias(HOJE, 6))).map((e) => e.titulo).sort()).toEqual(["RG", "RG de G&G", "Reunião de Projetos"]);
    expect((await eventosDoUsuario(helena.ator.id, HOJE, somarDias(HOJE, 6))).map((e) => e.titulo).sort()).toEqual(["RG", "RG de G&G", "Reunião de G&G"]); // RH é frente de G&G
    expect((await lembrarEventosGG()).lembretes).toBe(9); // RG x3 + RG de G&G x3 + Projetos x2 (Lucas, Pedro) + G&G x1 (Helena)
    expect((await lembrarEventosGG()).lembretes).toBe(0);
    expect(await db.aviso.count({ where: { tipo: "LEMBRETE_GG", usuarioId: lucas.ator.id } })).toBe(3);
  });
});

describe("metas e RACI", () => {
  it("KPI medido pelo CRM recusa medição manual; manual aceita uma por dia", async () => {
    const { helena } = await semear();
    const auto = await criarKpi({ titulo: "Check-ins vermelhos", unidade: "projetos", meta: 0, direcao: "MENOR", fonte: "checkins_vermelhos" }, helena.ator);
    const manual = await criarKpi({ titulo: "Turnover", unidade: "%", meta: 10, direcao: "MENOR", fonte: null }, helena.ator);
    if (!auto.ok || !manual.ok) throw new Error();
    expect(await registrarMedicao(auto.id!, HOJE, 1, helena.ator)).toEqual({ ok: false, erro: "FONTE_AUTOMATICA" });
    expect(await registrarMedicao(manual.id!, HOJE, 9, helena.ator)).toEqual({ ok: true });
    expect(await registrarMedicao(manual.id!, HOJE, 8, helena.ator)).toEqual({ ok: false, erro: "JA_MEDIDO" });
    expect(await db.medicaoKpi.count({ where: { kpiId: auto.id } })).toBe(1); // medido na criação
  });

  it("fontes do CRM: check-in vale o último da semana por projeto; projeto na lixeira não conta", async () => {
    const { admin } = await semear();
    const pipe = await db.pipeline.create({ data: { chave: "projetos", nome: "Projetos", ordem: 0, fases: { create: [{ chave: "p1", nome: "Fase", ordem: 0 }] } }, include: { fases: true } });
    const card = (titulo: string, deletadoEm: Date | null = null) => db.projeto.create({ data: { pipelineId: pipe.id, faseId: pipe.fases[0].id, titulo, responsavelId: admin.id, criadoVia: "UI", deletadoEm } });
    const [a, b, c] = [await card("A"), await card("B"), await card("C", new Date())];
    const semana = segundaDe(HOJE);
    const checkin = (projetoId: string, status: "VERDE" | "VERMELHO", minuto: number) =>
      db.projetoCheckin.create({ data: { projetoId, status, motivo: "x", semana: new Date(`${semana}T00:00:00Z`), porId: admin.id, em: new Date(Date.now() - (60 - minuto) * 60_000) } });
    await checkin(a.id, "VERMELHO", 1);
    await checkin(a.id, "VERMELHO", 2); // dois vermelhos no mesmo projeto: um projeto
    await checkin(b.id, "VERMELHO", 1);
    await checkin(b.id, "VERDE", 2); // o último é o status
    await checkin(c.id, "VERMELHO", 1); // na lixeira
    expect(await medirFonte("checkins_vermelhos")).toBe(1);
    const entrega = (projetoId: string, ordem: number, previsto: string) =>
      db.projetoEntrega.create({ data: { projetoId, ordem, titulo: "E", origem: "MANUAL", previstoOriginal: new Date(`${previsto}T00:00:00Z`), previstoAtual: new Date(`${previsto}T00:00:00Z`), realizadoEm: new Date(`${HOJE}T00:00:00Z`) } });
    await entrega(a.id, 1, HOJE); // no prazo
    await entrega(c.id, 1, `${HOJE.slice(0, 4)}-01-01`); // atrasada, mas na lixeira
    expect(await medirFonte("projetos_no_prazo")).toBe(100);
  });

  it("um A por processo: o A anterior vira R", async () => {
    const { helena } = await semear();
    const p = await criarProcesso("Onboarding", helena.ator);
    if (!p.ok) throw new Error();
    await definirRaci(p.id!, "dir", "A", helena.ator);
    await definirRaci(p.id!, "ger", "A", helena.ator);
    await definirRaci(p.id!, "sm", "C", helena.ator);
    expect((await carregarRaci()).processos[0].papeis).toEqual({ dir: "R", ger: "A", sm: "C" });
    await definirRaci(p.id!, "sm", null, helena.ator);
    expect((await carregarRaci()).processos[0].papeis).toEqual({ dir: "R", ger: "A" });
  });
});

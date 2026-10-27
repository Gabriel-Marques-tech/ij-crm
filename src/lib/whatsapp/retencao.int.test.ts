// @vitest-environment node
// GAB-41: retenção LGPD (90 dias) do JSON da LLM; o texto original fica.
import { beforeEach, describe, expect, it } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { semear } from "../../../prisma/seed";
import { apagarJsonLlmVencido, apagarSemTagNaoConfirmadas } from "./retencao";

const dbT = dbTeste();
const AGORA = new Date("2026-10-27T15:00:00Z");
const dias = (n: number) => new Date(AGORA.getTime() - n * 86_400_000);
const LLM = { versao: "extracao.v2", modelo: "m", saida: { contato: { nome: "Gustavo" } }, aplicacao: { tipo: "CRIADO" } };

let opId = "";
let usuarioId = "";
let seq = 0;

async function mensagem(recebidaEm: Date, comLlm = true) {
  seq++;
  return dbT.mensagemBruta.create({
    data: { eventoId: `EVT-RET${seq}`, grupoJid: "g@g.us", texto: "#crm Gustavo", recebidaEm, status: "PROCESSADA", ...(comLlm ? { resultadoLlm: LLM } : {}) },
  });
}

async function entrada(em: Date, mensagemBrutaId: string | null) {
  return dbT.timeline.create({
    data: { oportunidadeId: opId, tipo: "MENSAGEM_WHATSAPP", em, usuarioId, mensagemBrutaId, payload: { texto: "#crm Gustavo", versao: "extracao.v2", saida: LLM.saida, motivosRevisar: [] } },
  });
}

beforeEach(async () => {
  await limparBanco(["timeline", "transicao_fase", "oportunidade", "fase", "pipeline", "mensagem_bruta", "usuario"]);
  await semear(dbT, { log: () => {} });
  const u = await dbT.usuario.create({ data: { nome: "João", email: "joao@ij.test" } });
  usuarioId = u.id;
  const fase = await dbT.fase.findFirstOrThrow({ where: { pipeline: { chave: "vendas" }, isTerminal: false } });
  opId = (await dbT.oportunidade.create({ data: { titulo: "Card", pipelineId: fase.pipelineId, faseId: fase.id, responsavelId: u.id, criadoVia: "UI" } })).id;
});

describe("apagarJsonLlmVencido", () => {
  it("apaga resultado_llm e o `saida` da Timeline com mais de 90 dias; texto fica", async () => {
    const velha = await mensagem(dias(91));
    const nova = await mensagem(dias(89));
    const tVelha = await entrada(dias(91), velha.id);
    const tNova = await entrada(dias(89), nova.id);

    const r = await apagarJsonLlmVencido({ agora: AGORA });
    expect(r).toEqual({ mensagens: 1, timeline: 1 });

    const v = await dbT.mensagemBruta.findUniqueOrThrow({ where: { id: velha.id } });
    expect(v.resultadoLlm).toBeNull();
    expect(v.texto).toBe("#crm Gustavo");
    expect((await dbT.mensagemBruta.findUniqueOrThrow({ where: { id: nova.id } })).resultadoLlm).toEqual(LLM);

    const pv = (await dbT.timeline.findUniqueOrThrow({ where: { id: tVelha.id } })).payload as Record<string, unknown>;
    expect(pv).toEqual({ texto: "#crm Gustavo", versao: "extracao.v2", motivosRevisar: [] });
    const pn = (await dbT.timeline.findUniqueOrThrow({ where: { id: tNova.id } })).payload as Record<string, unknown>;
    expect(pn.saida).toEqual(LLM.saida);
  });

  it("idempotente e em lotes", async () => {
    for (let i = 0; i < 5; i++) await entrada(dias(100), (await mensagem(dias(100))).id);
    expect(await apagarJsonLlmVencido({ agora: AGORA, lote: 2 })).toEqual({ mensagens: 5, timeline: 5 });
    expect(await apagarJsonLlmVencido({ agora: AGORA, lote: 2 })).toEqual({ mensagens: 0, timeline: 0 });
  });

  it("para no teto de lotes por execução (o resto fica para a próxima)", async () => {
    for (let i = 0; i < 5; i++) await mensagem(dias(100));
    expect((await apagarJsonLlmVencido({ agora: AGORA, lote: 2, maxLotes: 2 })).mensagens).toBe(4);
    expect((await apagarJsonLlmVencido({ agora: AGORA, lote: 2, maxLotes: 2 })).mensagens).toBe(1);
  });
});

describe("apagarSemTagNaoConfirmadas (30 dias)", () => {
  async function semTag(status: "FALHA" | "PENDENTE_REVISAO" | "PROCESSADA" | "RECEBIDA", diasAtras: number, semTag = true) {
    seq++;
    return dbT.mensagemBruta.create({
      data: { eventoId: `EVT-ST${seq}`, grupoJid: "g@g.us", texto: "conversa do grupo", recebidaEm: dias(diasAtras), status, semTag },
    });
  }

  it("apaga linha e texto de sem-tag FALHA/PENDENTE com mais de 30 dias; o resto fica", async () => {
    const falhaVelha = await semTag("FALHA", 31);
    const pendVelha = await semTag("PENDENTE_REVISAO", 40);
    const pendNova = await semTag("PENDENTE_REVISAO", 29);
    const processada = await semTag("PROCESSADA", 60);
    const recebida = await semTag("RECEBIDA", 60);
    const comTag = await semTag("FALHA", 60, false);
    expect(await apagarSemTagNaoConfirmadas({ agora: AGORA })).toBe(2);
    const restantes = (await dbT.mensagemBruta.findMany({ select: { id: true } })).map((m) => m.id).sort();
    expect(restantes).toEqual([pendNova.id, processada.id, recebida.id, comTag.id].sort());
    expect(restantes).not.toContain(falhaVelha.id);
    expect(restantes).not.toContain(pendVelha.id);
    expect(await apagarSemTagNaoConfirmadas({ agora: AGORA })).toBe(0);
  });

  it("linha referenciada pela Timeline não é apagada (nunca quebra FK)", async () => {
    const m = await semTag("PENDENTE_REVISAO", 40);
    await entrada(dias(40), m.id);
    expect(await apagarSemTagNaoConfirmadas({ agora: AGORA })).toBe(0);
  });

  it("em lotes", async () => {
    for (let i = 0; i < 5; i++) await semTag("FALHA", 50);
    expect(await apagarSemTagNaoConfirmadas({ agora: AGORA, lote: 2 })).toBe(5);
  });
});

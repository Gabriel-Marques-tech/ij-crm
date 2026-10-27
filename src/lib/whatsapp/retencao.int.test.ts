// @vitest-environment node
// GAB-41: retenção LGPD (90 dias) do JSON da LLM; o texto original fica.
import { beforeEach, describe, expect, it } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { semear } from "../../../prisma/seed";
import { apagarJsonLlmVencido } from "./retencao";

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

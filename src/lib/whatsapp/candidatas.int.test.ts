// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { semear } from "../../../prisma/seed";
import { alvoDaResposta, oportunidadesCandidatas } from "./candidatas";

const dbT = dbTeste();
const TABELAS = ["timeline", "transicao_fase", "mensagem_enviada", "oportunidade", "contato_ponto", "contato", "empresa", "fase", "pipeline", "usuario"];
const DIA = 24 * 60 * 60 * 1000;
const AGORA = new Date("2026-10-26T12:00:00Z");

let joao: { id: string };

async function card(faseChave: string, extra: Record<string, unknown> = {}, pipeline = "vendas") {
  const fase = await dbT.fase.findFirstOrThrow({ where: { chave: faseChave, pipeline: { chave: pipeline } } });
  return dbT.oportunidade.create({
    data: { pipelineId: fase.pipelineId, faseId: fase.id, titulo: "Card", responsavelId: joao.id, criadoVia: "UI", ...extra },
  });
}

beforeEach(async () => {
  await limparBanco(TABELAS);
  await semear(dbT, { log: () => {} });
  joao = await dbT.usuario.create({ data: { nome: "João", email: "joao@ij.test" } });
});

describe("oportunidadesCandidatas", () => {
  it("cards fechados nunca empurram o aberto para fora do limite (12 fechados + 1 aberto)", async () => {
    const c = await dbT.contato.create({ data: { nome: "Gustavo" } });
    const aberto = await card("primeiro_contato", { contatoId: c.id, atualizadoEm: new Date("2020-01-01T00:00:00Z") });
    for (let i = 0; i < 12; i++) await card(i % 2 ? "perdido" : "contrato_assinado", { contatoId: c.id });
    const r = await oportunidadesCandidatas({ remetenteUsuarioId: null, recebidaEm: AGORA, contatoIds: [c.id], empresas: [], alvoResposta: null });
    expect(r.map((x) => x.id)).toContain(aberto.id);
    expect(r.find((x) => x.id === aberto.id)).toMatchObject({ terminal: false, via: ["contato"] });
    expect(r.filter((x) => x.terminal).length).toBeLessThanOrEqual(5);
  });
});

describe("alvoDaResposta — reply fixa o alvo só com confirmação recente e card vivo em vendas", () => {
  async function enviada(oportunidadeId: string | null, em: Date) {
    await dbT.mensagemEnviada.create({ data: { eventoId: "BOT1", grupoJid: "g@g.us", texto: "✅ …", oportunidadeId, em } });
  }

  it("confirmação de até 30 dias de um card vivo → o card", async () => {
    const op = await card("primeiro_contato");
    await enviada(op.id, new Date(AGORA.getTime() - 29 * DIA));
    expect(await alvoDaResposta("BOT1", AGORA, dbT)).toEqual({ tipo: "CARD", id: op.id });
  });

  it("mais de 30 dias → inválida (não cai em CRIAR)", async () => {
    const op = await card("primeiro_contato");
    await enviada(op.id, new Date(AGORA.getTime() - 31 * DIA));
    expect(await alvoDaResposta("BOT1", AGORA, dbT)).toEqual({ tipo: "INVALIDA", motivo: "RESPOSTA_ANTIGA" });
  });

  it("card na lixeira → inválida; card de projetos → inválida", async () => {
    const op = await card("primeiro_contato", { deletadoEm: new Date() });
    await enviada(op.id, AGORA);
    expect(await alvoDaResposta("BOT1", AGORA, dbT)).toEqual({ tipo: "INVALIDA", motivo: "RESPOSTA_CARD_REMOVIDO" });
    await dbT.mensagemEnviada.deleteMany();
    const proj = await card("em_execucao", {}, "projetos");
    await enviada(proj.id, AGORA);
    expect(await alvoDaResposta("BOT1", AGORA, dbT)).toEqual({ tipo: "INVALIDA", motivo: "RESPOSTA_FORA_DE_VENDAS" });
  });

  it("reply a mensagem que não é confirmação com card (ou sem reply) → null", async () => {
    await enviada(null, AGORA);
    expect(await alvoDaResposta("BOT1", AGORA, dbT)).toBeNull();
    expect(await alvoDaResposta("NAO-EXISTE", AGORA, dbT)).toBeNull();
    expect(await alvoDaResposta(null, AGORA, dbT)).toBeNull();
  });
});

// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { semear } from "../../../prisma/seed";
import { janelaDe } from "./janela";
import { MAX_LEDGER, cardsDaJanela, cardsDoLedger, ledgerDaJanela } from "./ledger";

const dbT = dbTeste();
const TABELAS = ["timeline", "transicao_fase", "mensagem_enviada", "oportunidade", "contato", "empresa", "fase", "pipeline", "mensagem_bruta", "usuario"];
const AGORA = new Date("2026-10-27T14:00:00Z"); // 11:00 SP → janela da manhã (03:00Z–15:00Z)
const min = (m: number) => new Date(AGORA.getTime() + m * 60_000);

let joao: { id: string };
let maria: { id: string };
let seq = 0;

async function bruta(texto: string, extra: Record<string, unknown> = {}) {
  seq++;
  return dbT.mensagemBruta.create({
    data: { eventoId: `L${seq}`, grupoJid: "g@g.us", texto, recebidaEm: AGORA, remetenteUsuarioId: joao.id, status: "PROCESSADA", ...extra },
  });
}

async function card(titulo: string, extra: Record<string, unknown> = {}, pipeline = "vendas") {
  const fase = await dbT.fase.findFirstOrThrow({ where: { pipeline: { chave: pipeline } }, orderBy: { ordem: "asc" } });
  return dbT.projeto.create({ data: { pipelineId: fase.pipelineId, faseId: fase.id, titulo, responsavelId: joao.id, criadoVia: "UI", ...extra } });
}

async function mexeu(mensagemBrutaId: string, projetoId: string) {
  await dbT.timeline.create({ data: { projetoId, tipo: "MENSAGEM_WHATSAPP", mensagemBrutaId, usuarioId: joao.id } });
}

beforeEach(async () => {
  await limparBanco(TABELAS);
  await semear(dbT, { log: () => {} });
  joao = await dbT.usuario.create({ data: { nome: "João", email: "joao@ij.test" } });
  maria = await dbT.usuario.create({ data: { nome: "Maria", email: "maria@ij.test" } });
});

describe("ledgerDaJanela — derivado de mensagem_bruta (remetente + janela)", () => {
  it("só do remetente, só da janela, só o que foi gravado como venda; o mais recente primeiro", async () => {
    const a = await bruta("falei com o Gustavo", { recebidaEm: min(-60) });
    const b = await bruta("é da Economia Sensata", { recebidaEm: min(-10), semTag: true, status: "PROCESSADA" });
    await bruta("da Maria", { remetenteUsuarioId: maria.id, recebidaEm: min(-5) });
    await bruta("janela anterior", { recebidaEm: new Date("2026-10-27T02:59:00Z") });
    await bruta("irrelevante", { recebidaEm: min(-3), status: "CLASSIFICADA_IRRELEVANTE" });
    const atual = await bruta("mando proposta sexta", { status: "PROCESSANDO" });
    await bruta("depois da atual", { recebidaEm: min(5) });

    const l = await ledgerDaJanela({ usuarioId: joao.id, janela: janelaDe(AGORA), ate: AGORA, excluirId: atual.id }, dbT);
    expect(l.map((x) => x.id)).toEqual([b.id, a.id]);
    expect(l[0]).toMatchObject({ texto: "é da Economia Sensata", em: min(-10), card: null, situacao: null });
  });

  it("#crm entra em qualquer status, com a situação; sem tag só PROCESSADA", async () => {
    const st = ["RECEBIDA", "PROCESSANDO", "PENDENTE_REVISAO", "FALHA", "PROCESSADA"] as const;
    for (const [i, status] of st.entries()) {
      await bruta(`crm ${status}`, { recebidaEm: min(-20 + i), status });
      await bruta(`semtag ${status}`, { recebidaEm: min(-10 + i), status, semTag: true });
    }
    const l = await ledgerDaJanela({ usuarioId: joao.id, janela: janelaDe(AGORA), ate: AGORA }, dbT);
    expect(l.map((x) => [x.texto, x.situacao])).toEqual([
      ["semtag PROCESSADA", null],
      ["crm PROCESSADA", null],
      ["crm FALHA", "falhou"],
      ["crm PENDENTE_REVISAO", "pendente de revisão"],
      ["crm PROCESSANDO", "em processamento"],
      ["crm RECEBIDA", "em processamento"],
    ]);
  });

  it("sem `ate`: a janela inteira", async () => {
    await bruta("1", { recebidaEm: min(-60) });
    await bruta("2", { recebidaEm: min(59) });
    await bruta("fora", { recebidaEm: min(61) });
    expect((await ledgerDaJanela({ usuarioId: joao.id, janela: janelaDe(AGORA) }, dbT)).map((x) => x.texto)).toEqual(["2", "1"]);
  });

  it("card que a mensagem mexeu (Timeline), só se vivo e em vendas", async () => {
    const vivo = await card("Gustavo — Economia Sensata");
    const lixeira = await card("Velho", { deletadoEm: new Date() });
    const proj = await card("Projeto", {}, "projetos");
    const m1 = await bruta("1", { recebidaEm: min(-3) });
    const m2 = await bruta("2", { recebidaEm: min(-2) });
    const m3 = await bruta("3", { recebidaEm: min(-1) });
    await mexeu(m1.id, vivo.id);
    await mexeu(m2.id, lixeira.id);
    await mexeu(m3.id, proj.id);
    const l = await ledgerDaJanela({ usuarioId: joao.id, janela: janelaDe(AGORA), ate: AGORA }, dbT);
    expect(l.map((x) => x.card)).toEqual([null, null, { id: vivo.id, titulo: "Gustavo — Economia Sensata" }]);
  });

  it("cardsDaJanela: consulta própria — vê o card antigo mesmo com mais de MAX_LEDGER mensagens depois", async () => {
    const antigo = await card("Antigo");
    const novo = await card("Novo");
    const m0 = await bruta("primeira", { recebidaEm: min(-200) });
    await mexeu(m0.id, antigo.id);
    for (let i = 0; i < MAX_LEDGER + 5; i++) {
      const m = await bruta(`msg ${i}`, { recebidaEm: min(-100 + i) });
      await mexeu(m.id, novo.id);
    }
    const semTagPendente = await bruta("sem tag pendente", { recebidaEm: min(-150), semTag: true, status: "PENDENTE_REVISAO" });
    const outro = await card("Outro");
    await mexeu(semTagPendente.id, outro.id);
    const recorte = { usuarioId: joao.id, janela: janelaDe(AGORA), ate: AGORA };
    const ledger = await ledgerDaJanela(recorte, dbT);
    expect(ledger).toHaveLength(MAX_LEDGER);
    expect(cardsDoLedger(ledger)).toEqual([novo.id]); // o ledger cortado não vê o antigo
    expect(await cardsDaJanela(recorte, 5, dbT)).toEqual([novo.id, antigo.id]);
  });

  it("cardsDoLedger: ids distintos, do mais recente, com limite", () => {
    const e = (id: string | null) => ({ id: "m", em: AGORA, texto: "", card: id ? { id, titulo: id } : null });
    expect(cardsDoLedger([e("b"), e(null), e("a"), e("b"), e("c")], 2)).toEqual(["b", "a"]);
  });
});

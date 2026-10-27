// @vitest-environment node
/**
 * ATUALIZAR pelo WhatsApp (GAB-38), ponta a ponta por `processarMensagem`
 * com a LLM mockada. O mock "faz o papel da LLM" lendo o prompt montado —
 * assim o teste também prova que a candidata certa estava no contexto.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolverDataRelativa } from "@/lib/llm/datas";
import { RECEBIDA_EM, saida } from "@/lib/llm/fixtures/extracao";
import { definirRespostaMock } from "@/lib/llm/provedores/mock";
import type { PedidoExtracao } from "@/lib/llm/tipos";
import { diaEmFuso } from "@/lib/oportunidades/aging";
import { dbTeste, limparBanco } from "@/test/db";
import { semear } from "../../../prisma/seed";
import { MOTIVO_SEM_IDENTIDADE } from "./alvo";
import { processarMensagem } from "./processar";

/** Alvo só pela conversa recente (sem identificador exato): vale, mas sempre com revisar. */
const SEM_ID = `\nMarquei para revisar: ${MOTIVO_SEM_IDENTIDADE}.`;

const dbT = dbTeste();
const GRUPO = "120363000000000001@g.us";
const TABELAS = [
  "timeline",
  "transicao_fase",
  "mensagem_enviada",
  "oportunidade",
  "contato_ponto",
  "contato",
  "empresa",
  "fase",
  "pipeline",
  "mensagem_bruta",
  "inbox_evento",
  "sessao",
  "usuario",
];
const envOriginal = { ...process.env };
const MIN = 60_000;

let joao: { id: string };
let maria: { id: string };
let seq = 0;

async function bruta(texto: string, extra: Record<string, unknown> = {}) {
  seq++;
  return dbT.mensagemBruta.create({
    data: {
      eventoId: `EVT${seq}`,
      grupoJid: GRUPO,
      texto,
      recebidaEm: RECEBIDA_EM,
      remetenteTelefone: "+5511999998888",
      remetenteUsuarioId: joao.id,
      status: "RECEBIDA",
      ...extra,
    },
  });
}

/** Processa uma mensagem nova e devolve o resultado + o prompt que a "LLM" viu. */
async function enviar(texto: string, resposta: (pedido: PedidoExtracao) => unknown, extra: Record<string, unknown> = {}) {
  let prompt = "";
  definirRespostaMock((_, pedido) => {
    prompt = pedido.usuario;
    return resposta(pedido);
  });
  const m = await bruta(texto, extra);
  const r = await processarMensagem(m.id);
  return { r, prompt, m };
}

/** O que a LLM faria: copia o id de uma candidata do contexto. */
function idCandidata(pedido: PedidoExtracao, via: string): string {
  const linha = pedido.usuario.split("\n").find((l) => l.startsWith("- id=") && new RegExp(`via=\\S*${via}`).test(l));
  if (!linha) throw new Error(`sem candidata via=${via} no prompt`);
  return /- id=(\S+)/.exec(linha)![1];
}

let eventosBot = 0;
/** Liga o envio real (fetch mockado): a Evolution devolve um key.id por confirmação. */
function ligarEnvio() {
  process.env.NOTIFICATIONS_ENABLED = "true";
  process.env.EVOLUTION_API_URL = "http://evolution.test:8080";
  process.env.EVOLUTION_API_KEY = "chave-evolution-de-teste-0123456789abcdef";
  process.env.EVOLUTION_INSTANCE = "ij-crm";
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ key: { id: `BOT${++eventosBot}` } }));
}

async function cardDe(id: string) {
  return dbT.oportunidade.findUniqueOrThrow({ where: { id }, include: { fase: true, empresa: true, contato: { include: { pontos: true } } } });
}

beforeEach(async () => {
  await limparBanco(TABELAS);
  await semear(dbT, { log: () => {} });
  joao = await dbT.usuario.create({ data: { nome: "João", email: "joao@ij.test", telefoneWhatsapp: "+5511999998888" } });
  maria = await dbT.usuario.create({ data: { nome: "Maria", email: "maria@ij.test" } });
  process.env.LLM_PROVEDOR = "mock";
  delete process.env.NOTIFICATIONS_ENABLED;
  delete process.env.LLM_LIMIAR_CONFIANCA;
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  definirRespostaMock(null);
  vi.restoreAllMocks();
  process.env = { ...envOriginal };
});

describe("ponta a ponta: criar → atualizar → mover → reply-corrigir", () => {
  it("o mesmo card do começo ao fim; cada confirmação vira MensagemEnviada; o reply corrige sem a LLM decidir", async () => {
    const fetchSpy = ligarEnvio();

    // 1. criar (a LLM leu a empresa errada)
    const c = await enviar("#crm falei com o Gustavo da Sensata Ltda, relatório manual", () =>
      saida({ contato: { nome: "Gustavo" }, empresa: { nome: "Sensata Ltda" }, campos: { dor: "relatório manual" } }),
    );
    expect(c.r).toMatchObject({ tipo: "PROCESSADA", confirmacao: "✅ Gustavo — Sensata Ltda → Primeiro Contato. Resp: João." });
    const id = (c.r as { oportunidadeId: string }).oportunidadeId;
    expect(await dbT.mensagemEnviada.findUnique({ where: { eventoId: "BOT1" } })).toMatchObject({ oportunidadeId: id });

    // 2. atualizar (sem mover): a LLM escolhe o card recente da lista
    const a = await enviar(
      "#crm mando proposta sexta",
      (p) => saida({ intencao: "ATUALIZAR", oportunidade_id: idCandidata(p, "recente"), campos: { proxima_acao: "mandar proposta", proxima_acao_em: "sexta" } }),
      { recebidaEm: new Date(RECEBIDA_EM.getTime() + MIN) },
    );
    expect(a.prompt).toMatch(new RegExp(`- id=${id} titulo="Gustavo — Sensata Ltda" fase="Primeiro Contato" via=recente`));
    expect(a.r).toMatchObject({ tipo: "PROCESSADA", oportunidadeId: id, confirmacao: "✅ Gustavo — Sensata Ltda (Primeiro Contato): atualizado. Próx.: mandar proposta (31/10)" });

    // 3. mover — caso do ticket
    const mv = await enviar(
      "#crm Gustavo topou, vai pra reunião diagnóstica quinta",
      (p) =>
        saida({
          intencao: "ATUALIZAR",
          oportunidade_id: idCandidata(p, "recente"),
          contato: { nome: "Gustavo" },
          fase_chave: "reuniao_diagnostica",
          campos: { proxima_acao: "reunião", proxima_acao_em: "quinta" },
        }),
      { recebidaEm: new Date(RECEBIDA_EM.getTime() + 2 * MIN) },
    );
    expect(mv.r).toMatchObject({ tipo: "PROCESSADA", oportunidadeId: id, confirmacao: "✅ Gustavo — Sensata Ltda: Primeiro Contato → Reunião Diagnóstica. Próx.: reunião (30/10)" });
    const eventoMove = `BOT${eventosBot}`;
    expect(await dbT.mensagemEnviada.findUnique({ where: { eventoId: eventoMove } })).toMatchObject({ oportunidadeId: id });

    // 4. reply à confirmação do movimento corrigindo a empresa. A LLM até erra a intenção — o reply manda.
    const rp = await enviar(
      "#crm na verdade é a Economia Sensata, não a Sensata Ltda",
      () => saida({ intencao: "CRIAR", empresa: { nome: "Economia Sensata" } }),
      { respondendoEventoId: eventoMove, recebidaEm: new Date(RECEBIDA_EM.getTime() + 3 * MIN) },
    );
    expect(rp.prompt).toContain(`Card da confirmação respondida: id=${id}`);
    expect(rp.prompt).toMatch(/<respondendo_a>\n✅ Gustavo — Sensata Ltda: Primeiro Contato → Reunião Diagnóstica/);
    expect(rp.r).toMatchObject({ tipo: "PROCESSADA", oportunidadeId: id, confirmacao: "⚠️ Gustavo — Economia Sensata (Reunião Diagnóstica): atualizado.\nMarquei para revisar: empresa corrigida por resposta: “Sensata Ltda” → “Economia Sensata”.",
    });

    // estado final: 1 card só, empresa corrigida (contato também), nada apagado
    expect(await dbT.oportunidade.count()).toBe(1);
    const card = await cardDe(id);
    expect(card).toMatchObject({ titulo: "Gustavo — Economia Sensata", dor: "relatório manual", proximaAcao: "reunião", revisar: true });
    expect(card.fase.chave).toBe("reuniao_diagnostica");
    expect(diaEmFuso(card.proximaAcaoEm!)).toBe("2025-10-30");
    expect(card.empresa?.nome).toBe("Economia Sensata");
    // contato que já tinha empresa nunca é reescrito pelo WhatsApp
    expect((await dbT.empresa.findUniqueOrThrow({ where: { id: card.contato!.empresaId! } })).nome).toBe("Sensata Ltda");

    const tr = await dbT.transicaoFase.findMany({ where: { oportunidadeId: id }, orderBy: { em: "asc" }, include: { paraFase: true } });
    expect(tr.map((t) => [t.paraFase.chave, t.origem, t.usuarioId])).toEqual([
      ["primeiro_contato", "WHATSAPP", joao.id],
      ["reuniao_diagnostica", "WHATSAPP", joao.id],
    ]);
    const tl = await dbT.timeline.findMany({ where: { oportunidadeId: id }, orderBy: [{ em: "asc" }, { id: "asc" }] });
    expect(tl.filter((t) => t.tipo === "MENSAGEM_WHATSAPP")).toHaveLength(4);
    expect(tl.filter((t) => t.tipo === "MOVIMENTACAO")).toHaveLength(1);
    expect(tl.find((t) => t.tipo === "CAMPO_ALTERADO" && (t.payload as { campo: string }).campo === "empresa")?.payload).toMatchObject({
      antes: "Sensata Ltda",
      depois: "Economia Sensata",
      motivo: "correção por resposta a confirmação",
    });

    // uma MensagemEnviada por confirmação, todas apontando o card
    const enviadas = await dbT.mensagemEnviada.findMany();
    expect(enviadas).toHaveLength(4);
    expect(new Set(enviadas.map((x) => x.oportunidadeId))).toEqual(new Set([id]));
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });
});

describe("mensagens picadas", () => {
  it("3 mensagens em 2 min ('falei com o Gustavo' / 'é da Economia Sensata' / 'mando proposta sexta') → o mesmo card", async () => {
    const t0 = RECEBIDA_EM.getTime();
    const r1 = await enviar("#crm falei com o Gustavo", () => saida({ contato: { nome: "Gustavo" } }));
    const id = (r1.r as { oportunidadeId: string }).oportunidadeId;
    const r2 = await enviar(
      "#crm é da Economia Sensata",
      (p) => saida({ intencao: "ATUALIZAR", oportunidade_id: idCandidata(p, "recente"), empresa: { nome: "Economia Sensata" } }),
      { recebidaEm: new Date(t0 + MIN) },
    );
    const r3 = await enviar(
      "#crm mando proposta sexta",
      (p) => saida({ intencao: "ATUALIZAR", oportunidade_id: idCandidata(p, "recente"), campos: { proxima_acao: "mandar proposta", proxima_acao_em: "sexta" } }),
      { recebidaEm: new Date(t0 + 2 * MIN) },
    );
    for (const r of [r2.r, r3.r]) expect(r).toMatchObject({ tipo: "PROCESSADA", oportunidadeId: id });
    expect(r2.r).toMatchObject({ confirmacao: "✅ Gustavo — Economia Sensata (Primeiro Contato): atualizado." });
    expect(r3.r).toMatchObject({ confirmacao: expect.stringMatching(/^✅ Gustavo — Economia Sensata \(Primeiro Contato\): atualizado\. Próx\.: mandar proposta/u) });

    expect(await dbT.oportunidade.count()).toBe(1);
    expect(await dbT.empresa.count()).toBe(1);
    const card = await cardDe(id);
    expect(card).toMatchObject({ titulo: "Gustavo — Economia Sensata", proximaAcao: "mandar proposta", revisar: false });
    expect(diaEmFuso(card.proximaAcaoEm!)).toBe(resolverDataRelativa("sexta", new Date(t0 + 2 * MIN)));
    expect(card.contato?.empresaId).toBe(card.empresaId);
    for (const m of await dbT.mensagemBruta.findMany()) expect(m.status).toBe("PROCESSADA");
  });

  it("dois cards recentes do remetente → a escolha da LLM vale, mas ⚠️ + revisar", async () => {
    await enviar("#crm falei com a Ana", () => saida({ contato: { nome: "Ana" } }));
    const g = await enviar("#crm falei com o Gustavo", () => saida({ contato: { nome: "Gustavo" } }));
    const id = (g.r as { oportunidadeId: string }).oportunidadeId;
    const r = await enviar("#crm mando proposta sexta", () =>
      saida({ intencao: "ATUALIZAR", oportunidade_id: id, campos: { proxima_acao: "mandar proposta", proxima_acao_em: "sexta" } }),
    );
    expect(r.prompt.match(/via=recente/g)).toHaveLength(2);
    expect(r.r).toMatchObject({ tipo: "PROCESSADA", oportunidadeId: id });
    expect((r.r as { confirmacao: string }).confirmacao).toMatch(/^⚠️ Gustavo/u);
    expect((r.r as { confirmacao: string }).confirmacao.endsWith(SEM_ID)).toBe(true);
    expect((await cardDe(id)).revisar).toBe(true);
  });

  it("'recente' é só dos últimos 30 min e só do remetente; 31 min depois, na mesma janela, o card vem pelo ledger (revisar)", async () => {
    const velho = await enviar("#crm falei com a Ana", () => saida({ contato: { nome: "Ana" } }));
    const idVelho = (velho.r as { oportunidadeId: string }).oportunidadeId;
    // todos os toques do card da Ana ficam 31 min antes da próxima mensagem
    await dbT.timeline.updateMany({ where: { oportunidadeId: idVelho }, data: { em: new Date(RECEBIDA_EM.getTime() - 31 * MIN) } });
    // card que a Maria (outra pessoa) mexeu agora
    const daMaria = await enviar("#crm falei com o Beto", () => saida({ contato: { nome: "Beto" } }), { remetenteUsuarioId: maria.id });
    const idMaria = (daMaria.r as { oportunidadeId: string }).oportunidadeId;

    const r = await enviar("#crm mando proposta sexta", () => saida({ intencao: "ATUALIZAR", oportunidade_id: idVelho, campos: { proxima_acao: "mandar proposta" } }));
    // GAB-49: não é 'recente' (31 min), mas a mensagem da Ana é do ledger da janela de 12 h.
    expect(r.prompt).toMatch(new RegExp(`- id=${idVelho} .* via=ledger `));
    expect(r.prompt).not.toContain(idMaria);
    expect(r.r).toMatchObject({ tipo: "PROCESSADA", oportunidadeId: idVelho });
    const card = await cardDe(idVelho);
    expect(card).toMatchObject({ proximaAcao: "mandar proposta", revisar: true }); // nunca ✅ só pelo ledger
  });

  it("borda dos 30 min: toque exatamente 30 min antes ainda é 'recente' (✅ sem revisar)", async () => {
    const c = await enviar("#crm falei com a Ana", () => saida({ contato: { nome: "Ana" } }));
    const id = (c.r as { oportunidadeId: string }).oportunidadeId;
    await dbT.timeline.updateMany({ where: { oportunidadeId: id }, data: { em: new Date(RECEBIDA_EM.getTime() - 30 * MIN) } });
    const r = await enviar("#crm mando proposta sexta", (p) => saida({ intencao: "ATUALIZAR", oportunidade_id: idCandidata(p, "recente"), campos: { proxima_acao: "mandar proposta" } }));
    expect(r.prompt).toMatch(new RegExp(`- id=${id} .* via=recente,ledger `));
    expect(await cardDe(id)).toMatchObject({ proximaAcao: "mandar proposta", revisar: false });
  });

  it("GAB-49: card FECHADO que só veio pelo ledger não reabre → pendente de revisão", async () => {
    const c = await enviar("#crm falei com a Ana", () => saida({ contato: { nome: "Ana" } }));
    const id = (c.r as { oportunidadeId: string }).oportunidadeId;
    const perdido = await dbT.fase.findFirstOrThrow({ where: { chave: "perdido", pipeline: { chave: "vendas" } } });
    await dbT.oportunidade.update({ where: { id }, data: { faseId: perdido.id } });
    await dbT.timeline.updateMany({ where: { oportunidadeId: id }, data: { em: new Date(RECEBIDA_EM.getTime() - 60 * MIN) } });
    const antes = await dbT.oportunidade.count();
    const r = await enviar("#crm ela voltou a falar comigo", () => saida({ intencao: "ATUALIZAR", oportunidade_id: id }));
    expect(r.prompt).toMatch(new RegExp(`- id=${id} .*\\(fechada\\) via=ledger `));
    expect(r.r).toMatchObject({ tipo: "PENDENTE_REVISAO" });
    expect((r.r as { confirmacao: string }).confirmacao).toContain("não reabri");
    expect(await dbT.oportunidade.count()).toBe(antes);
  });
});

describe("alvo por identidade (sem id da LLM)", () => {
  async function contatoComTelefone() {
    return dbT.contato.create({
      data: { nome: "Gustavo Saab", pontos: { create: [{ tipo: "TELEFONE", valorNormalizado: "+5511977776666", valorOriginal: "11 97777-6666" }] } },
    });
  }
  async function card(contatoId: string, faseChave: string, titulo: string, toque: Date) {
    const fase = await dbT.fase.findFirstOrThrow({ where: { chave: faseChave, pipeline: { chave: "vendas" } } });
    const op = await dbT.oportunidade.create({
      data: { pipelineId: fase.pipelineId, faseId: fase.id, titulo, contatoId, responsavelId: joao.id, criadoVia: "UI", dor: "antiga" },
    });
    await dbT.timeline.create({ data: { oportunidadeId: op.id, tipo: "CRIACAO", em: toque } });
    return op;
  }

  it("1 aberta → ela; campos ausentes não apagam nada; pontos novos do texto acumulam", async () => {
    const c = await contatoComTelefone();
    const op = await card(c.id, "primeiro_contato", "Gustavo Saab", new Date("2025-10-01T12:00:00Z"));
    await card(c.id, "perdido", "Gustavo Saab (antigo)", new Date("2025-10-20T12:00:00Z"));
    const r = await enviar("#crm o 11 97777-6666 respondeu, email dele gu@sensata.com.br", () =>
      saida({ intencao: "ATUALIZAR", contato: { telefone: "11 97777-6666", email: "gu@sensata.com.br" }, campos: { cidade: "Campinas" } }),
    );
    expect(r.prompt).toMatch(new RegExp(`- id=${op.id} titulo="Gustavo Saab" fase="Primeiro Contato" via=contato`));
    expect(r.r).toMatchObject({ tipo: "PROCESSADA", oportunidadeId: op.id });
    const depois = await cardDe(op.id);
    expect(depois).toMatchObject({ dor: "antiga", cidade: "Campinas", revisar: false });
    expect(depois.contato?.pontos.map((p) => p.valorNormalizado).sort()).toEqual(["+5511977776666", "gu@sensata.com.br"]);
  });

  it(">1 aberta → a tocada mais recentemente + revisar", async () => {
    const c = await contatoComTelefone();
    await card(c.id, "primeiro_contato", "Velho", new Date("2025-10-01T12:00:00Z"));
    const novo = await card(c.id, "montando_proposta", "Novo", new Date("2025-10-20T12:00:00Z"));
    const r = await enviar("#crm 11 97777-6666 pediu desconto", () => saida({ intencao: "ATUALIZAR", contato: { telefone: "11 97777-6666" } }));
    expect(r.r).toMatchObject({ tipo: "PROCESSADA", oportunidadeId: novo.id });
    expect((r.r as { confirmacao: string }).confirmacao).toBe("⚠️ Novo (Montando Proposta): atualizado.\nMarquei para revisar: mais de um card aberto para esse contato/empresa.");
    expect((await cardDe(novo.id)).revisar).toBe(true);
  });

  it("só terminais → card NOVO com reaberta_de_id + revisar; o fechado fica como está", async () => {
    const c = await contatoComTelefone();
    const fechado = await card(c.id, "contrato_assinado", "Gustavo Saab", new Date("2025-10-01T12:00:00Z"));
    const r = await enviar("#crm o 11 97777-6666 quer outro projeto, reunião diagnóstica", () =>
      saida({ intencao: "ATUALIZAR", contato: { telefone: "11 97777-6666" }, fase_chave: "reuniao_diagnostica" }),
    );
    expect(r.r).toMatchObject({ tipo: "PROCESSADA" });
    const novoId = (r.r as { oportunidadeId: string }).oportunidadeId;
    expect(novoId).not.toBe(fechado.id);
    const novo = await cardDe(novoId);
    expect(novo).toMatchObject({ reabertaDeId: fechado.id, contatoId: c.id, revisar: true, titulo: "Gustavo Saab", criadoVia: "WHATSAPP" });
    expect(novo.fase.chave).toBe("reuniao_diagnostica");
    expect((r.r as { confirmacao: string }).confirmacao).toMatch(/^⚠️ Gustavo Saab → Reunião Diagnóstica\. Resp: João\.\nMarquei para revisar: card anterior estava fechado/u);
    expect((await cardDe(fechado.id)).fase.chave).toBe("contrato_assinado");
  });

  it("telefone de OUTRO contato no texto não é roubado: revisar, sem mexer nos pontos", async () => {
    const c = await contatoComTelefone();
    const op = await card(c.id, "primeiro_contato", "Gustavo Saab", new Date("2025-10-01T12:00:00Z"));
    const outro = await dbT.contato.create({ data: { nome: "Outro", pontos: { create: [{ tipo: "EMAIL", valorNormalizado: "outro@x.com", valorOriginal: "x" }] } } });
    const r = await enviar("#crm 11 97777-6666 passou o email outro@x.com", (p) => saida({ intencao: "ATUALIZAR", oportunidade_id: idCandidata(p, "contato") }));
    expect(r.r).toMatchObject({ tipo: "PROCESSADA", oportunidadeId: op.id });
    expect((r.r as { confirmacao: string }).confirmacao).toContain("Marquei para revisar: telefone/email da mensagem é de outro contato do CRM.");
    expect(await dbT.contatoPonto.count({ where: { contatoId: outro.id } })).toBe(1);
    expect(await dbT.contatoPonto.count({ where: { contatoId: c.id } })).toBe(1);
  });
});

describe("mover para terminal pelo WhatsApp", () => {
  async function cardRecente() {
    const r = await enviar("#crm falei com o Gustavo da Economia Sensata", () => saida({ contato: { nome: "Gustavo" }, empresa: { nome: "Economia Sensata" } }));
    return (r.r as { oportunidadeId: string }).oportunidadeId;
  }

  it("ganho COM valor → contrato assinado, valor fechado e card de projeto (regras do GAB-32)", async () => {
    const id = await cardRecente();
    const r = await enviar("#crm fechamos o Gustavo, 18 mil", (p) =>
      saida({ intencao: "ATUALIZAR", oportunidade_id: idCandidata(p, "recente"), fase_chave: "contrato_assinado", campos: { valor_fechado: "18 mil" } }),
    );
    expect(r.r).toMatchObject({ tipo: "PROCESSADA", confirmacao: "✅ Gustavo — Economia Sensata: Primeiro Contato → Contrato assinado." });
    const card = await cardDe(id);
    expect(card.fase.chave).toBe("contrato_assinado");
    expect(card.valorFechado?.toFixed(2)).toBe("18000.00");
    expect(card.dataGanho).not.toBeNull();
    const projeto = await dbT.oportunidade.findFirstOrThrow({ where: { origemOportunidadeId: id }, include: { fase: true } });
    expect(projeto.fase.chave).toBe("em_execucao");
    expect(await dbT.transicaoFase.findFirst({ where: { oportunidadeId: id, paraFaseId: card.faseId } })).toMatchObject({ origem: "WHATSAPP" });
  });

  it("ganho SEM valor → NÃO move (nunca inventa), revisar com o motivo", async () => {
    const id = await cardRecente();
    const r = await enviar("#crm fechamos o Gustavo!", (p) => saida({ intencao: "ATUALIZAR", oportunidade_id: idCandidata(p, "recente"), fase_chave: "contrato_assinado" }));
    expect(r.r).toMatchObject({
      tipo: "PROCESSADA",
      confirmacao: "⚠️ Gustavo — Economia Sensata (Primeiro Contato): atualizado.\nMarquei para revisar: venda ganha sem valor fechado na mensagem: mova pelo CRM.",
    });
    const card = await cardDe(id);
    expect(card).toMatchObject({ revisar: true, valorFechado: null });
    expect(card.fase.chave).toBe("primeiro_contato");
    expect(await dbT.oportunidade.count()).toBe(1);
  });

  it("perdido com motivo → Perdido com o motivo; sem motivo → não move", async () => {
    const id = await cardRecente();
    const sem = await enviar("#crm perdemos o Gustavo", (p) => saida({ intencao: "ATUALIZAR", oportunidade_id: idCandidata(p, "recente"), fase_chave: "perdido" }));
    expect((sem.r as { confirmacao: string }).confirmacao).toContain("venda perdida sem motivo na mensagem");
    expect((await cardDe(id)).fase.chave).toBe("primeiro_contato");

    const com = await enviar("#crm perdemos o Gustavo, achou caro", (p) =>
      saida({ intencao: "ATUALIZAR", oportunidade_id: idCandidata(p, "recente"), fase_chave: "perdido", campos: { motivo_perda: "achou caro" } }),
    );
    expect(com.r).toMatchObject({ tipo: "PROCESSADA", oportunidadeId: id });
    const card = await cardDe(id);
    expect(card.fase.chave).toBe("perdido");
    expect(card.motivoPerda).toBe("Outro: achou caro");
  });
});

describe("intenção e alvo", () => {
  it("ATUALIZAR sem candidata → PENDENTE_REVISAO, nada criado", async () => {
    const r = await enviar("#crm o Gustavo respondeu", () => saida({ intencao: "ATUALIZAR", contato: { nome: "Gustavo" } }));
    expect(r.r).toMatchObject({ tipo: "PENDENTE_REVISAO" });
    expect(await dbT.oportunidade.count()).toBe(0);
  });

  it("IGNORAR com tag → PENDENTE_REVISAO mesmo com card recente", async () => {
    const r1 = await enviar("#crm falei com o Gustavo", () => saida({ contato: { nome: "Gustavo" } }));
    const r = await enviar("#crm bom dia pessoal", () => saida({ intencao: "IGNORAR" }));
    expect(r.r).toMatchObject({ tipo: "PENDENTE_REVISAO" });
    expect((await dbT.mensagemBruta.findUniqueOrThrow({ where: { id: r.m.id } })).status).toBe("PENDENTE_REVISAO");
    expect(await dbT.timeline.count({ where: { oportunidadeId: (r1.r as { oportunidadeId: string }).oportunidadeId } })).toBe(2);
  });

  it("reprocessada depois de um ❌ → '✅ Reprocessada:' também no ATUALIZAR", async () => {
    const r1 = await enviar("#crm falei com o Gustavo", () => saida({ contato: { nome: "Gustavo" } }));
    const id = (r1.r as { oportunidadeId: string }).oportunidadeId;
    const r = await enviar("#crm mando proposta", () => saida({ intencao: "ATUALIZAR", oportunidade_id: id, campos: { proxima_acao: "mandar proposta" } }), {
      erro: "LLM HTTP ref=abc",
    });
    expect((r.r as { confirmacao: string }).confirmacao).toBe("✅ Reprocessada: Gustavo (Primeiro Contato): atualizado. Próx.: mandar proposta");
  });
});

describe("review do PR #23", () => {
  async function fase(chave: string) {
    return dbT.fase.findFirstOrThrow({ where: { chave, pipeline: { chave: "vendas" } } });
  }
  async function cardCom(dados: { faseChave?: string; contatoId?: string; empresaId?: string; titulo?: string }) {
    const f = await fase(dados.faseChave ?? "primeiro_contato");
    const op = await dbT.oportunidade.create({
      data: { pipelineId: f.pipelineId, faseId: f.id, titulo: dados.titulo ?? "Card", contatoId: dados.contatoId, empresaId: dados.empresaId, responsavelId: joao.id, criadoVia: "UI" },
    });
    await dbT.timeline.create({ data: { oportunidadeId: op.id, tipo: "CRIACAO", em: new Date("2025-10-01T12:00:00Z") } });
    return op;
  }

  it("reabertura concorrente: duas mensagens que viram só o card fechado → a 2ª usa o card que a 1ª abriu", async () => {
    const c = await dbT.contato.create({
      data: { nome: "Gustavo", pontos: { create: [{ tipo: "TELEFONE", valorNormalizado: "+5511977776666", valorOriginal: "x" }] } },
    });
    const fechado = await cardCom({ faseChave: "perdido", contatoId: c.id, titulo: "Gustavo" });
    // Barreira: as duas "LLMs" só respondem depois que os DOIS contextos foram montados.
    let liberar!: () => void;
    const ambos = new Promise<void>((r) => (liberar = r));
    let chamadas = 0;
    definirRespostaMock(async (texto) => {
      if (++chamadas === 2) liberar();
      await ambos;
      return saida({ intencao: "ATUALIZAR", oportunidade_id: fechado.id, campos: { proxima_acao: texto.includes("A") ? "ligar" : "mandar proposta" } });
    });
    const m1 = await bruta("#crm msg A do 11 97777-6666");
    const m2 = await bruta("#crm msg B do 11 97777-6666");
    const [r1, r2] = await Promise.all([processarMensagem(m1.id), processarMensagem(m2.id)]);
    const ids = [r1, r2].map((r) => (r as { oportunidadeId: string }).oportunidadeId);
    expect(ids[0]).toBe(ids[1]);
    expect(await dbT.oportunidade.count({ where: { reabertaDeId: fechado.id } })).toBe(1);
    expect(await dbT.oportunidade.count()).toBe(2);
  });

  it("CNPJ de outra empresa num card que já tem empresa → não troca; revisar + sugestão", async () => {
    const atual = await dbT.empresa.create({ data: { nome: "Economia Sensata" } });
    const outra = await dbT.empresa.create({ data: { nome: "Acme Ltda", cnpj: "11222333000181" } });
    const op = await cardCom({ empresaId: atual.id, titulo: "Economia Sensata" });
    // João mexeu no card agora há pouco → candidata "recente"
    await dbT.timeline.create({ data: { oportunidadeId: op.id, tipo: "NOTA", usuarioId: joao.id, em: RECEBIDA_EM } });
    const r2 = await enviar("#crm CNPJ dele 11.222.333/0001-81", (p) => saida({ intencao: "ATUALIZAR", oportunidade_id: idCandidata(p, "recente") }));
    expect(r2.r).toMatchObject({ tipo: "PROCESSADA", oportunidadeId: op.id });
    expect((r2.r as { confirmacao: string }).confirmacao).toContain("revisar");
    expect((await cardDe(op.id)).empresaId).toBe(atual.id);
    const bruta2 = await dbT.mensagemBruta.findUniqueOrThrow({ where: { id: r2.m.id } });
    expect(bruta2.resultadoLlm).toMatchObject({ aplicacao: { sugestoes: [{ tipo: "EMPRESA_POR_CNPJ", empresaId: outra.id }] } });
    expect((bruta2.resultadoLlm as { aplicacao: { motivosRevisar: string[] } }).aplicacao.motivosRevisar).toContain("CNPJ da mensagem é de outra empresa do CRM");
  });

  it("nome só parecido ('Tech' vs 'Techno Ltda') NÃO casa: empresa fica, revisar + sugestão", async () => {
    const emp = await dbT.empresa.create({ data: { nome: "Techno Ltda" } });
    const r1 = await enviar("#crm falei com a Ana", () => saida({ contato: { nome: "Ana" } }));
    const id = (r1.r as { oportunidadeId: string }).oportunidadeId;
    await dbT.oportunidade.update({ where: { id }, data: { empresaId: emp.id, titulo: "Ana — Techno Ltda" } });
    const r = await enviar("#crm é da Tech", (p) => saida({ intencao: "ATUALIZAR", oportunidade_id: idCandidata(p, "recente"), empresa: { nome: "Tech" } }));
    expect(r.r).toMatchObject({ tipo: "PROCESSADA", oportunidadeId: id });
    const card = await cardDe(id);
    expect(card).toMatchObject({ empresaId: emp.id, titulo: "Ana — Techno Ltda", revisar: true });
    expect(await dbT.empresa.count()).toBe(1);
    const bruta2 = await dbT.mensagemBruta.findUniqueOrThrow({ where: { id: r.m.id } });
    expect(bruta2.resultadoLlm).toMatchObject({ aplicacao: { sugestoes: [{ tipo: "EMPRESA_NOME_LIDO", nome: "Tech" }] } });
  });

  it("ganho com valor INVENTADO pela LLM (não está no texto) → não move, revisar", async () => {
    const r1 = await enviar("#crm falei com o Gustavo", () => saida({ contato: { nome: "Gustavo" } }));
    const id = (r1.r as { oportunidadeId: string }).oportunidadeId;
    const r = await enviar("#crm fechamos o Gustavo!", (p) =>
      saida({ intencao: "ATUALIZAR", oportunidade_id: idCandidata(p, "recente"), fase_chave: "contrato_assinado", campos: { valor_fechado: "18 mil" } }),
    );
    expect((r.r as { confirmacao: string }).confirmacao).toContain("Marquei para revisar: valor fechado não confere com a mensagem: mova pelo CRM.");
    const card = await cardDe(id);
    expect(card.fase.chave).toBe("primeiro_contato");
    expect(card.valorFechado).toBeNull();
    expect(await dbT.oportunidade.count()).toBe(1);
  });

  it("perda sem sinal de perda no texto → não move", async () => {
    const r1 = await enviar("#crm falei com o Gustavo", () => saida({ contato: { nome: "Gustavo" } }));
    const id = (r1.r as { oportunidadeId: string }).oportunidadeId;
    const r = await enviar("#crm Gustavo ainda pensando", (p) =>
      saida({ intencao: "ATUALIZAR", oportunidade_id: idCandidata(p, "recente"), fase_chave: "perdido", campos: { motivo_perda: "preço" } }),
    );
    expect((r.r as { confirmacao: string }).confirmacao).toContain("perda não confirmada pela mensagem");
    expect((await cardDe(id)).fase.chave).toBe("primeiro_contato");
  });

  it("telefone citado sem contato no card e sem nome → revisar 'identificadores citados sem contato'", async () => {
    const r1 = await enviar("#crm Economia Sensata quer proposta", () => saida({ empresa: { nome: "Economia Sensata" } }));
    const id = (r1.r as { oportunidadeId: string }).oportunidadeId;
    const r = await enviar("#crm o tel é 11 96666-5555", (p) => saida({ intencao: "ATUALIZAR", oportunidade_id: idCandidata(p, "recente") }));
    expect(r.r).toMatchObject({ tipo: "PROCESSADA", oportunidadeId: id });
    const bruta2 = await dbT.mensagemBruta.findUniqueOrThrow({ where: { id: r.m.id } });
    expect((bruta2.resultadoLlm as { aplicacao: { motivosRevisar: string[] } }).aplicacao.motivosRevisar).toContain("identificadores citados sem contato");
    expect(await dbT.contatoPonto.count()).toBe(0);
    expect((await cardDe(id)).revisar).toBe(true);
  });

  it("ganho: campos da mensagem entram ANTES do gancho — o card de projeto já nasce com eles", async () => {
    const r1 = await enviar("#crm falei com o Gustavo", () => saida({ contato: { nome: "Gustavo" } }));
    const id = (r1.r as { oportunidadeId: string }).oportunidadeId;
    await enviar("#crm fechamos o Gustavo, 18 mil, é da Economia Sensata de Campinas/SP", (p) =>
      saida({
        intencao: "ATUALIZAR",
        oportunidade_id: idCandidata(p, "recente"),
        empresa: { nome: "Economia Sensata" },
        fase_chave: "contrato_assinado",
        campos: { valor_fechado: "18 mil", cidade: "Campinas", estado: "SP" },
      }),
    );
    expect((await cardDe(id)).fase.chave).toBe("contrato_assinado");
    const projeto = await dbT.oportunidade.findFirstOrThrow({ where: { origemOportunidadeId: id }, include: { empresa: true } });
    expect(projeto).toMatchObject({ titulo: "Gustavo — Economia Sensata", cidade: "Campinas", estado: "SP" });
    expect(projeto.empresa?.nome).toBe("Economia Sensata");
  });

  it("'o Gustavo respondeu' com um usuário Gustavo → dono do card NÃO muda; revisar 'responsável sugerido'", async () => {
    await dbT.usuario.create({ data: { nome: "Gustavo", email: "gustavo@ij.test" } });
    const r1 = await enviar("#crm falei com a Ana da Acme", () => saida({ contato: { nome: "Ana" }, empresa: { nome: "Acme" } }));
    const id = (r1.r as { oportunidadeId: string }).oportunidadeId;
    const r = await enviar("#crm o Gustavo respondeu", (p) => saida({ intencao: "ATUALIZAR", oportunidade_id: idCandidata(p, "recente"), responsavel_nome: "Gustavo" }));
    expect(r.r).toMatchObject({ tipo: "PROCESSADA", oportunidadeId: id });
    const card = await cardDe(id);
    expect(card.responsavelId).toBe(joao.id);
    expect(card.revisar).toBe(true);
    const bruta2 = await dbT.mensagemBruta.findUniqueOrThrow({ where: { id: r.m.id } });
    expect((bruta2.resultadoLlm as { aplicacao: { motivosRevisar: string[] } }).aplicacao.motivosRevisar).toContain("responsável sugerido: Gustavo");
  });

  describe("reply a confirmação que não vale mais → PENDENTE_REVISAO (nunca CRIAR)", () => {
    it.each([
      ["mais de 30 dias", { em: new Date(RECEBIDA_EM.getTime() - 31 * 24 * 60 * MIN) }, {}, "⚠️ essa confirmação tem mais de 30 dias"],
      ["card na lixeira", { em: RECEBIDA_EM }, { deletadoEm: new Date() }, "⚠️ o card dessa confirmação foi removido do CRM"],
    ])("%s", async (_, enviada, card, texto) => {
      const op = await cardCom({ titulo: "Gustavo" });
      if ("deletadoEm" in card) await dbT.oportunidade.update({ where: { id: op.id }, data: card });
      await dbT.mensagemEnviada.create({ data: { eventoId: "BOTVELHO", grupoJid: GRUPO, texto: "✅ Gustavo → Primeiro Contato", oportunidadeId: op.id, ...enviada } });
      const r = await enviar("#crm na verdade é a Acme", () => saida({ intencao: "CRIAR", contato: { nome: "Gustavo" }, empresa: { nome: "Acme" } }), {
        respondendoEventoId: "BOTVELHO",
      });
      expect(r.r).toMatchObject({ tipo: "PENDENTE_REVISAO" });
      expect((r.r as { confirmacao: string }).confirmacao.startsWith(texto)).toBe(true);
      expect(r.prompt).not.toContain("Card da confirmação respondida");
      expect(await dbT.oportunidade.count()).toBe(1);
      expect(await dbT.empresa.count()).toBe(0);
    });
  });
});

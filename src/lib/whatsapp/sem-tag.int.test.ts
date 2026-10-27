// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURES_CLASSIFICACAO } from "@/lib/llm/fixtures/classificacao";
import { RECEBIDA_EM, saida } from "@/lib/llm/fixtures/extracao";
import { definirClassificacaoMock, definirRespostaMock } from "@/lib/llm/provedores/mock";
import { ErroLlm } from "@/lib/llm/tipos";
import { dbTeste, limparBanco } from "@/test/db";
import { semear } from "../../../prisma/seed";
import type { MensagemRecebida } from "./payload";
import { avaliarSemTag, reiniciarAvisoSemTag, ruidoObvio } from "./sem-tag";

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
  "contador_descartadas",
  "sessao",
  "usuario",
];
const envOriginal = { ...process.env };
const RELEVANTE = FIXTURES_CLASSIFICACAO.find((f) => f.saida.relevante)!;
const RUIDO = FIXTURES_CLASSIFICACAO.find((f) => !f.saida.relevante)!;

let joao: { id: string };
let seq = 0;

function msg(texto: string, extra: Partial<MensagemRecebida> = {}): MensagemRecebida {
  seq++;
  return {
    eventoId: `SEMTAG${seq}`,
    grupoJid: GRUPO,
    remetente: { telefone: "+5511999998888", lid: null },
    participantJid: "5511999998888@s.whatsapp.net",
    texto,
    respondendoEventoId: null,
    recebidaEm: RECEBIDA_EM,
    ...extra,
  };
}

function logs(...spies: unknown[]): string {
  return spies.map((s) => (s as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c.map(String).join(" ")).join("\n")).join("\n");
}

async function contador() {
  const linhas = await dbT.contadorDescartadas.findMany();
  return { dias: linhas.length, total: linhas.reduce((s, l) => s + l.total, 0), naoClassificadas: linhas.reduce((s, l) => s + l.naoClassificadas, 0) };
}

beforeEach(async () => {
  await limparBanco(TABELAS);
  await semear(dbT, { log: () => {} });
  joao = await dbT.usuario.create({ data: { nome: "João", email: "joao@ij.test", telefoneWhatsapp: "+5511999998888" } });
  process.env.LLM_PROVEDOR = "mock";
  delete process.env.NOTIFICATIONS_ENABLED;
  delete process.env.LLM_LIMIAR_CLASSIFICADOR;
  delete process.env.LLM_LIMIAR_SEM_TAG;
  reiniciarAvisoSemTag();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  definirRespostaMock(null);
  definirClassificacaoMock(null);
  vi.restoreAllMocks();
  process.env = { ...envOriginal };
});

describe("ruidoObvio (não chama a LLM)", () => {
  it.each([
    ["ok", true],
    ["  kkkk  ", true],
    ["👍👍👍👍👍👍👍👍", true],
    ["!!! ??? ...", true],
    ["valeu galera", false],
    ["fechei 20k", false],
  ])("%j → %s", (texto, esperado) => {
    expect(ruidoObvio(texto)).toBe(esperado);
  });
});

describe("avaliarSemTag", () => {
  it("ruído (classificador: não relevante) → nada de MensagemBruta, contador do dia +1, nenhum log com o texto", async () => {
    const r = await avaliarSemTag(msg(RUIDO.texto), joao.id);
    expect(r).toEqual({ tipo: "DESCARTADA" });
    expect(await dbT.mensagemBruta.count()).toBe(0);
    expect(await contador()).toEqual({ dias: 1, total: 1, naoClassificadas: 0 });
    const l = logs(console.info, console.warn, console.error);
    expect(l).toContain("[llm] classificacao");
    expect(l).not.toContain(RUIDO.texto);
    expect(l).not.toContain("sexta");
  });

  it("todas as 10 fixtures de ruído são descartadas sem gravar texto", async () => {
    for (const f of FIXTURES_CLASSIFICACAO.filter((x) => !x.saida.relevante)) {
      expect((await avaliarSemTag(msg(f.texto), joao.id)).tipo).toBe("DESCARTADA");
    }
    expect(await dbT.mensagemBruta.count()).toBe(0);
    expect((await contador()).total).toBe(10);
  });

  it("relevante mas abaixo do limiar do classificador → descartada", async () => {
    definirClassificacaoMock(() => ({ relevante: true, confianca: 0.6 }));
    expect((await avaliarSemTag(msg(RELEVANTE.texto), joao.id)).tipo).toBe("DESCARTADA");
    expect(await dbT.mensagemBruta.count()).toBe(0);
  });

  it("relevante + extração confiante → card criado, semTag gravado e confirmação ↪️", async () => {
    definirRespostaMock(() => saida({ contato: { nome: "Rafael" }, empresa: { nome: "Padaria Pão Quente" }, confianca: 0.95 }));
    const r = await avaliarSemTag(msg(RELEVANTE.texto), joao.id);
    expect(r.tipo).toBe("PERSISTIDA");
    if (r.tipo !== "PERSISTIDA") return;
    expect(r.processamento).toMatchObject({ tipo: "PROCESSADA" });
    if (r.processamento.tipo !== "PROCESSADA") return;
    expect(r.processamento.confirmacao).toMatch(/^↪️ entendi como atualização: Rafael — Padaria Pão Quente → /);
    const bruta = await dbT.mensagemBruta.findUniqueOrThrow({ where: { id: r.mensagemId } });
    expect(bruta).toMatchObject({ semTag: true, status: "PROCESSADA", texto: RELEVANTE.texto });
    expect(await dbT.oportunidade.count()).toBe(1);
    expect(await contador()).toEqual({ dias: 0, total: 0, naoClassificadas: 0 });
  });

  it("relevante + extração com confiança abaixo de LLM_LIMIAR_SEM_TAG → PENDENTE_REVISAO, nenhum card", async () => {
    // 0.8 ≥ LLM_LIMIAR_CONFIANCA (0.7): com #crm teria criado; sem tag (0.85) não age.
    definirRespostaMock(() => saida({ contato: { nome: "Rafael" }, empresa: { nome: "Padaria Pão Quente" }, confianca: 0.8 }));
    const r = await avaliarSemTag(msg(RELEVANTE.texto), joao.id);
    expect(r).toMatchObject({ tipo: "PERSISTIDA", processamento: { tipo: "PENDENTE_REVISAO" } });
    if (r.tipo !== "PERSISTIDA" || r.processamento.tipo !== "PENDENTE_REVISAO") return;
    expect(r.processamento.confirmacao).toMatch(/sem #crm/);
    const bruta = await dbT.mensagemBruta.findUniqueOrThrow({ where: { id: r.mensagemId } });
    expect(bruta.status).toBe("PENDENTE_REVISAO");
    expect(bruta.resultadoLlm).toMatchObject({ aplicacao: { tipo: "PENDENTE", motivo: "SEM_TAG_INCERTO" } });
    expect(await dbT.oportunidade.count()).toBe(0);

    // Limiar configurável: 0.75 → a mesma extração age.
    process.env.LLM_LIMIAR_SEM_TAG = "0.75";
    const r2 = await avaliarSemTag(msg(RELEVANTE.texto), joao.id);
    expect(r2).toMatchObject({ tipo: "PERSISTIDA", processamento: { tipo: "PROCESSADA" } });
  });

  it("relevante mas a extração diz IGNORAR → linha apagada, só o contador", async () => {
    definirRespostaMock(() => saida({ intencao: "IGNORAR", confianca: 0.9 }));
    const r = await avaliarSemTag(msg(RELEVANTE.texto), joao.id);
    expect(r).toMatchObject({ tipo: "PERSISTIDA", processamento: { tipo: "DESCARTADA" } });
    expect(await dbT.mensagemBruta.count()).toBe(0);
    expect(await contador()).toMatchObject({ total: 1 });
  });

  it("classificador sem crédito → não grava texto, nao_classificadas +1, log com ref (sem texto), aviso no grupo no máximo 1×/30 min", async () => {
    definirClassificacaoMock(() => {
      throw new ErroLlm("SEM_CREDITO", { detalhe: "sem crédito na API da OpenAI" });
    });
    const r = await avaliarSemTag(msg(RELEVANTE.texto), joao.id);
    expect(r).toMatchObject({ tipo: "NAO_CLASSIFICADA", codigo: "SEM_CREDITO" });
    if (r.tipo !== "NAO_CLASSIFICADA") return;
    expect(await dbT.mensagemBruta.count()).toBe(0);
    expect(await contador()).toEqual({ dias: 1, total: 0, naoClassificadas: 1 });
    const erro = logs(console.error);
    expect(erro).toContain(`[sem-tag] ref=${r.ref}`);
    expect(erro).toContain("SEM_CREDITO");
    expect(logs(console.info, console.warn, console.error)).not.toContain("Padaria");
    // Safe mode: o aviso "sai" (log) uma vez; a 2ª falha logo depois não repete.
    await avaliarSemTag(msg(RELEVANTE.texto), joao.id);
    expect(logs(console.info).match(/\[SAFE MODE\]/g)).toHaveLength(1);
    expect(await contador()).toMatchObject({ naoClassificadas: 2 });
  });

  it("contador usa o dia civil de São Paulo", async () => {
    // 25/10 01:30 UTC = 24/10 22:30 em São Paulo.
    await avaliarSemTag(msg(RUIDO.texto, { recebidaEm: new Date("2025-10-25T01:30:00Z") }), joao.id);
    const [linha] = await dbT.contadorDescartadas.findMany();
    expect(linha.dia.toISOString().slice(0, 10)).toBe("2025-10-24");
  });

  it("reply: a mensagem respondida vai como contexto curto do classificador", async () => {
    await dbT.mensagemEnviada.create({ data: { eventoId: "BOT1", grupoJid: GRUPO, texto: "✅ Gustavo — Economia Sensata → Primeiro Contato." } });
    let usuario = "";
    definirClassificacaoMock((_, pedido) => {
      usuario = pedido.usuario;
      return { relevante: false, confianca: 0.9 };
    });
    await avaliarSemTag(msg("ele pediu pra remarcar pra quinta", { respondendoEventoId: "BOT1" }), joao.id);
    expect(usuario).toContain("<respondendo_a>\n✅ Gustavo — Economia Sensata");
  });
});

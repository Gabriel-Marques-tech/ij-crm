// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { diaEmFuso } from "@/lib/oportunidades/aging";
import { FIXTURES_EXTRACAO, RECEBIDA_EM, saida } from "@/lib/llm/fixtures/extracao";
import { VERSAO_EXTRACAO } from "@/lib/llm/prompts/extracao.v2";
import { definirRespostaMock } from "@/lib/llm/provedores/mock";
import { ErroLlm } from "@/lib/llm/tipos";
import { dbTeste, limparBanco } from "@/test/db";
import { semear } from "../../../prisma/seed";
import { invalidarConfigTecnica } from "@/lib/config/tecnica";
import { processarMensagem } from "./processar";

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

let joao: { id: string };
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

function logs(spy: unknown): string {
  return (spy as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c.map(String).join(" ")).join("\n");
}

beforeEach(async () => {
  await limparBanco(TABELAS);
  await semear(dbT, { log: () => {} });
  joao = await dbT.usuario.create({ data: { nome: "João", email: "joao@ij.test", telefoneWhatsapp: "+5511999998888" } });
  await dbT.usuario.create({ data: { nome: "Maria", email: "maria@ij.test" } });
  await dbT.usuario.create({ data: { nome: "Maria Antiga", email: "maria2@ij.test", ativo: false } });
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

describe("fixtures de extração (LLM mockada) → efeito no CRM", () => {
  it.each(FIXTURES_EXTRACAO.map((f) => [f.nome, f] as const))("%s", async (_, f) => {
    const m = await bruta(f.texto);
    const r = await processarMensagem(m.id);
    const depois = await dbT.mensagemBruta.findUniqueOrThrow({ where: { id: m.id } });
    expect(depois.status).toBe(f.esperado.status);
    expect(depois.resultadoLlm).toMatchObject({ versao: VERSAO_EXTRACAO, provedor: "mock", saida: f.saida });
    expect(r).toMatchObject({ confirmacao: f.esperado.confirmacao });

    const cards = await dbT.oportunidade.findMany({ include: { fase: true, responsavel: true, empresa: true, contato: { include: { pontos: true } } } });
    if (f.esperado.status === "PENDENTE_REVISAO") {
      expect(cards).toHaveLength(0);
      expect(await dbT.empresa.count()).toBe(0);
      expect(await dbT.contato.count()).toBe(0);
      return;
    }
    const e = f.esperado;
    expect(cards).toHaveLength(1);
    const c = cards[0];
    expect(c).toMatchObject({ titulo: e.titulo, revisar: e.revisar, origem: e.origem, proximaAcao: e.proximaAcao, criadoVia: "WHATSAPP" });
    expect(c.fase.chave).toBe(e.fase);
    expect(c.responsavel.nome).toBe(e.responsavel);
    expect(c.orcamentoPrevisto?.toFixed(2) ?? null).toBe(e.orcamento);
    expect(c.proximaAcaoEm ? diaEmFuso(c.proximaAcaoEm) : null).toBe(e.proximaAcaoEm);
    if (f.saida.contato.nome) expect(c.contato?.nome).toBe(f.saida.contato.nome);
    if (f.saida.empresa.nome) expect(c.empresa?.nome).toBe(f.saida.empresa.nome);
    if (c.contato && c.empresa) expect(c.contato.empresaId).toBe(c.empresa.id);

    const tl = await dbT.timeline.findMany({ where: { oportunidadeId: c.id }, orderBy: { em: "asc" } });
    expect(tl.map((t) => t.tipo)).toEqual(["CRIACAO", "MENSAGEM_WHATSAPP"]);
    expect(tl[0].payload).toMatchObject({ via: "WHATSAPP" });
    expect(tl[1]).toMatchObject({ mensagemBrutaId: m.id, usuarioId: joao.id });
    expect(tl[1].payload).toMatchObject({ texto: f.texto, saida: f.saida, versao: VERSAO_EXTRACAO });
    const tr = await dbT.transicaoFase.findMany({ where: { oportunidadeId: c.id } });
    expect(tr).toMatchObject([{ deFaseId: null, paraFaseId: c.faseId, origem: "WHATSAPP", usuarioId: joao.id }]);
  });

  it("telefone e email citados viram pontos do contato novo; CNPJ vai para a empresa nova", async () => {
    await processarMensagem((await bruta(FIXTURES_EXTRACAO[2].texto)).id);
    expect(await dbT.contatoPonto.findMany({ select: { tipo: true, valorNormalizado: true } })).toEqual([{ tipo: "TELEFONE", valorNormalizado: "+5511988887777" }]);
    const cnpj = FIXTURES_EXTRACAO.find((f) => f.texto.includes("CNPJ"))!;
    await processarMensagem((await bruta(cnpj.texto)).id);
    expect(await dbT.empresa.findFirst({ where: { nome: "Acme Ltda" } })).toMatchObject({ cnpj: "11222333000181" });
  });
});

describe("identidade: reaproveita só por identificador exato", () => {
  it("telefone já cadastrado → reusa o contato (e a empresa dele), acumula email novo", async () => {
    const emp = await dbT.empresa.create({ data: { nome: "Economia Sensata" } });
    const existente = await dbT.contato.create({
      data: { nome: "Gustavo Saab", empresaId: emp.id, pontos: { create: [{ tipo: "TELEFONE", valorNormalizado: "+5511977776666", valorOriginal: "x" }] } },
    });
    definirRespostaMock(() => saida({ contato: { nome: "Gustavo", telefone: "11 97777-6666", email: "gu@sensata.com.br" }, empresa: { nome: "Economia Sensata" } }));
    const r = await processarMensagem((await bruta("#crm falei com o Gustavo 11 97777-6666 gu@sensata.com.br, Economia Sensata")).id);
    expect(r.tipo).toBe("PROCESSADA");
    expect(await dbT.contato.count()).toBe(1);
    expect(await dbT.empresa.count()).toBe(1);
    const card = await dbT.oportunidade.findFirstOrThrow();
    expect(card).toMatchObject({ contatoId: existente.id, empresaId: emp.id, titulo: "Gustavo Saab — Economia Sensata", revisar: false });
    expect(await dbT.contatoPonto.count({ where: { contatoId: existente.id } })).toBe(2);
  });

  it("ponto de contato EXCLUÍDO → PENDENTE_REVISAO, nada criado", async () => {
    await dbT.contato.create({
      data: { nome: "Morto", deletadoEm: new Date(), pontos: { create: [{ tipo: "EMAIL", valorNormalizado: "morto@acme.com", valorOriginal: "x" }] } },
    });
    definirRespostaMock(() => saida({ contato: { nome: "Fulano", email: "morto@acme.com" } }));
    const r = await processarMensagem((await bruta("#crm Fulano morto@acme.com quer site")).id);
    expect(r).toMatchObject({ tipo: "PENDENTE_REVISAO", confirmacao: expect.stringMatching(/^⚠️ .*contato excluído/u) });
    expect(await dbT.contato.count()).toBe(1);
    expect(await dbT.oportunidade.count()).toBe(0);
  });

  it("CNPJ já cadastrado → vincula a empresa existente (via cnpj), mesmo com outro nome", async () => {
    const acme = await dbT.empresa.create({ data: { nome: "ACME Indústria", cnpj: "11222333000181" } });
    definirRespostaMock(() => saida({ contato: { nome: "Ana" }, empresa: { nome: "Acme" } }));
    await processarMensagem((await bruta("#crm Ana da Acme, cnpj 11.222.333/0001-81")).id);
    expect(await dbT.empresa.count()).toBe(1);
    expect(await dbT.oportunidade.findFirstOrThrow()).toMatchObject({ empresaId: acme.id, titulo: "Ana — ACME Indústria" });
  });

  it("domínio do email casa empresa → só SUGESTÃO + revisar; cria empresa nova, sem vincular a do domínio", async () => {
    const agro = await dbT.empresa.create({ data: { nome: "Agrosol S.A.", dominioEmail: "agrosol.com.br" } });
    definirRespostaMock(() => saida({ contato: { nome: "Fernando", email: "fernando@agrosol.com.br" }, empresa: { id: agro.id, nome: "Agrosol" } }));
    const r = await processarMensagem((await bruta("#crm Fernando fernando@agrosol.com.br da Agrosol")).id);
    expect(r.tipo).toBe("PROCESSADA");
    const card = await dbT.oportunidade.findFirstOrThrow();
    expect(card.empresaId).not.toBe(agro.id);
    expect(card.revisar).toBe(true);
    const m = await dbT.mensagemBruta.findFirstOrThrow();
    expect(m.resultadoLlm).toMatchObject({ aplicacao: { sugestoes: [{ tipo: "EMPRESA_POR_DOMINIO", empresaId: agro.id }] } });
  });

  it("id inventado pela LLM é ignorado (não vincula) e marca revisar", async () => {
    const outra = await dbT.contato.create({ data: { nome: "Outro" } });
    definirRespostaMock(() => saida({ contato: { id: outra.id, nome: "Gustavo" }, empresa: { nome: "X" } }));
    await processarMensagem((await bruta("#crm Gustavo da X")).id);
    const card = await dbT.oportunidade.findFirstOrThrow();
    expect(card.contatoId).not.toBe(outra.id);
    expect(card.revisar).toBe(true);
  });

  it("nome igual a empresa existente NÃO vincula (nunca por nome) mas sugere e marca revisar", async () => {
    const e = await dbT.empresa.create({ data: { nome: "economia sensata" } });
    const f = FIXTURES_EXTRACAO[0];
    const r = await processarMensagem((await bruta(f.texto)).id);
    expect(r).toMatchObject({ confirmacao: expect.stringContaining("Marquei para revisar: já existe empresa com esse nome no CRM.") });
    const card = await dbT.oportunidade.findFirstOrThrow();
    expect(card.empresaId).not.toBe(e.id);
    expect(await dbT.empresa.count()).toBe(2);
  });

  it("responsável por nome só com match exato de usuário ATIVO", async () => {
    definirRespostaMock(() => saida({ empresa: { nome: "X" }, responsavel_nome: "Maria Antiga" }));
    const r = await processarMensagem((await bruta("#crm X, passa pra Maria Antiga")).id);
    expect(r).toMatchObject({ confirmacao: expect.stringContaining("Resp: João.") });
    expect(r).toMatchObject({ confirmacao: expect.stringContaining("Marquei para revisar: responsável indicado não encontrado.") });
    expect(r).not.toMatchObject({ confirmacao: expect.stringContaining("Maria Antiga") });
  });

  it("fase devolvida pela LLM não é ecoada no grupo", async () => {
    definirRespostaMock(() => saida({ empresa: { nome: "X" }, fase_chave: "fase_inventada\ncom quebra" }));
    const r = await processarMensagem((await bruta("#crm X")).id);
    expect(r).toMatchObject({ confirmacao: expect.stringContaining("Marquei para revisar: fase indicada não reconhecida.") });
    expect(r).not.toMatchObject({ confirmacao: expect.stringContaining("inventada") });
  });

  it("LLM omite o telefone citado no texto → mesmo assim reusa o contato dono dele", async () => {
    const existente = await dbT.contato.create({
      data: { nome: "Gustavo Saab", pontos: { create: [{ tipo: "TELEFONE", valorNormalizado: "+5511977776666", valorOriginal: "x" }] } },
    });
    definirRespostaMock(() => saida({ contato: { nome: "Gustavo" }, empresa: { nome: "Economia Sensata" } }));
    const r = await processarMensagem((await bruta("#crm falei com o Gustavo 11 97777-6666 da Economia Sensata")).id);
    expect(r.tipo).toBe("PROCESSADA");
    expect(await dbT.contato.count()).toBe(1);
    expect(await dbT.oportunidade.findFirstOrThrow()).toMatchObject({ contatoId: existente.id });
  });

  it("dois identificadores citados de contatos diferentes → PENDENTE, mesmo se a LLM devolve só um", async () => {
    await dbT.contato.create({ data: { nome: "A", pontos: { create: [{ tipo: "TELEFONE", valorNormalizado: "+5511977776666", valorOriginal: "x" }] } } });
    await dbT.contato.create({ data: { nome: "B", pontos: { create: [{ tipo: "EMAIL", valorNormalizado: "b@acme.com.br", valorOriginal: "x" }] } } });
    definirRespostaMock(() => saida({ contato: { nome: "A", telefone: "11 97777-6666" }, empresa: { nome: "Acme" } }));
    const r = await processarMensagem((await bruta("#crm A 11 97777-6666 b@acme.com.br da Acme")).id);
    expect(r).toMatchObject({ tipo: "PENDENTE_REVISAO", confirmacao: expect.stringMatching(/^⚠️ .*cadastros diferentes/u) });
    expect(await dbT.oportunidade.count()).toBe(0);
    expect(await dbT.contato.count()).toBe(2);
  });

  it("contato novo recebe os identificadores citados no texto, mesmo os que a LLM não devolveu", async () => {
    definirRespostaMock(() => saida({ contato: { nome: "Pedro", telefone: "11 90000-0000" }, empresa: { nome: "X" } }));
    await processarMensagem((await bruta("#crm Pedro 11 98888-1111 pedro@x.com.br da X")).id);
    const pontos = (await dbT.contatoPonto.findMany({ select: { tipo: true, valorNormalizado: true } })).sort((a, b) => a.tipo.localeCompare(b.tipo));
    // O telefone que a LLM inventou (não está no texto) não entra.
    expect(pontos).toEqual([
      { tipo: "EMAIL", valorNormalizado: "pedro@x.com.br" },
      { tipo: "TELEFONE", valorNormalizado: "+5511988881111" },
    ]);
  });

  it("empresa do contato reusado com nome diferente do que a LLM leu → vincula, mas marca revisar", async () => {
    const emp = await dbT.empresa.create({ data: { nome: "Economia Sensata" } });
    await dbT.contato.create({
      data: { nome: "Gustavo", empresaId: emp.id, pontos: { create: [{ tipo: "TELEFONE", valorNormalizado: "+5511977776666", valorOriginal: "x" }] } },
    });
    definirRespostaMock(() => saida({ contato: { nome: "Gustavo" }, empresa: { nome: "Outra Firma" } }));
    const r = await processarMensagem((await bruta("#crm Gustavo 11 97777-6666 da Outra Firma")).id);
    expect(await dbT.oportunidade.findFirstOrThrow()).toMatchObject({ empresaId: emp.id, revisar: true });
    expect(r).toMatchObject({ confirmacao: expect.stringContaining("Marquei para revisar: empresa da mensagem difere da empresa do contato.") });
    expect(await dbT.empresa.count()).toBe(1);
  });

  it("nome igual com acento/caixa diferente não marca revisar", async () => {
    const emp = await dbT.empresa.create({ data: { nome: "Economia Sensata" } });
    await dbT.contato.create({
      data: { nome: "Gustavo", empresaId: emp.id, pontos: { create: [{ tipo: "TELEFONE", valorNormalizado: "+5511977776666", valorOriginal: "x" }] } },
    });
    definirRespostaMock(() => saida({ contato: { nome: "Gustavo" }, empresa: { nome: "ECONOMIA  sénsata" } }));
    await processarMensagem((await bruta("#crm Gustavo 11 97777-6666")).id);
    expect(await dbT.oportunidade.findFirstOrThrow()).toMatchObject({ empresaId: emp.id, revisar: false });
  });

  it("empresa do contato reusado foi mesclada → vincula a principal viva (não cria nova)", async () => {
    const principal = await dbT.empresa.create({ data: { nome: "Sensata Holding" } });
    const antiga = await dbT.empresa.create({ data: { nome: "Economia Sensata", mergedIntoId: principal.id } });
    await dbT.contato.create({
      data: { nome: "Gustavo", empresaId: antiga.id, pontos: { create: [{ tipo: "TELEFONE", valorNormalizado: "+5511977776666", valorOriginal: "x" }] } },
    });
    definirRespostaMock(() => saida({ contato: { nome: "Gustavo" }, empresa: { nome: "Sensata Holding" } }));
    await processarMensagem((await bruta("#crm Gustavo 11 97777-6666")).id);
    expect(await dbT.oportunidade.findFirstOrThrow()).toMatchObject({ empresaId: principal.id });
    expect(await dbT.empresa.count()).toBe(2);
  });
});

describe("limiar de confiança", () => {
  it("LLM_LIMIAR_CONFIANCA muda o corte", async () => {
    process.env.LLM_LIMIAR_CONFIANCA = "0.95";
    await processarMensagem((await bruta(FIXTURES_EXTRACAO[0].texto)).id); // confiança 0.92
    expect(await dbT.oportunidade.findFirstOrThrow()).toMatchObject({ revisar: true });
  });
});

describe("reivindicação e idempotência", () => {
  it("segunda chamada (retry/concorrência) não chama a LLM de novo", async () => {
    const chamadas = vi.fn(() => FIXTURES_EXTRACAO[0].saida);
    definirRespostaMock(chamadas);
    const m = await bruta(FIXTURES_EXTRACAO[0].texto);
    const [a, b] = await Promise.all([processarMensagem(m.id), processarMensagem(m.id)]);
    expect([a.tipo, b.tipo].sort()).toEqual(["IGNORADA", "PROCESSADA"]);
    expect(chamadas).toHaveBeenCalledTimes(1);
    expect(await processarMensagem(m.id)).toEqual({ tipo: "IGNORADA" });
    expect(await dbT.oportunidade.count()).toBe(1);
    expect((await dbT.mensagemBruta.findUniqueOrThrow({ where: { id: m.id } })).tentativas).toBe(1);
  });

  it("cerca: linha devolvida e re-reivindicada durante a LLM → o worker antigo não grava nem responde", async () => {
    let id = "";
    definirRespostaMock(async () => {
      // GAB-41 devolveu a RECEBIDA e outro worker reivindicou (tentativas+1).
      await dbT.$executeRaw`UPDATE mensagem_bruta SET status = 'PROCESSANDO', tentativas = tentativas + 1 WHERE id = ${id}`;
      return FIXTURES_EXTRACAO[0].saida;
    });
    const m = await bruta(FIXTURES_EXTRACAO[0].texto);
    id = m.id;
    const r = await processarMensagem(m.id);
    expect(r).toEqual({ tipo: "IGNORADA" });
    expect(await dbT.oportunidade.count()).toBe(0);
    expect(await dbT.empresa.count()).toBe(0);
    expect(await dbT.contato.count()).toBe(0);
    expect(await dbT.mensagemBruta.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "PROCESSANDO", tentativas: 2, resultadoLlm: null });
    expect(logs(console.info)).not.toContain("SAFE MODE");
  });

  it("cerca também no caminho de falha: worker antigo não marca FALHA nem manda ❌", async () => {
    let id = "";
    definirRespostaMock(async () => {
      await dbT.$executeRaw`UPDATE mensagem_bruta SET status = 'PROCESSANDO', tentativas = tentativas + 1 WHERE id = ${id}`;
      throw new ErroLlm("HTTP", { status: 500 });
    });
    const m = await bruta("#crm x");
    id = m.id;
    const r = await processarMensagem(m.id);
    expect(r).toEqual({ tipo: "IGNORADA" });
    expect(await dbT.mensagemBruta.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "PROCESSANDO", erro: null });
    expect(logs(console.info)).not.toContain("SAFE MODE");
  });

  it("mensagem que já tinha dado ❌ e foi reprocessada → \"✅ Reprocessada: …\"", async () => {
    // Contrato GAB-41: ao devolver FALHA → RECEBIDA, mantém `erro`.
    const m = await bruta(FIXTURES_EXTRACAO[0].texto, { erro: "LLM HTTP HTTP 500 ref=abc12345", tentativas: 1 });
    const r = await processarMensagem(m.id);
    expect(r).toMatchObject({ tipo: "PROCESSADA", confirmacao: expect.stringMatching(/^✅ Reprocessada: Gustavo — Economia Sensata/u) });
    expect(await dbT.mensagemBruta.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ status: "PROCESSADA", erro: null });
  });

  it("linha que não está RECEBIDA (FALHA, PROCESSADA) é ignorada", async () => {
    const m = await bruta("#crm x", { status: "FALHA" });
    expect(await processarMensagem(m.id)).toEqual({ tipo: "IGNORADA" });
    expect(await processarMensagem("nao-existe")).toEqual({ tipo: "IGNORADA" });
  });
});

describe("falhas → FALHA com ref, nunca quebra, nunca loga o texto", () => {
  it("sem ANTHROPIC_API_KEY → FALHA com motivo claro e ❌ com ref", async () => {
    process.env.LLM_PROVEDOR = "anthropic";
    delete process.env.ANTHROPIC_API_KEY;
    const m = await bruta("#crm Gustavo segredo da Economia Sensata");
    const r = await processarMensagem(m.id);
    expect(r).toMatchObject({ tipo: "FALHA", codigo: "LLM_SEM_CHAVE" });
    if (r.tipo !== "FALHA") throw new Error();
    expect(r.confirmacao).toBe(`❌ não consegui processar, veja no CRM (ref: ${r.ref})`);
    const d = await dbT.mensagemBruta.findUniqueOrThrow({ where: { id: m.id } });
    expect(d.status).toBe("FALHA");
    expect(d.erro).toContain("SEM_CHAVE");
    expect(d.erro).toContain("ANTHROPIC_API_KEY ausente");
    // Falha antes da chamada: registra o modelo do provedor configurado, não o padrão da OpenAI.
    expect(d.resultadoLlm).toMatchObject({ modelo: "claude-haiku-5-5" });
    expect(d.erro).toContain(`ref=${r.ref}`);
    expect(logs(console.error)).toContain(`ref=${r.ref}`);
    expect(logs(console.error) + logs(console.info)).not.toContain("segredo");
  });

  it("sem crédito (motivo padrão neutro) → FALHA com motivo específico + ref (reprocessável depois)", async () => {
    definirRespostaMock(() => {
      throw new ErroLlm("SEM_CREDITO", { status: 402 });
    });
    const m = await bruta("#crm Gustavo segredo");
    const r = await processarMensagem(m.id);
    expect(r).toMatchObject({ tipo: "FALHA", codigo: "LLM_SEM_CREDITO" });
    if (r.tipo !== "FALHA") throw new Error();
    expect(r.confirmacao).toBe(`❌ não consegui processar, veja no CRM (ref: ${r.ref})`);
    const d = await dbT.mensagemBruta.findUniqueOrThrow({ where: { id: m.id } });
    expect(d.status).toBe("FALHA");
    expect(d.erro).toContain("sem crédito na API de LLM");
    expect(d.erro).toContain(`ref=${r.ref}`);
    expect(logs(console.error)).toContain(`ref=${r.ref}`);
    expect(logs(console.error) + logs(console.info)).not.toContain("segredo");
  });

  it("recusa da LLM (stop_reason refusal) → FALHA com ref", async () => {
    definirRespostaMock(() => {
      throw new ErroLlm("RECUSA");
    });
    const m = await bruta("#crm x");
    const r = await processarMensagem(m.id);
    expect(r).toMatchObject({ tipo: "FALHA", codigo: "LLM_RECUSA" });
    if (r.tipo !== "FALHA") throw new Error();
    const d = await dbT.mensagemBruta.findUniqueOrThrow({ where: { id: m.id } });
    expect(d.status).toBe("FALHA");
    expect(d.erro).toContain(`RECUSA`);
    expect(d.erro).toContain(`ref=${r.ref}`);
  });

  it("saída fora do schema → FALHA, bruto guardado em resultado_llm", async () => {
    definirRespostaMock(() => ({ intencao: "CRIAR", contato: "Gustavo segredo" }));
    const m = await bruta("#crm x");
    const r = await processarMensagem(m.id);
    expect(r).toMatchObject({ tipo: "FALHA", codigo: "LLM_SAIDA_INVALIDA" });
    const d = await dbT.mensagemBruta.findUniqueOrThrow({ where: { id: m.id } });
    expect(d.resultadoLlm).toMatchObject({ saida: { contato: "Gustavo segredo" }, aplicacao: { tipo: "FALHA", codigo: "LLM_SAIDA_INVALIDA" } });
    expect(logs(console.error) + logs(console.info)).not.toContain("segredo");
  });

  it("provedor lança erro qualquer com texto → FALHA; mensagem do erro não vai para log", async () => {
    definirRespostaMock(() => {
      throw new Error("falha com texto sensível");
    });
    const r = await processarMensagem((await bruta("#crm x")).id);
    expect(r).toMatchObject({ tipo: "FALHA", codigo: "INESPERADO" });
    expect(logs(console.error)).not.toContain("sensível");
  });

  it("erro na aplicação desfaz TUDO (nenhum card/empresa/contato), status FALHA", async () => {
    const original = db.$transaction.bind(db);
    vi.spyOn(db, "$transaction").mockImplementationOnce(((fn: (tx: unknown) => Promise<unknown>, o: unknown) =>
      original(async (tx) => {
        const quebrado = new Proxy(tx as object, {
          get(alvo, prop, receptor) {
            if (prop === "timeline") return { create: async () => { throw new Error("quebrou com texto sensível"); } };
            return Reflect.get(alvo, prop, receptor);
          },
        });
        return fn(quebrado);
      }, o as never)) as typeof db.$transaction);
    const m = await bruta(FIXTURES_EXTRACAO[0].texto);
    const r = await processarMensagem(m.id);
    expect(r).toMatchObject({ tipo: "FALHA" });
    expect(await dbT.oportunidade.count()).toBe(0);
    expect(await dbT.empresa.count()).toBe(0);
    expect(await dbT.contato.count()).toBe(0);
    const d = await dbT.mensagemBruta.findUniqueOrThrow({ where: { id: m.id } });
    expect(d.status).toBe("FALHA");
    expect(d.resultadoLlm).toMatchObject({ saida: FIXTURES_EXTRACAO[0].saida });
    expect(logs(console.error)).not.toContain("sensível");
  });

  it("nunca lança para o after(): erro ao carregar a linha → registra com ref e devolve", async () => {
    const m = await bruta("#crm x");
    vi.spyOn(db.mensagemBruta, "findUnique").mockRejectedValueOnce(new Error("banco caiu com texto sensível"));
    const r = await processarMensagem(m.id);
    expect(r).toMatchObject({ tipo: "ERRO", ref: expect.any(String) });
    if (r.tipo !== "ERRO") throw new Error();
    expect(logs(console.error)).toContain(`ref=${r.ref}`);
    expect(logs(console.error)).not.toContain("sensível");
  });

  it("nunca lança para o after(): erro ao gravar a FALHA → registra com ref e devolve (linha fica para o GAB-41)", async () => {
    definirRespostaMock(() => {
      throw new ErroLlm("HTTP", { status: 500 });
    });
    const m = await bruta("#crm x");
    vi.spyOn(db.mensagemBruta, "updateMany").mockRejectedValue(new Error("banco caiu"));
    const r = await processarMensagem(m.id);
    expect(r).toMatchObject({ tipo: "ERRO" });
    expect(await dbT.mensagemBruta.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ status: "PROCESSANDO" });
    expect(logs(console.info)).not.toContain("SAFE MODE");
  });

  it("log de custo/latência por chamada, sem o texto", async () => {
    await processarMensagem((await bruta(FIXTURES_EXTRACAO[0].texto)).id);
    const l = logs(console.info);
    expect(l).toMatch(/\[llm\] extracao ref=\S+ provedor=mock modelo=mock-extracao versao=extracao\.v2 ms=\d+ tokens_in=\d+ tokens_out=\d+ ok/);
    expect(l).not.toContain("Gustavo");
  });
});

describe("contexto", () => {
  it("reply: a LLM recebe o texto da mensagem respondida e candidatos por identificador", async () => {
    await bruta("#crm falei com o Gustavo da Economia Sensata", { eventoId: "ORIGINAL", status: "PROCESSADA" });
    const c = await dbT.contato.create({
      data: { nome: "Gustavo", pontos: { create: [{ tipo: "TELEFONE", valorNormalizado: "+5511977776666", valorOriginal: "x" }] } },
    });
    let usuario = "";
    definirRespostaMock((_, pedido) => {
      usuario = pedido.usuario;
      return saida({ empresa: { nome: "Economia Sensata" } });
    });
    await processarMensagem((await bruta("#crm o tel dele é 11 97777-6666", { respondendoEventoId: "ORIGINAL" })).id);
    expect(usuario).toContain("<respondendo_a>\n#crm falei com o Gustavo da Economia Sensata\n</respondendo_a>");
    expect(usuario).toContain(`id=${c.id} nome="Gustavo" empresa=null via=telefone`);
    expect(usuario).toContain("Vendedor (remetente): João");
    expect(usuario).toContain("- primeiro_contato — Primeiro Contato");
  });
});

describe("config técnica indisponível (GAB-42)", () => {
  it("banco falha ao carregar a config → não reivindica: a mensagem fica RECEBIDA para o cron", async () => {
    invalidarConfigTecnica();
    vi.spyOn(db.configuracao, "findUnique").mockRejectedValueOnce(new Error("db fora"));
    const m = await bruta("#crm falei com o Gustavo");
    const r = await processarMensagem(m.id);
    expect(r).toMatchObject({ tipo: "ERRO", ref: expect.stringMatching(/^[0-9a-f]{8}$/) });
    const depois = await dbT.mensagemBruta.findUniqueOrThrow({ where: { id: m.id } });
    expect(depois).toMatchObject({ status: "RECEBIDA", tentativas: 0 });
    invalidarConfigTecnica();
  });
});

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { dbTeste, limparBanco } from "@/test/db";
import { fixtureEvolution, GRUPO_FIXTURE, type NomeFixture } from "@/test/fixtures/evolution";
import { FIXTURES_EXTRACAO } from "@/lib/llm/fixtures/extracao";
import { semear } from "../../../../../prisma/seed";
import { definirSobrescritas } from "@/lib/config/sobrescritas";
import { invalidarConfigTecnica } from "@/lib/config/tecnica";

// `after()` do Next só funciona dentro de um request scope. Aqui o handler é
// chamado direto, então a tarefa roda imediatamente e fica numa fila que o
// teste aguarda antes de inspecionar o envio.
const { tarefasDepois } = vi.hoisted(() => ({ tarefasDepois: [] as Promise<unknown>[] }));
vi.mock("next/server", () => ({
  after: (tarefa: () => unknown) => {
    tarefasDepois.push(Promise.resolve().then(tarefa));
  },
}));

import { POST } from "./route";

const SEGREDO = "segredo-de-teste-com-tamanho-razoavel";
const CHAVE_EVOLUTION = "chave-evolution-de-teste-0123456789abcdef";
const TABELAS = [
  "inbox_evento",
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
  "remetente_desconhecido",
  "contador_descartadas",
  "sessao",
  "usuario",
];
const dbT = dbTeste();
const envOriginal = { ...process.env };

function requisicao(corpo: unknown, headers: Record<string, string> = { "x-webhook-secret": SEGREDO }) {
  return new Request("http://localhost:3000/api/webhooks/evolution", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });
}

async function postar(nome: NomeFixture | Record<string, unknown>, headers?: Record<string, string>) {
  const corpo = typeof nome === "string" ? fixtureEvolution(nome) : nome;
  const res = await POST(requisicao(corpo, headers));
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status, json };
}

async function aguardarDepois() {
  await Promise.all(tarefasDepois.splice(0));
}

async function vendedor(extra: { nome?: string; telefoneWhatsapp?: string | null; whatsappLid?: string; ativo?: boolean } = {}) {
  return dbT.usuario.create({
    data: {
      nome: "João",
      email: `joao-${Math.random().toString(36).slice(2)}@ij.test`,
      papel: "VENDEDOR",
      telefoneWhatsapp: "+5511999998888",
      ...extra,
    },
  });
}

async function contagens() {
  const [inbox, brutas, enviadas, desconhecidos, descartadas] = await Promise.all([
    dbT.inboxEvento.count(),
    dbT.mensagemBruta.count(),
    dbT.mensagemEnviada.count(),
    dbT.remetenteDesconhecido.count(),
    dbT.contadorDescartadas.findMany(),
  ]);
  return { inbox, brutas, enviadas, desconhecidos, descartadas: descartadas.reduce((s, c) => s + c.total, 0) };
}

const ZERO = { inbox: 0, brutas: 0, enviadas: 0, desconhecidos: 0, descartadas: 0 };

function logs(spy: unknown): string {
  return (spy as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c.map(String).join(" ")).join("\n");
}

beforeEach(async () => {
  await limparBanco(TABELAS);
  await semear(dbT, { log: () => {} });
  process.env.LLM_PROVEDOR = "mock";
  process.env.EVOLUTION_WEBHOOK_SECRET = SEGREDO;
  process.env.GRUPO_JID = GRUPO_FIXTURE;
  process.env.EVOLUTION_API_URL = "http://evolution.test:8080";
  process.env.EVOLUTION_API_KEY = CHAVE_EVOLUTION;
  process.env.EVOLUTION_INSTANCE = "ij-crm";
  delete process.env.NOTIFICATIONS_ENABLED;
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await aguardarDepois();
  vi.restoreAllMocks();
  process.env = { ...envOriginal };
});

describe("POST /api/webhooks/evolution — autenticação", () => {
  it("segredo errado no header e apikey errada no corpo → 401 e nada persistido", async () => {
    await vendedor();
    const r = await postar("texto-grupo", { "x-webhook-secret": "errado" });
    expect(r.status).toBe(401);
    expect(await contagens()).toEqual(ZERO);
  });

  it("sem header e apikey do corpo ≠ EVOLUTION_API_KEY → 401", async () => {
    expect((await postar("texto-grupo", {})).status).toBe(401);
  });

  it("header `apikey` também vale como segredo do webhook", async () => {
    await vendedor();
    const r = await postar("texto-grupo", { apikey: SEGREDO });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true });
  });

  it("fallback: apikey do CORPO == EVOLUTION_API_KEY autentica sem header", async () => {
    await vendedor();
    const p = fixtureEvolution("texto-grupo");
    p.apikey = CHAVE_EVOLUTION;
    const r = await postar(p, {});
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, persistida: true });
  });

  it("fallback do corpo não vale com EVOLUTION_API_KEY fraca", async () => {
    await vendedor();
    process.env.EVOLUTION_API_KEY = "troque-me-openssl-rand-hex-32-xxxxxxxxxx";
    const p = fixtureEvolution("texto-grupo");
    p.apikey = "troque-me-openssl-rand-hex-32-xxxxxxxxxx";
    expect((await postar(p, {})).status).toBe(401);
    process.env.EVOLUTION_API_KEY = "curta";
    p.apikey = "curta";
    expect((await postar(p, {})).status).toBe(401);
    expect(await contagens()).toEqual(ZERO);
  });

  it("EVOLUTION_WEBHOOK_SECRET vazio/ausente → header nunca autentica (falha fechada)", async () => {
    delete process.env.EVOLUTION_API_KEY; // sem fallback também
    process.env.EVOLUTION_WEBHOOK_SECRET = "";
    expect((await postar("texto-grupo", { "x-webhook-secret": "" })).status).toBe(401);
    delete process.env.EVOLUTION_WEBHOOK_SECRET;
    expect((await postar("texto-grupo", { "x-webhook-secret": SEGREDO })).status).toBe(401);
    expect(logs(console.error)).toContain("EVOLUTION_WEBHOOK_SECRET AUSENTE");
  });

  it.each(["troque-me-openssl-rand-hex-32-xxxxxxxxxx", "a".repeat(31)])(
    "EVOLUTION_WEBHOOK_SECRET fraco (%j) → 401 mesmo com header igual",
    async (fraco) => {
      delete process.env.EVOLUTION_API_KEY;
      process.env.EVOLUTION_WEBHOOK_SECRET = fraco;
      const r = await postar("texto-grupo", { "x-webhook-secret": fraco });
      expect(r.status).toBe(401);
      expect(await contagens()).toEqual(ZERO);
    },
  );

  it("GRUPO_JID ausente → 503 (depois da autenticação)", async () => {
    delete process.env.GRUPO_JID;
    expect((await postar("texto-grupo")).status).toBe(503);
    expect((await postar("texto-grupo", { "x-webhook-secret": "errado" })).status).toBe(401);
  });

  it("corpo que não é JSON: 400 com header válido, 401 sem", async () => {
    expect((await POST(requisicao("isto não é json"))).status).toBe(400);
    expect((await POST(requisicao("isto não é json", {}))).status).toBe(401);
  });

  it("objeto vazio autenticado é payload inválido, ignorado com 200 e log só de campos", async () => {
    const r = await postar({} as Record<string, unknown>);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, ignorado: true, motivo: "PAYLOAD_INVALIDO" });
    expect(logs(console.warn)).toMatch(/payload inválido; campos: .*event/);
  });
});

describe("POST /api/webhooks/evolution — filtros (200 sem efeito)", () => {
  it.each(["outro-chat", "from-me", "imagem", "outro-evento"] as const)("%s → 200 e nenhuma linha", async (nome) => {
    await vendedor();
    const r = await postar(nome);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, ignorado: true });
    expect(await contagens()).toEqual(ZERO);
    // O log do descarte não carrega texto da mensagem.
    expect(logs(console.info)).not.toContain("#crm");
  });
});

describe("POST /api/webhooks/evolution — ingestão", () => {
  it("#crm de usuário conhecido → MensagemBruta persistida + InboxEvento PROCESSADO; safe mode não chama a Evolution", async () => {
    const u = await vendedor();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await postar("texto-grupo");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, persistida: true });
    // Antes do after(): a ingestão comitou RECEBIDA; a LLM ainda não rodou.
    expect((await dbT.mensagemBruta.findUniqueOrThrow({ where: { eventoId: "3EB0A1B2C3D4E5F60001" } })).status).toBe("RECEBIDA");
    await aguardarDepois();

    const bruta = await dbT.mensagemBruta.findUniqueOrThrow({ where: { eventoId: "3EB0A1B2C3D4E5F60001" } });
    expect(bruta).toMatchObject({
      // Texto sem fixture no mock → sem nome identificado → fila de revisão.
      status: "PENDENTE_REVISAO",
      grupoJid: GRUPO_FIXTURE,
      remetenteTelefone: "+5511999998888",
      remetenteLid: null,
      remetenteUsuarioId: u.id,
      respondendoEventoId: null,
      texto: "#crm falei com o Gustavo da Economia Sensata, mando proposta sexta",
    });
    expect(bruta.recebidaEm).toEqual(new Date(1761307200 * 1000));
    const inbox = await dbT.inboxEvento.findUniqueOrThrow({ where: { eventoId: "3EB0A1B2C3D4E5F60001" } });
    expect(inbox.status).toBe("PROCESSADO");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await dbT.mensagemEnviada.count()).toBe(0);
  });

  it("reply com #crm → respondendoEventoId = stanzaId", async () => {
    await vendedor();
    await postar("resposta-grupo");
    const bruta = await dbT.mensagemBruta.findUniqueOrThrow({ where: { eventoId: "3EB0A1B2C3D4E5F60002" } });
    expect(bruta.respondendoEventoId).toBe("3EB0A1B2C3D4E5F60001");
    expect(bruta.texto).toBe("é da Economia Sensata #CRM");
  });

  it.each(["efemera", "editada"] as const)("%s → persiste o texto desembrulhado", async (nome) => {
    await vendedor();
    const r = await postar(nome);
    expect(r.json).toMatchObject({ persistida: true });
    expect(await contagens()).toMatchObject({ inbox: 1, brutas: 1 });
  });

  it("remetente @lid casado por Usuario.whatsappLid", async () => {
    const u = await vendedor({ telefoneWhatsapp: null, whatsappLid: "123456789012345@lid" });
    const r = await postar("participante-lid");
    expect(r.json).toMatchObject({ persistida: true });
    const bruta = await dbT.mensagemBruta.findUniqueOrThrow({ where: { eventoId: "3EB0A1B2C3D4E5F60003" } });
    expect(bruta).toMatchObject({ remetenteUsuarioId: u.id, remetenteLid: "123456789012345@lid", remetenteTelefone: null });
  });

  it("participantAlt: usuário só com telefone é reconhecido; LID e telefone ficam gravados", async () => {
    const u = await vendedor();
    const r = await postar("participant-alt");
    expect(r.json).toMatchObject({ persistida: true });
    const bruta = await dbT.mensagemBruta.findUniqueOrThrow({ where: { eventoId: "3EB0A1B2C3D4E5F60007" } });
    expect(bruta).toMatchObject({ remetenteUsuarioId: u.id, remetenteLid: "123456789012345@lid", remetenteTelefone: "+5511999998888" });
  });

  it("LID tem prioridade sobre telefone quando só o LID casa com outro usuário? não: LID e telefone em usuários diferentes → desconhecido + warn", async () => {
    await vendedor({ nome: "Por LID", telefoneWhatsapp: null, whatsappLid: "123456789012345@lid" });
    await vendedor({ nome: "Por telefone" });
    const r = await postar("participant-alt");
    expect(r.json).toMatchObject({ remetenteDesconhecido: true });
    expect(await contagens()).toMatchObject({ inbox: 1, brutas: 0, desconhecidos: 1 });
    // Chave do desconhecido é o LID quando presente.
    expect(await dbT.remetenteDesconhecido.findUnique({ where: { lid: "123456789012345@lid" } })).toMatchObject({ total: 1 });
    const aviso = logs(console.warn);
    expect(aviso).toContain("remetente ambíguo");
    expect(aviso).not.toContain("123456789012345");
    expect(aviso).not.toContain("5511999998888");
  });

  it("LID e telefone apontando para o MESMO usuário → ok", async () => {
    const u = await vendedor({ whatsappLid: "123456789012345@lid" });
    const r = await postar("participant-alt");
    expect(r.json).toMatchObject({ persistida: true });
    const bruta = await dbT.mensagemBruta.findFirstOrThrow();
    expect(bruta.remetenteUsuarioId).toBe(u.id);
  });

  it("mesmo key.id duas vezes → segunda responde duplicado e só existe uma MensagemBruta", async () => {
    await vendedor();
    const a = await postar("texto-grupo");
    const b = await postar("texto-grupo");
    expect(a.json).toMatchObject({ ok: true, persistida: true });
    expect(b.status).toBe(200);
    expect(b.json).toEqual({ ok: true, duplicado: true });
    expect(await contagens()).toMatchObject({ inbox: 1, brutas: 1 });
  });

  it("violação de unicidade FORA do inbox não vira duplicado: 500 e inbox desfeito", async () => {
    await vendedor();
    // mensagem_bruta já tem esse evento_id (sem linha de inbox): o create da
    // bruta falha com P2002 — isso é erro de verdade, não "já processado".
    await dbT.mensagemBruta.create({
      data: { eventoId: "3EB0A1B2C3D4E5F60001", grupoJid: GRUPO_FIXTURE, texto: "órfã", recebidaEm: new Date() },
    });
    const r = await postar("texto-grupo");
    expect(r.status).toBe(500);
    expect(r.json).toEqual({ erro: "falha_processamento" });
    expect(await contagens()).toMatchObject({ inbox: 0, brutas: 1 });
    const erro = logs(console.error);
    expect(erro).toContain("PrismaClientKnownRequestError P2002");
    expect(erro).not.toContain("Gustavo");
  });

  it("sem tag → nada persistido, InboxEvento marcado e ContadorDescartadas do dia +1", async () => {
    await vendedor();
    const p = fixtureEvolution("texto-grupo");
    (p.data as { message: { conversation: string } }).message.conversation = "bom dia pessoal, alguém viu meu carregador?";
    const r = await postar(p);
    expect(r.json).toMatchObject({ ok: true, descartada: true });
    expect(await contagens()).toMatchObject({ inbox: 1, brutas: 0, enviadas: 0, desconhecidos: 0, descartadas: 1 });

    // Segunda mensagem sem tag no mesmo dia soma no mesmo registro.
    (p.data as { key: { id: string } }).key.id = "3EB0A1B2C3D4E5F6ZZZZ";
    await postar(p);
    const linhas = await dbT.contadorDescartadas.findMany();
    expect(linhas).toHaveLength(1);
    expect(linhas[0].total).toBe(2);
  });

  it("sem tag de número DESCONHECIDO → só o contador; nem a identidade é registrada", async () => {
    const p = fixtureEvolution("texto-grupo");
    (p.data as { message: { conversation: string } }).message.conversation = "oi, quem é o responsável pelo grupo?";
    const r = await postar(p);
    expect(r.json).toMatchObject({ descartada: true });
    expect(await contagens()).toMatchObject({ inbox: 1, brutas: 0, desconhecidos: 0, descartadas: 1 });
  });

  it("remetente desconhecido com #crm → RemetenteDesconhecido (total acumula), nenhum conteúdo persistido", async () => {
    const r = await postar("texto-grupo");
    expect(r.json).toMatchObject({ ok: true, remetenteDesconhecido: true });
    await postar("resposta-grupo");
    expect(await contagens()).toMatchObject({ inbox: 2, brutas: 0, enviadas: 0, desconhecidos: 1, descartadas: 0 });
    const d = await dbT.remetenteDesconhecido.findFirstOrThrow();
    expect(d).toMatchObject({ telefone: "+5511999998888", lid: null, total: 2 });

    const lid = await postar("participante-lid");
    expect(lid.json).toMatchObject({ remetenteDesconhecido: true });
    expect(await dbT.remetenteDesconhecido.findUnique({ where: { lid: "123456789012345@lid" } })).toMatchObject({ total: 1 });
  });

  it("usuário inativo conta como desconhecido (se a mensagem tinha tag)", async () => {
    await vendedor({ ativo: false });
    const r = await postar("texto-grupo");
    expect(r.json).toMatchObject({ remetenteDesconhecido: true });
    expect(await contagens()).toMatchObject({ brutas: 0, desconhecidos: 1 });
  });

  it("falha no processamento → 500, log sem a mensagem do erro, e NENHUMA linha de InboxEvento sobra", async () => {
    await vendedor();
    const original = db.$transaction.bind(db);
    vi.spyOn(db, "$transaction").mockImplementationOnce(((fn: (tx: unknown) => Promise<unknown>) =>
      original(async (tx) => {
        const quebrado = new Proxy(tx as object, {
          get(alvo, prop, receptor) {
            if (prop === "mensagemBruta") return { create: async () => { throw new Error("falha injetada com texto sensível"); } };
            return Reflect.get(alvo, prop, receptor);
          },
        });
        return fn(quebrado);
      })) as typeof db.$transaction);

    const r = await postar("texto-grupo");
    expect(r.status).toBe(500);
    expect(await contagens()).toEqual(ZERO);
    const erro = logs(console.error);
    expect(erro).toContain("falha ao processar evento 3EB0A1B2C3D4E5F60001: Error");
    expect(erro).not.toContain("texto sensível");

    // Re-tentativa da Evolution processa normalmente.
    const r2 = await postar("texto-grupo");
    expect(r2.json).toMatchObject({ persistida: true });
    expect(await contagens()).toMatchObject({ inbox: 1, brutas: 1 });
  });
});

describe("POST /api/webhooks/evolution — confirmação com NOTIFICATIONS_ENABLED=true", () => {
  it("chama sendText citando a mensagem (key + texto), depois da resposta, e persiste MensagemEnviada", async () => {
    process.env.NOTIFICATIONS_ENABLED = "true";
    await vendedor();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ key: { remoteJid: GRUPO_FIXTURE, fromMe: true, id: "BAE5ENVIADA0001" }, status: "PENDING" }), { status: 201 }));

    const r = await postar("resposta-grupo");
    expect(r.status).toBe(200);
    // A resposta já foi devolvida; o envio acontece na tarefa de `after()`.
    await aguardarDepois();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://evolution.test:8080/message/sendText/ij-crm");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("apikey")).toBe(CHAVE_EVOLUTION);
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body as string)).toEqual({
      number: GRUPO_FIXTURE,
      text: "⚠️ não identifiquei o lead — responde esta mensagem com o nome",
      quoted: {
        key: { id: "3EB0A1B2C3D4E5F60002", remoteJid: GRUPO_FIXTURE, fromMe: false, participant: "5511999998888@s.whatsapp.net" },
        message: { conversation: "é da Economia Sensata #CRM" },
      },
    });

    const enviada = await dbT.mensagemEnviada.findUniqueOrThrow({ where: { eventoId: "BAE5ENVIADA0001" } });
    expect(enviada).toMatchObject({ grupoJid: GRUPO_FIXTURE, texto: "⚠️ não identifiquei o lead — responde esta mensagem com o nome", oportunidadeId: null });
  });

  it("Evolution responde erro → nada em MensagemEnviada, erro só logado (mensagem já está salva)", async () => {
    process.env.NOTIFICATIONS_ENABLED = "true";
    await vendedor();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{\"status\":400}", { status: 400 }));
    const r = await postar("texto-grupo");
    expect(r.status).toBe(200);
    await aguardarDepois();
    expect(await contagens()).toMatchObject({ brutas: 1, enviadas: 0 });
    expect(logs(console.error)).toMatch(/confirmação da mensagem \S+ não enviada: ErroEnvioWhatsApp/);
  });
});

describe("POST /api/webhooks/evolution — #crm vira card (GAB-34, LLM mockada)", () => {
  const TICKET = FIXTURES_EXTRACAO[0];

  function payloadTicket() {
    const p = fixtureEvolution("texto-grupo");
    (p.data as { message: { conversation: string } }).message.conversation = TICKET.texto;
    return p;
  }

  it("safe mode: card criado com campos e Timeline; confirmação só logada (sem conteúdo)", async () => {
    const u = await vendedor();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await postar(payloadTicket());
    expect(r.json).toMatchObject({ ok: true, persistida: true });
    await aguardarDepois();

    const card = await dbT.oportunidade.findFirstOrThrow({ include: { fase: true, empresa: true, contato: true, timeline: { orderBy: { em: "asc" } } } });
    expect(card).toMatchObject({
      titulo: "Gustavo — Economia Sensata",
      responsavelId: u.id,
      dor: "relatório manual",
      proximaAcao: "mandar proposta",
      criadoVia: "WHATSAPP",
      revisar: false,
      empresa: { nome: "Economia Sensata" },
      contato: { nome: "Gustavo" },
    });
    expect(card.fase.chave).toBe("primeiro_contato");
    expect(card.orcamentoPrevisto?.toFixed(2)).toBe("15000.00");
    expect(card.proximaAcaoEm?.toISOString()).toBe("2025-10-31T03:00:00.000Z");
    expect(card.timeline.map((t) => t.tipo)).toEqual(["CRIACAO", "MENSAGEM_WHATSAPP"]);
    expect(card.timeline[1].payload).toMatchObject({ texto: TICKET.texto, saida: TICKET.saida });

    const bruta = await dbT.mensagemBruta.findFirstOrThrow();
    expect(bruta).toMatchObject({ status: "PROCESSADA", erro: null, resultadoLlm: { saida: TICKET.saida, aplicacao: { tipo: "CRIADO", oportunidadeId: card.id } } });
    expect(fetchSpy).not.toHaveBeenCalled();
    const info = logs(console.info);
    expect(info).toContain("[SAFE MODE] WhatsApp NÃO enviado");
    expect(info).not.toContain("Gustavo");
  });

  it("NOTIFICATIONS_ENABLED=true: UMA resposta, citando a mensagem, com o texto exato e o card ligado", async () => {
    process.env.NOTIFICATIONS_ENABLED = "true";
    await vendedor();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ key: { id: "BAE5CONFIRMA01" } }), { status: 201 }));
    await postar(payloadTicket());
    await aguardarDepois();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const corpo = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(corpo.text).toBe("✅ Gustavo — Economia Sensata → Primeiro Contato. Resp: João. Próx.: mandar proposta (31/10)");
    expect(corpo.quoted.key).toMatchObject({ id: "3EB0A1B2C3D4E5F60001", participant: "5511999998888@s.whatsapp.net" });
    const card = await dbT.oportunidade.findFirstOrThrow();
    expect(await dbT.mensagemEnviada.findUniqueOrThrow({ where: { eventoId: "BAE5CONFIRMA01" } })).toMatchObject({ oportunidadeId: card.id });
  });

  it("retry da Evolution (mesmo key.id) → duplicado: nenhuma segunda chamada à LLM nem segundo card", async () => {
    await vendedor();
    await postar(payloadTicket());
    await aguardarDepois();
    const b = await postar(payloadTicket());
    await aguardarDepois();
    expect(b.json).toEqual({ ok: true, duplicado: true });
    expect(await dbT.oportunidade.count()).toBe(1);
  });

  it("sem ANTHROPIC_API_KEY (provedor anthropic) → FALHA com ref, 200 para a Evolution, nada quebra", async () => {
    process.env.LLM_PROVEDOR = "anthropic";
    delete process.env.ANTHROPIC_API_KEY;
    await vendedor();
    const r = await postar(payloadTicket());
    expect(r.status).toBe(200);
    await aguardarDepois();
    const bruta = await dbT.mensagemBruta.findFirstOrThrow();
    expect(bruta.status).toBe("FALHA");
    expect(bruta.erro).toMatch(/SEM_CHAVE.*ref=[0-9a-f]{8}/);
    expect(await dbT.oportunidade.count()).toBe(0);
  });
});

describe("POST /api/webhooks/evolution — config técnica e logs (GAB-42)", () => {
  beforeEach(async () => {
    await limparBanco(["log_webhook", "log_llm", "configuracao"]);
    invalidarConfigTecnica();
    definirSobrescritas(undefined);
  });
  afterEach(() => {
    invalidarConfigTecnica();
    definirSobrescritas(undefined);
  });

  it("GRUPO_JID salvo no Admin vence o env", async () => {
    await vendedor();
    process.env.GRUPO_JID = "999999999@g.us"; // env aponta para outro grupo
    await dbT.configuracao.create({ data: { chave: "tecnica", valor: { grupoJid: GRUPO_FIXTURE } } });
    const r = await postar("texto-grupo");
    expect(r.json).toMatchObject({ ok: true, persistida: true });
  });

  it("grava log_webhook e log_llm sem texto, telefone ou JID em claro", async () => {
    await vendedor();
    await postar("texto-grupo");
    await postar("texto-grupo"); // duplicado
    await POST(requisicao(fixtureEvolution("texto-grupo"), { "x-webhook-secret": "errado" }));
    await aguardarDepois();

    const web = await dbT.logWebhook.findMany({ orderBy: { id: "asc" } });
    expect(web.map((l) => [l.status, l.resultado])).toEqual([
      [200, "persistida"],
      [200, "duplicado"],
      [401, "nao_autorizado"],
    ]);
    expect(web[0]).toMatchObject({ tipo: "messages.upsert", chat: expect.stringMatching(/^\d{2}\*+\d{2}@g\.us$/) });
    expect(web[2]).toMatchObject({ tipo: null, chat: null });
    const llm = await dbT.logLlm.findMany();
    expect(llm).toHaveLength(1);
    expect(llm[0]).toMatchObject({ operacao: "extracao", status: "ok", provedor: "mock" });

    const tudo = JSON.stringify([web, llm]);
    for (const proibido of ["#crm", "Gustavo", "Economia", "5511999998888", "999998888", GRUPO_FIXTURE]) expect(tudo).not.toContain(proibido);
  });
});

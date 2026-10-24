// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { dbTeste, limparBanco } from "@/test/db";
import { fixtureEvolution, GRUPO_FIXTURE, type NomeFixture } from "@/test/fixtures/evolution";

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
const TABELAS = ["inbox_evento", "mensagem_bruta", "mensagem_enviada", "remetente_desconhecido", "contador_descartadas", "sessao", "usuario"];
const dbT = dbTeste();
const envOriginal = { ...process.env };

function requisicao(corpo: unknown, headers: Record<string, string> = { apikey: SEGREDO }) {
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

async function vendedor(extra: { telefoneWhatsapp?: string; whatsappLid?: string; ativo?: boolean } = {}) {
  return dbT.usuario.create({
    data: { nome: "João", email: `joao-${Math.random().toString(36).slice(2)}@ij.test`, papel: "VENDEDOR", telefoneWhatsapp: "+5511999998888", ...extra },
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

beforeEach(async () => {
  await limparBanco(TABELAS);
  process.env.EVOLUTION_WEBHOOK_SECRET = SEGREDO;
  process.env.GRUPO_JID = GRUPO_FIXTURE;
  process.env.EVOLUTION_API_URL = "http://evolution.test:8080";
  process.env.EVOLUTION_API_KEY = "chave-evolution";
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

describe("POST /api/webhooks/evolution — segredo", () => {
  it("segredo errado → 401 e nada persistido", async () => {
    await vendedor();
    const r = await postar("texto-grupo", { apikey: "errado" });
    expect(r.status).toBe(401);
    expect(await contagens()).toMatchObject({ inbox: 0, brutas: 0 });
  });

  it("sem header → 401", async () => {
    expect((await postar("texto-grupo", {})).status).toBe(401);
  });

  it("EVOLUTION_WEBHOOK_SECRET vazio → 401 mesmo com header igual (falha fechada)", async () => {
    process.env.EVOLUTION_WEBHOOK_SECRET = "";
    expect((await postar("texto-grupo", { apikey: "" })).status).toBe(401);
    delete process.env.EVOLUTION_WEBHOOK_SECRET;
    expect((await postar("texto-grupo", { apikey: SEGREDO })).status).toBe(401);
  });

  it("aceita também x-webhook-secret", async () => {
    await vendedor();
    const r = await postar("texto-grupo", { "x-webhook-secret": SEGREDO });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true });
  });

  it("GRUPO_JID ausente → 503", async () => {
    delete process.env.GRUPO_JID;
    expect((await postar("texto-grupo")).status).toBe(503);
  });

  it("corpo que não é JSON → 400 (Evolution não re-tenta 4xx)", async () => {
    const r = await postar({} as Record<string, unknown>);
    expect(r.status).toBe(200); // objeto vazio é payload inválido, ignorado
    const res = await POST(requisicao("isto não é json"));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/webhooks/evolution — filtros (200 sem efeito)", () => {
  it.each(["outro-chat", "from-me", "imagem", "outro-evento"] as const)("%s → 200 e nenhuma linha", async (nome) => {
    await vendedor();
    const r = await postar(nome);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, ignorado: true });
    expect(await contagens()).toEqual({ inbox: 0, brutas: 0, enviadas: 0, desconhecidos: 0, descartadas: 0 });
  });
});

describe("POST /api/webhooks/evolution — ingestão", () => {
  it("#crm de usuário conhecido → MensagemBruta RECEBIDA + InboxEvento PROCESSADO; safe mode não chama a Evolution", async () => {
    const u = await vendedor();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await postar("texto-grupo");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, persistida: true });
    await aguardarDepois();

    const bruta = await dbT.mensagemBruta.findUniqueOrThrow({ where: { eventoId: "3EB0A1B2C3D4E5F60001" } });
    expect(bruta).toMatchObject({
      status: "RECEBIDA",
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

  it("remetente @lid casado por Usuario.whatsappLid", async () => {
    const u = await vendedor({ telefoneWhatsapp: undefined, whatsappLid: "123456789012345@lid" });
    const r = await postar("participante-lid");
    expect(r.json).toMatchObject({ persistida: true });
    const bruta = await dbT.mensagemBruta.findUniqueOrThrow({ where: { eventoId: "3EB0A1B2C3D4E5F60003" } });
    expect(bruta).toMatchObject({ remetenteUsuarioId: u.id, remetenteLid: "123456789012345@lid", remetenteTelefone: null });
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

  it("sem tag → nada persistido, InboxEvento marcado e ContadorDescartadas do dia +1", async () => {
    await vendedor();
    const p = fixtureEvolution("texto-grupo");
    (p.data as { message: { conversation: string } }).message.conversation = "bom dia pessoal, alguém viu meu carregador?";
    const r = await postar(p);
    expect(r.json).toMatchObject({ ok: true, descartada: true });
    const c = await contagens();
    expect(c).toMatchObject({ inbox: 1, brutas: 0, enviadas: 0, desconhecidos: 0, descartadas: 1 });

    // Segunda mensagem sem tag no mesmo dia soma no mesmo registro.
    (p.data as { key: { id: string } }).key.id = "3EB0A1B2C3D4E5F6ZZZZ";
    await postar(p);
    const linhas = await dbT.contadorDescartadas.findMany();
    expect(linhas).toHaveLength(1);
    expect(linhas[0].total).toBe(2);
  });

  it("remetente desconhecido → RemetenteDesconhecido (total acumula), nenhum conteúdo persistido", async () => {
    const r = await postar("texto-grupo");
    expect(r.json).toMatchObject({ ok: true, remetenteDesconhecido: true });
    await postar("resposta-grupo");
    const c = await contagens();
    expect(c).toMatchObject({ inbox: 2, brutas: 0, enviadas: 0, desconhecidos: 1, descartadas: 0 });
    const d = await dbT.remetenteDesconhecido.findFirstOrThrow();
    expect(d).toMatchObject({ telefone: "+5511999998888", lid: null, total: 2 });

    const lid = await postar("participante-lid");
    expect(lid.json).toMatchObject({ remetenteDesconhecido: true });
    expect(await dbT.remetenteDesconhecido.findUnique({ where: { lid: "123456789012345@lid" } })).toMatchObject({ total: 1 });
  });

  it("usuário inativo conta como desconhecido", async () => {
    await vendedor({ ativo: false });
    const r = await postar("texto-grupo");
    expect(r.json).toMatchObject({ remetenteDesconhecido: true });
    expect(await contagens()).toMatchObject({ brutas: 0, desconhecidos: 1 });
  });

  it("falha no processamento → 500 e NENHUMA linha de InboxEvento sobra (dedup atômico)", async () => {
    await vendedor();
    const original = db.$transaction.bind(db);
    vi.spyOn(db, "$transaction").mockImplementationOnce(((fn: (tx: unknown) => Promise<unknown>) =>
      original(async (tx) => {
        const quebrado = new Proxy(tx as object, {
          get(alvo, prop, receptor) {
            if (prop === "mensagemBruta") return { create: async () => { throw new Error("falha injetada"); } };
            return Reflect.get(alvo, prop, receptor);
          },
        });
        return fn(quebrado);
      })) as typeof db.$transaction);

    const r = await postar("texto-grupo");
    expect(r.status).toBe(500);
    expect(await contagens()).toEqual({ inbox: 0, brutas: 0, enviadas: 0, desconhecidos: 0, descartadas: 0 });

    // Re-tentativa da Evolution processa normalmente.
    const r2 = await postar("texto-grupo");
    expect(r2.json).toMatchObject({ persistida: true });
    expect(await contagens()).toMatchObject({ inbox: 1, brutas: 1 });
  });
});

describe("POST /api/webhooks/evolution — confirmação com NOTIFICATIONS_ENABLED=true", () => {
  it("chama sendText citando a mensagem, depois da resposta, e persiste MensagemEnviada", async () => {
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
    expect(new Headers(init.headers).get("apikey")).toBe("chave-evolution");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body as string)).toEqual({
      number: GRUPO_FIXTURE,
      text: "📥 recebido",
      quoted: {
        key: { id: "3EB0A1B2C3D4E5F60002", remoteJid: GRUPO_FIXTURE, fromMe: false, participant: "5511999998888@s.whatsapp.net" },
      },
    });

    const enviada = await dbT.mensagemEnviada.findUniqueOrThrow({ where: { eventoId: "BAE5ENVIADA0001" } });
    expect(enviada).toMatchObject({ grupoJid: GRUPO_FIXTURE, texto: "📥 recebido", oportunidadeId: null });
  });

  it("Evolution responde erro → nada em MensagemEnviada, erro só logado (mensagem já está salva)", async () => {
    process.env.NOTIFICATIONS_ENABLED = "true";
    await vendedor();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{\"status\":400}", { status: 400 }));
    const r = await postar("texto-grupo");
    expect(r.status).toBe(200);
    await aguardarDepois();
    expect(await contagens()).toMatchObject({ brutas: 1, enviadas: 0 });
    expect(console.error).toHaveBeenCalled();
  });
});

// @vitest-environment node
// GAB-41: reprocessamento (botão do painel e cron) — mesma função, mesma cerca.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma, StatusMensagem } from "@prisma/client";
import { FIXTURES_EXTRACAO, RECEBIDA_EM } from "@/lib/llm/fixtures/extracao";
import { definirRespostaMock } from "@/lib/llm/provedores/mock";
import { ErroLlm } from "@/lib/llm/tipos";
import { dbTeste, limparBanco } from "@/test/db";
import { semear } from "../../../prisma/seed";
import { reprocessarMensagem, retomarPendentes } from "./reprocessar";

const dbT = dbTeste();
const GRUPO = "120363000000000001@g.us";
const TABELAS = [
  "alerta_operacional",
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
const F = FIXTURES_EXTRACAO[0];
const AGORA = new Date("2026-10-27T15:00:00Z");
const min = (n: number) => new Date(AGORA.getTime() - n * 60_000);

let joao: { id: string };
let seq = 0;

async function bruta(opts: { status?: StatusMensagem; tentativas?: number; erro?: string | null; atualizadoEm?: Date; resultadoLlm?: Prisma.InputJsonValue; texto?: string; semTag?: boolean } = {}) {
  seq++;
  const m = await dbT.mensagemBruta.create({
    data: {
      eventoId: `EVT-R${seq}`,
      grupoJid: GRUPO,
      texto: opts.texto ?? F.texto,
      recebidaEm: new Date(RECEBIDA_EM.getTime() + seq),
      remetenteTelefone: "+5511999998888",
      remetenteUsuarioId: joao.id,
      status: opts.status ?? "RECEBIDA",
      tentativas: opts.tentativas ?? 0,
      erro: opts.erro ?? null,
      resultadoLlm: opts.resultadoLlm,
      semTag: opts.semTag ?? false,
    },
  });
  const em = opts.atualizadoEm ?? min(30);
  await dbT.$executeRaw`UPDATE mensagem_bruta SET atualizado_em = ${em} WHERE id = ${m.id}`;
  return m;
}

const SEM_CREDITO_LLM = { aplicacao: { tipo: "FALHA", codigo: "LLM_SEM_CREDITO", ref: "abc" } };

function safeModes(): number {
  return (console.info as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) => String(c[0]).includes("SAFE MODE")).length;
}

const status = async (id: string) => (await dbT.mensagemBruta.findUniqueOrThrow({ where: { id } })).status;

beforeEach(async () => {
  await limparBanco(TABELAS);
  await semear(dbT, { log: () => {} });
  joao = await dbT.usuario.create({ data: { nome: "João", email: "joao@ij.test", telefoneWhatsapp: "+5511999998888" } });
  process.env.LLM_PROVEDOR = "mock";
  delete process.env.NOTIFICATIONS_ENABLED;
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  definirRespostaMock(null);
  vi.restoreAllMocks();
  process.env = { ...envOriginal };
});

describe("reprocessarMensagem (botão do painel e cron)", () => {
  it("FALHA → reprocessa mantendo `erro` (resposta \"Reprocessada\") e cria o card", async () => {
    const m = await bruta({ status: "FALHA", tentativas: 1, erro: "LLM HTTP ref=abc12345" });
    const r = await reprocessarMensagem(m.id, ["FALHA", "PENDENTE_REVISAO"]);
    expect(r).toMatchObject({ tipo: "PROCESSADA", confirmacao: expect.stringMatching(/^✅ Reprocessada:/u) });
    expect(await dbT.oportunidade.count()).toBe(1);
    expect(await dbT.mensagemBruta.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ status: "PROCESSADA", tentativas: 2 });
  });

  it("dois cliques ao mesmo tempo → um card só, uma chamada à LLM", async () => {
    const chamadas = vi.fn(() => F.saida);
    definirRespostaMock(chamadas);
    const m = await bruta({ status: "FALHA", tentativas: 1, erro: "x ref=1" });
    const rs = await Promise.all([reprocessarMensagem(m.id, ["FALHA"]), reprocessarMensagem(m.id, ["FALHA"])]);
    expect(rs.map((r) => r.tipo).sort()).toEqual(expect.arrayContaining(["PROCESSADA"]));
    expect(chamadas).toHaveBeenCalledTimes(1);
    expect(await dbT.oportunidade.count()).toBe(1);
  });

  it("PROCESSADA nunca é reprocessada (não duplica card)", async () => {
    const m = await bruta({ status: "PROCESSADA" });
    expect(await reprocessarMensagem(m.id, ["FALHA", "PENDENTE_REVISAO"])).toEqual({ tipo: "NAO_REPROCESSAVEL" });
    expect(await status(m.id)).toBe("PROCESSADA");
  });

  it("PENDENTE_REVISAO pode ser reprocessada pelo painel", async () => {
    const m = await bruta({ status: "PENDENTE_REVISAO", tentativas: 1 });
    const r = await reprocessarMensagem(m.id, ["FALHA", "PENDENTE_REVISAO"]);
    expect(r.tipo).toBe("PROCESSADA");
  });

  it("falhar de novo não manda um 2º ❌ no grupo", async () => {
    definirRespostaMock(() => {
      throw new ErroLlm("HTTP", { status: 500 });
    });
    const nova = await bruta({ status: "RECEBIDA" });
    const velha = await bruta({ status: "FALHA", tentativas: 1, erro: "LLM HTTP ref=abc" });
    await reprocessarMensagem(nova.id, ["RECEBIDA"]);
    expect(safeModes()).toBe(1); // 1ª falha: ❌ com ref
    const r = await reprocessarMensagem(velha.id, ["FALHA"]);
    expect(r.tipo).toBe("FALHA");
    expect(safeModes()).toBe(1);
    expect(await status(velha.id)).toBe("FALHA");
  });
});

describe("sem #crm nunca fala no grupo (GAB-41 review)", () => {
  it("falha de mensagem sem tag (1ª vez, painel ou cron) → FALHA sem ❌", async () => {
    definirRespostaMock(() => {
      throw new ErroLlm("HTTP", { status: 500 });
    });
    const m = await bruta({ status: "RECEBIDA", semTag: true });
    const r = await reprocessarMensagem(m.id, ["RECEBIDA"]);
    expect(r.tipo).toBe("FALHA");
    expect(safeModes()).toBe(0);
    await reprocessarMensagem(m.id, ["FALHA"]);
    expect(safeModes()).toBe(0);
  });

  it("com #crm a 1ª falha continua mandando ❌", async () => {
    definirRespostaMock(() => {
      throw new ErroLlm("HTTP", { status: 500 });
    });
    const m = await bruta({ status: "RECEBIDA" });
    await reprocessarMensagem(m.id, ["RECEBIDA"]);
    expect(safeModes()).toBe(1);
  });
});

describe("retomarPendentes (cron)", () => {
  it("RECEBIDA órfã só depois de 2 min; PROCESSANDO só depois de 5 min", async () => {
    const recente = await bruta({ status: "RECEBIDA", atualizadoEm: min(1) });
    const orfa = await bruta({ status: "RECEBIDA", atualizadoEm: min(3) });
    const andando = await bruta({ status: "PROCESSANDO", tentativas: 1, atualizadoEm: min(4) });
    const travada = await bruta({ status: "PROCESSANDO", tentativas: 1, atualizadoEm: min(6) });
    const r = await retomarPendentes({ agora: AGORA });
    expect(r).toMatchObject({ destravadas: 1, tentadas: 2, processadas: 2, falhas: 0, interrompida: false });
    expect(await status(recente.id)).toBe("RECEBIDA");
    expect(await status(orfa.id)).toBe("PROCESSADA");
    expect(await status(andando.id)).toBe("PROCESSANDO");
    expect(await status(travada.id)).toBe("PROCESSADA");
  });

  it("travada ou órfã que já esgotou as tentativas → FALHA TENTATIVAS_ESGOTADAS com ref, sem chamar a LLM", async () => {
    const chamadas = vi.fn(() => F.saida);
    definirRespostaMock(chamadas);
    const travada = await bruta({ status: "PROCESSANDO", tentativas: 3, atualizadoEm: min(6) });
    const orfa = await bruta({ status: "RECEBIDA", tentativas: 4, atualizadoEm: min(3) });
    const nova = await bruta({ status: "RECEBIDA", tentativas: 5, atualizadoEm: min(1) });
    const r = await retomarPendentes({ agora: AGORA });
    expect(r).toMatchObject({ esgotadas: 2, destravadas: 0, tentadas: 0 });
    expect(chamadas).not.toHaveBeenCalled();
    for (const m of [travada, orfa]) {
      expect(await dbT.mensagemBruta.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ status: "FALHA", erro: expect.stringMatching(/^TENTATIVAS_ESGOTADAS ref=[0-9a-f]{8}$/) });
    }
    expect(await status(nova.id)).toBe("RECEBIDA");
    // Na próxima execução não volta (3+ tentativas e não é sem crédito).
    expect((await retomarPendentes({ agora: AGORA })).tentadas).toBe(0);
  });

  it("ERRO (banco/config fora) entra em `refs`", async () => {
    await bruta({ status: "RECEBIDA" });
    const tecnica = await import("@/lib/config/tecnica");
    vi.spyOn(tecnica, "carregarConfigTecnica").mockResolvedValue({ ok: false, ref: "cafe0001" } as never);
    const r = await retomarPendentes({ agora: AGORA });
    expect(r).toMatchObject({ erros: 1, interrompida: true, refs: ["cafe0001"] });
  });

  it("FALHA com menos de 3 tentativas volta mantendo `erro`; com 3 fica", async () => {
    const uma = await bruta({ status: "FALHA", tentativas: 1, erro: "LLM HTTP ref=aaa" });
    const tres = await bruta({ status: "FALHA", tentativas: 3, erro: "LLM HTTP ref=bbb" });
    const r = await retomarPendentes({ agora: AGORA });
    expect(r).toMatchObject({ tentadas: 1, processadas: 1 });
    expect(await status(uma.id)).toBe("PROCESSADA");
    expect(await status(tres.id)).toBe("FALHA");
  });

  it("FALHA por SEM_CREDITO volta mesmo com muitas tentativas (recarga)", async () => {
    const m = await bruta({ status: "FALHA", tentativas: 7, erro: "sem crédito ref=ccc", resultadoLlm: SEM_CREDITO_LLM });
    const r = await retomarPendentes({ agora: AGORA });
    expect(r).toMatchObject({ tentadas: 1, processadas: 1 });
    expect(await status(m.id)).toBe("PROCESSADA");
  });

  it("FALHA por COTA_DIARIA volta mesmo com muitas tentativas (cota volta no dia seguinte)", async () => {
    const m = await bruta({ status: "FALHA", tentativas: 7, erro: "cota diária ref=ccc", resultadoLlm: { aplicacao: { tipo: "FALHA", codigo: "LLM_COTA_DIARIA", ref: "abc" } } });
    const r = await retomarPendentes({ agora: AGORA });
    expect(r).toMatchObject({ tentadas: 1, processadas: 1 });
    expect(await status(m.id)).toBe("PROCESSADA");
  });

  it("cota diária ainda esgotada → para na 1ª (não martela a LLM)", async () => {
    const chamadas = vi.fn(() => {
      throw new ErroLlm("COTA_DIARIA", { status: 429 });
    });
    definirRespostaMock(chamadas);
    const cota = { aplicacao: { tipo: "FALHA", codigo: "LLM_COTA_DIARIA", ref: "abc" } };
    for (let i = 0; i < 3; i++) await bruta({ status: "FALHA", tentativas: 4, erro: "cota ref=x", resultadoLlm: cota });
    const r = await retomarPendentes({ agora: AGORA });
    expect(chamadas).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ tentadas: 1, falhas: 1, interrompida: true });
  });

  it("ainda sem crédito → para na 1ª (não martela a LLM)", async () => {
    const chamadas = vi.fn(() => {
      throw new ErroLlm("SEM_CREDITO", { status: 429 });
    });
    definirRespostaMock(chamadas);
    for (let i = 0; i < 3; i++) await bruta({ status: "FALHA", tentativas: 4, erro: "sem crédito ref=x", resultadoLlm: SEM_CREDITO_LLM });
    const r = await retomarPendentes({ agora: AGORA });
    expect(chamadas).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ tentadas: 1, falhas: 1, interrompida: true });
    expect(await dbT.mensagemBruta.count({ where: { status: "FALHA" } })).toBe(3);
  });

  it("no máximo `limite` mensagens por execução, mais antigas primeiro", async () => {
    const ms = [];
    for (let i = 0; i < 4; i++) ms.push(await bruta({ status: "RECEBIDA", texto: `#crm sem fixture ${i}` }));
    const r = await retomarPendentes({ agora: AGORA, limite: 3 });
    expect(r.tentadas).toBe(3);
    expect(await status(ms[3].id)).toBe("RECEBIDA");
  });

  it("prazo estourado → não começa a próxima", async () => {
    await bruta({ status: "RECEBIDA" });
    await bruta({ status: "RECEBIDA" });
    const r = await retomarPendentes({ agora: AGORA, prazo: new Date(0) });
    expect(r).toMatchObject({ tentadas: 0, interrompida: true });
  });
});

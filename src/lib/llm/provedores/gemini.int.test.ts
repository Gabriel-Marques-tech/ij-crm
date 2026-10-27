// @vitest-environment node
/**
 * Ponta a ponta com `LLM_PROVEDOR=gemini`: `processarMensagem` → camada de
 * LLM → SDK oficial `@google/genai` → fetch falso (sem chave real) → card no banco.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURES_EXTRACAO, RECEBIDA_EM } from "@/lib/llm/fixtures/extracao";
import { processarMensagem } from "@/lib/whatsapp/processar";
import { dbTeste, limparBanco } from "@/test/db";
import { semear } from "../../../../prisma/seed";

const dbT = dbTeste();
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
const F = FIXTURES_EXTRACAO.find((f) => f.esperado.status === "PROCESSADA")!;

function logs(spy: unknown): string {
  return (spy as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c.map(String).join(" ")).join("\n");
}

function http(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

async function mensagem() {
  const joao = await dbT.usuario.create({ data: { nome: "João", email: "joao@ij.test", telefoneWhatsapp: "+5511999998888" } });
  await dbT.usuario.create({ data: { nome: "Maria", email: "maria@ij.test" } });
  return dbT.mensagemBruta.create({
    data: {
      eventoId: "EVT-gemini",
      grupoJid: "120363000000000001@g.us",
      texto: F.texto,
      recebidaEm: RECEBIDA_EM,
      remetenteTelefone: "+5511999998888",
      remetenteUsuarioId: joao.id,
      status: "RECEBIDA",
    },
  });
}

beforeEach(async () => {
  await limparBanco(TABELAS);
  await semear(dbT, { log: () => {} });
  process.env.LLM_PROVEDOR = "gemini";
  process.env.GEMINI_API_KEY = "AIza-teste";
  delete process.env.OPENAI_API_KEY;
  delete process.env.LLM_EXTRACAO_MODELO;
  delete process.env.NOTIFICATIONS_ENABLED;
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.env = { ...envOriginal };
});

describe("LLM_PROVEDOR=gemini ponta a ponta (fetch falso)", () => {
  it("mensagem #crm vira card com a saída do Gemini 3.8 Flash; log com tokens de raciocínio e sem o texto", async () => {
    const fetch = vi.fn().mockResolvedValue(
      http({
        candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(F.saida) }] }, finishReason: "STOP", index: 0 }],
        usageMetadata: { promptTokenCount: 1500, candidatesTokenCount: 196, thoughtsTokenCount: 64, totalTokenCount: 1760 },
        modelVersion: "gemini-3.8-flash",
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const m = await mensagem();
    const r = await processarMensagem(m.id);
    expect(r).toMatchObject({ confirmacao: F.esperado.confirmacao });
    expect(String(fetch.mock.calls[0][0])).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
    const depois = await dbT.mensagemBruta.findUniqueOrThrow({ where: { id: m.id } });
    expect(depois.status).toBe("PROCESSADA");
    expect(depois.resultadoLlm).toMatchObject({ provedor: "gemini", modelo: "gemini-3.8-flash", saida: F.saida });
    expect(await dbT.oportunidade.count()).toBe(1);
    const l = logs(console.info);
    expect(l).toMatch(/provedor=gemini modelo=gemini-3\.8-flash .* tokens_in=1500 tokens_out=260 tokens_reasoning=64 ok/);
    expect(l).not.toContain(F.texto);
  });

  it("402 (crédito pré-pago esgotado) → FALHA 'sem crédito na API do Gemini' com ref, uma chamada só, sem a mensagem da API no log", async () => {
    const fetch = vi.fn().mockResolvedValue(http({ error: { code: 402, status: "PAYMENT_REQUIRED", message: "Your prepayment credits are depleted" } }, 402));
    vi.stubGlobal("fetch", fetch);
    const m = await mensagem();
    const r = await processarMensagem(m.id);
    expect(r).toMatchObject({ tipo: "FALHA", codigo: "LLM_SEM_CREDITO" });
    if (r.tipo !== "FALHA") throw new Error();
    expect(fetch).toHaveBeenCalledTimes(1);
    const d = await dbT.mensagemBruta.findUniqueOrThrow({ where: { id: m.id } });
    expect(d.status).toBe("FALHA");
    expect(d.erro).toContain("sem crédito na API do Gemini");
    expect(d.erro).toContain(`ref=${r.ref}`);
    const tudo = logs(console.error) + logs(console.info) + logs(console.warn) + (d.erro ?? "");
    expect(tudo).not.toContain("prepayment credits");
    expect(tudo).not.toContain(F.texto);
  });
});

// @vitest-environment node
/**
 * Ponta a ponta com `LLM_PROVEDOR=openai`: `processarMensagem` → camada de
 * LLM → SDK oficial da OpenAI → fetch falso (sem chave real) → card no banco.
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

function respostaOpenAI(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

async function mensagem() {
  const joao = await dbT.usuario.create({ data: { nome: "João", email: "joao@ij.test", telefoneWhatsapp: "+5511999998888" } });
  await dbT.usuario.create({ data: { nome: "Maria", email: "maria@ij.test" } });
  return dbT.mensagemBruta.create({
    data: {
      eventoId: "EVT-openai",
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
  process.env.LLM_PROVEDOR = "openai";
  process.env.OPENAI_API_KEY = "sk-teste";
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

describe("LLM_PROVEDOR=openai ponta a ponta (fetch falso)", () => {
  it("mensagem #crm vira card com a saída do GPT-6.1 Sol; log com tokens de raciocínio e sem o texto", async () => {
    const fetch = vi.fn().mockResolvedValue(
      respostaOpenAI({
        id: "resp_1",
        object: "response",
        model: "gpt-6.1-sol",
        status: "completed",
        incomplete_details: null,
        output: [{ id: "msg_1", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(F.saida), annotations: [] }] }],
        usage: { input_tokens: 1500, input_tokens_details: { cached_tokens: 0 }, output_tokens: 260, output_tokens_details: { reasoning_tokens: 64 }, total_tokens: 1760 },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const m = await mensagem();
    const r = await processarMensagem(m.id);
    expect(r).toMatchObject({ confirmacao: F.esperado.confirmacao });
    expect(String(fetch.mock.calls[0][0])).toBe("https://api.openai.com/v1/responses");
    const depois = await dbT.mensagemBruta.findUniqueOrThrow({ where: { id: m.id } });
    expect(depois.status).toBe("PROCESSADA");
    expect(depois.resultadoLlm).toMatchObject({ provedor: "openai", modelo: "gpt-6.1-sol", saida: F.saida });
    expect(await dbT.projeto.count()).toBe(1);
    const l = logs(console.info);
    expect(l).toMatch(/provedor=openai modelo=gpt-6\.1-sol .* tokens_in=1500 tokens_out=260 tokens_reasoning=64 ok/);
    expect(l).not.toContain(F.texto);
  });

  it("429 insufficient_quota → FALHA 'sem crédito na API da OpenAI' com ref, uma chamada só, sem a mensagem da API no log", async () => {
    const fetch = vi.fn().mockResolvedValue(
      respostaOpenAI({ error: { type: "insufficient_quota", code: "insufficient_quota", param: null, message: "You exceeded your current quota" } }, 429),
    );
    vi.stubGlobal("fetch", fetch);
    const m = await mensagem();
    const r = await processarMensagem(m.id);
    expect(r).toMatchObject({ tipo: "FALHA", codigo: "LLM_SEM_CREDITO" });
    if (r.tipo !== "FALHA") throw new Error();
    expect(fetch).toHaveBeenCalledTimes(1);
    const d = await dbT.mensagemBruta.findUniqueOrThrow({ where: { id: m.id } });
    expect(d.status).toBe("FALHA");
    expect(d.erro).toContain("sem crédito na API da OpenAI");
    expect(d.erro).toContain(`ref=${r.ref}`);
    const tudo = logs(console.error) + logs(console.info) + logs(console.warn) + (d.erro ?? "");
    expect(tudo).not.toContain("exceeded your current quota");
    expect(tudo).not.toContain(F.texto);
  });
});

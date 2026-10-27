// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extrairAtualizacao, provedorConfigurado } from "./extracao";
import { FIXTURES_EXTRACAO, RECEBIDA_EM } from "./fixtures/extracao";
import { definirRespostaMock } from "./provedores/mock";
import type { ContextoExtracao } from "./prompts/extracao.v1";

const CTX: ContextoExtracao = { remetente: "João", recebidaEm: RECEBIDA_EM, respondendoA: null, fases: [], contatos: [], empresas: [] };
const envOriginal = { ...process.env };

function logs(spy: unknown): string {
  return (spy as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c.map(String).join(" ")).join("\n");
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  definirRespostaMock(null);
  vi.restoreAllMocks();
  process.env = { ...envOriginal };
});

describe("provedor por env", () => {
  it("LLM_PROVEDOR=mock → mock; ausente → openai; anthropic segue selecionável", () => {
    process.env.LLM_PROVEDOR = "mock";
    expect(provedorConfigurado().nome).toBe("mock");
    delete process.env.LLM_PROVEDOR;
    delete process.env.LLM_EXTRACAO_MODELO;
    process.env.OPENAI_API_KEY = "sk-x";
    expect(provedorConfigurado().nome).toBe("openai");
    process.env.LLM_PROVEDOR = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-ant-x";
    expect(provedorConfigurado().nome).toBe("anthropic");
  });

  it("openai sem OPENAI_API_KEY → ErroLlm SEM_CHAVE (não quebra o processo)", async () => {
    process.env.LLM_PROVEDOR = "openai";
    delete process.env.OPENAI_API_KEY;
    await expect(extrairAtualizacao("#crm x", CTX)).rejects.toMatchObject({
      name: "ErroLlm",
      codigo: "SEM_CHAVE",
      message: expect.stringContaining("OPENAI_API_KEY ausente"),
    });
  });

  it("modelo de outro provedor no LLM_EXTRACAO_MODELO → PROVEDOR_INVALIDO com o motivo (em vez de 404 a cada mensagem)", () => {
    process.env.LLM_PROVEDOR = "openai";
    process.env.OPENAI_API_KEY = "sk-x";
    process.env.LLM_EXTRACAO_MODELO = "claude-haiku-5-5";
    expect(() => provedorConfigurado()).toThrow(
      expect.objectContaining({ codigo: "PROVEDOR_INVALIDO", message: expect.stringContaining("claude-haiku-5-5") }),
    );
    process.env.LLM_PROVEDOR = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-ant-x";
    process.env.LLM_EXTRACAO_MODELO = "gpt-6.1-sol";
    expect(() => provedorConfigurado()).toThrow(expect.objectContaining({ codigo: "PROVEDOR_INVALIDO" }));
  });

  it("anthropic sem ANTHROPIC_API_KEY → ErroLlm SEM_CHAVE (não quebra o processo)", async () => {
    process.env.LLM_PROVEDOR = "anthropic";
    delete process.env.ANTHROPIC_API_KEY;
    await expect(extrairAtualizacao("#crm x", CTX)).rejects.toMatchObject({ name: "ErroLlm", codigo: "SEM_CHAVE" });
  });

  it("mock em produção → PROVEDOR_INVALIDO com o motivo (a mensagem vai para FALHA)", () => {
    process.env.LLM_PROVEDOR = "mock";
    (process.env as Record<string, string>).NODE_ENV = "production";
    expect(() => provedorConfigurado()).toThrow(
      expect.objectContaining({ codigo: "PROVEDOR_INVALIDO", message: expect.stringContaining("não é permitido em produção") }),
    );
  });

  it("valor desconhecido → PROVEDOR_INVALIDO", () => {
    process.env.LLM_PROVEDOR = "gemini";
    expect(() => provedorConfigurado()).toThrow(expect.objectContaining({ codigo: "PROVEDOR_INVALIDO" }));
  });
});

describe("extrairAtualizacao (mock)", () => {
  beforeEach(() => {
    process.env.LLM_PROVEDOR = "mock";
  });

  it("fixture conhecida → saída validada, versão e uso; log sem o texto", async () => {
    const f = FIXTURES_EXTRACAO[0];
    const r = await extrairAtualizacao(f.texto, CTX, { ref: "m1" });
    expect(r.extracao).toEqual(f.saida);
    expect(r.versao).toBe("extracao.v1");
    expect(r.uso).toMatchObject({ provedor: "mock", modelo: "mock-extracao" });
    const l = logs(console.info);
    expect(l).toMatch(/\[llm\] extracao ref=m1 provedor=mock modelo=mock-extracao versao=extracao\.v1 ms=\d+ tokens_in=0 tokens_out=0 ok/);
    expect(l).not.toContain("Gustavo");
  });

  it("saída inválida → SAIDA_INVALIDA com o bruto anexado e só caminhos no log", async () => {
    definirRespostaMock(() => ({ ...FIXTURES_EXTRACAO[0].saida, confianca: "alta", contato: { nome: "Gustavo Segredo" } }));
    const e = await extrairAtualizacao("#crm x", CTX, { ref: "m2" }).catch((x) => x);
    expect(e).toMatchObject({ codigo: "SAIDA_INVALIDA" });
    expect(e.bruto).toMatchObject({ confianca: "alta" });
    expect(e.message).not.toContain("Segredo");
    expect(logs(console.info)).toMatch(/erro=SAIDA_INVALIDA campos=.*confianca/);
    expect(logs(console.info)).not.toContain("Segredo");
  });

  it("loga tokens de raciocínio quando o provedor informa", async () => {
    const provedor = {
      nome: "openai",
      extrair: async () => ({
        bruto: FIXTURES_EXTRACAO[0].saida,
        uso: { provedor: "openai", modelo: "gpt-6.1-sol", tokensEntrada: 1500, tokensSaida: 260, tokensRaciocinio: 64, ms: 900 },
      }),
    };
    await extrairAtualizacao("#crm x", CTX, { ref: "m3", provedor });
    expect(logs(console.info)).toMatch(
      /\[llm\] extracao ref=m3 provedor=openai modelo=gpt-6\.1-sol versao=extracao\.v1 ms=900 tokens_in=1500 tokens_out=260 tokens_reasoning=64 ok/,
    );
  });
});

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classificar, extrairAtualizacao, provedorConfigurado } from "./extracao";
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
  it("LLM_PROVEDOR=mock → mock; ausente → anthropic", () => {
    process.env.LLM_PROVEDOR = "mock";
    expect(provedorConfigurado().nome).toBe("mock");
    delete process.env.LLM_PROVEDOR;
    process.env.ANTHROPIC_API_KEY = "sk-ant-x";
    expect(provedorConfigurado().nome).toBe("anthropic");
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
    process.env.LLM_PROVEDOR = "openai";
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

  it("classificar é stub: tudo que chega é relevante", async () => {
    await expect(classificar("#crm qualquer")).resolves.toEqual({ relevante: true, confianca: 1 });
  });
});

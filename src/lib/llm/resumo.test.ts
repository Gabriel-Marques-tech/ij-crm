import { afterEach, describe, expect, it, vi } from "vitest";
import { registrarLogLlm } from "@/lib/logs/tecnicos";
import { definirResumoMock } from "./provedores/mock";
import { resumirJanela } from "./resumo";
import type { ProvedorLlm } from "./tipos";

vi.mock("@/lib/logs/tecnicos", () => ({ registrarLogLlm: vi.fn(async () => {}) }));

const ENTRADA = { vendedor: "João", mensagens: [{ em: new Date(0), texto: "fechou com a Alfa, tel 11 99999-8888", card: null }], cards: [] };

const envOriginal = { ...process.env };

afterEach(() => {
  process.env = { ...envOriginal };
  definirResumoMock(null);
  vi.restoreAllMocks();
});

describe("resumirJanela", () => {
  it("pede o schema estrito 'resumo', limpa contatos e loga uso sem texto", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    let pedido: unknown;
    const provedor: ProvedorLlm = {
      nome: "fake",
      async extrair(p) {
        pedido = p;
        return { bruto: { resumo: "Alfa fechou; ligar para 11 99999-8888" }, uso: { provedor: "openai", modelo: "gpt-6.1-sol", tokensEntrada: 10, tokensSaida: 5, ms: 7 } };
      },
    };
    const r = await resumirJanela(ENTRADA, { ref: "R1", provedor });
    expect(r).toMatchObject({ resumo: "Alfa fechou; ligar para [número]", versao: "resumo.v1" });
    expect(pedido).toMatchObject({ nome: "resumo", schema: { required: ["resumo"], additionalProperties: false } });
    const log = info.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(log).toContain("[llm] resumo ref=R1 provedor=openai modelo=gpt-6.1-sol versao=resumo.v1 ms=7 tokens_in=10 tokens_out=5 ok");
    expect(log).not.toMatch(/Alfa|9999/);
    expect(registrarLogLlm).toHaveBeenCalledWith(expect.objectContaining({ operacao: "resumo", status: "ok", ref: "R1", uso: expect.objectContaining({ tokensEntrada: 10 }) }));
  });

  it("saída fora do schema → ErroLlm SAIDA_INVALIDA; mock padrão responde", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    process.env.LLM_PROVEDOR = "mock";
    definirResumoMock(() => ({ outra: 1 }));
    await expect(resumirJanela(ENTRADA)).rejects.toMatchObject({ codigo: "SAIDA_INVALIDA" });
    definirResumoMock(null);
    expect((await resumirJanela(ENTRADA)).resumo).toBe("mock: resumo da janela anterior");
  });
});

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { classificar } from "./classificacao";
import { ErroLlm, type ProvedorLlm, type UsoLlm } from "./tipos";

const dbT = dbTeste();
const USO: UsoLlm = { provedor: "openai", modelo: "gpt-6.1-sol", tokensEntrada: 210, tokensSaida: 40, tokensRaciocinio: 24, ms: 640 };
const TEXTO = "Falei com a Carla da Acme, +55 11 98888-7777, carla@acme.test";

const provedor = (extrair: ProvedorLlm["extrair"]): ProvedorLlm => ({ nome: "teste", extrair });

beforeEach(async () => {
  await limparBanco(["log_llm"]);
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("classificar → log_llm (GAB-42)", () => {
  it("grava operação classificacao com modelo, tokens (incl. raciocínio), ms e status; nunca o texto", async () => {
    await classificar(TEXTO, { respondendoA: "Proposta da Acme" }, { ref: "msg1", provedor: provedor(async () => ({ bruto: { relevante: true, confianca: 0.9 }, uso: USO })) });
    const linhas = await dbT.logLlm.findMany();
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ operacao: "classificacao", provedor: "openai", modelo: "gpt-6.1-sol", tokensEntrada: 210, tokensSaida: 40, tokensRaciocinio: 24, ms: 640, status: "ok", ref: "msg1" });
    const tudo = JSON.stringify(linhas);
    for (const proibido of ["Carla", "Acme", "98888", "carla@", "Proposta"]) expect(tudo).not.toContain(proibido);
  });

  it("falha do provedor e saída inválida também viram linha (com o código)", async () => {
    await expect(
      classificar(TEXTO, { respondendoA: null }, { ref: "msg2", provedor: provedor(async () => Promise.reject(new ErroLlm("TIMEOUT", { uso: USO }))) }),
    ).rejects.toThrow();
    await expect(classificar(TEXTO, { respondendoA: null }, { ref: "msg3", provedor: provedor(async () => ({ bruto: { x: 1 }, uso: USO })) })).rejects.toThrow();
    const linhas = await dbT.logLlm.findMany({ orderBy: { id: "asc" } });
    expect(linhas.map((l) => [l.operacao, l.status, l.ref])).toEqual([
      ["classificacao", "TIMEOUT", "msg2"],
      ["classificacao", "SAIDA_INVALIDA", "msg3"],
    ]);
  });
});

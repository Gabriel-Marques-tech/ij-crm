import { describe, expect, it } from "vitest";
import { ErroLlm } from "./tipos";

describe("ErroLlm.detalhe é fechado (vai ao log e a mensagem_bruta.erro)", () => {
  it("frases fixas e campos tipados mantêm a mensagem de antes", () => {
    expect(new ErroLlm("SEM_CHAVE", { detalhe: "OPENAI_API_KEY ausente" }).message).toBe("LLM SEM_CHAVE (OPENAI_API_KEY ausente)");
    expect(new ErroLlm("SAIDA_INVALIDA", { detalhe: { campos: ["contato.email", "(raiz)"] } }).message).toBe("LLM SAIDA_INVALIDA (contato.email,(raiz))");
    expect(new ErroLlm("FALHA_PROVEDOR", { detalhe: { codigo: "status=failed" } }).message).toBe("LLM FALHA_PROVEDOR (status=failed)");
    expect(new ErroLlm("PROVEDOR_INVALIDO", { detalhe: { modelo: "gpt-6.1", provedor: "anthropic" } }).message).toBe(
      "LLM PROVEDOR_INVALIDO (LLM_EXTRACAO_MODELO=gpt-6.1 não é modelo do provedor anthropic)",
    );
  });

  it("identificador que não parece código vira '?' (texto livre não passa)", () => {
    const e = new ErroLlm("FALHA_PROVEDOR", { detalhe: { codigo: "falhou para ana@segredo.test" } });
    expect(e.message).toBe("LLM FALHA_PROVEDOR (?)");
    expect(new ErroLlm("SAIDA_INVALIDA", { detalhe: { campos: ["ok", "Olá mundo"] } }).message).toBe("LLM SAIDA_INVALIDA (ok,?)");
  });

  it("string livre não compila", () => {
    // @ts-expect-error detalhe não aceita texto arbitrário
    expect(new ErroLlm("HTTP", { detalhe: "qualquer texto" }).message).toContain("HTTP");
  });
});

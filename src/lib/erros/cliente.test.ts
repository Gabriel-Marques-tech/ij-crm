import { describe, expect, it } from "vitest";
import { FALHA_CONEXAO, executarAcao, falhaDe } from "./cliente";

describe("falhaDe", () => {
  it("sucesso → null", () => {
    expect(falhaDe({ ok: true }, "criar o card")).toBeNull();
    expect(falhaDe(undefined, "criar o card")).toBeNull();
  });

  it("erro de regra → mensagem específica, sem ref", () => {
    expect(falhaDe({ erro: "Informe um título." }, "criar o card")).toEqual({ texto: "Informe um título." });
  });

  it("INESPERADO → 'Não foi possível <ação>. Erro no servidor' + ref", () => {
    expect(falhaDe({ ok: false, erro: "INESPERADO", ref: "abc123de" }, "criar o card")).toEqual({
      texto: "Não foi possível criar o card. Erro no servidor.",
      ref: "abc123de",
    });
  });
});

describe("executarAcao", () => {
  it("action resolvida passa por falhaDe", async () => {
    expect(await executarAcao(async () => ({ ok: true as const }), "mover o card")).toBeNull();
    expect(await executarAcao(async () => ({ ok: false as const, erro: "INESPERADO", ref: "00ff00ff" }), "mover o card")).toEqual({
      texto: "Não foi possível mover o card. Erro no servidor.",
      ref: "00ff00ff",
    });
  });

  it("a chamada em si falhou no cliente (rede/servidor fora) → sem conexão", async () => {
    expect(
      await executarAcao(async () => {
        throw new TypeError("Failed to fetch");
      }, "mover o card"),
    ).toBe(FALHA_CONEXAO);
    expect(FALHA_CONEXAO.texto).toBe("Sem conexão com o servidor. Verifique a rede e tente de novo.");
  });
});

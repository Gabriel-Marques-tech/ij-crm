// @vitest-environment node
/** `pnpm llm:smoke` (scripts/smoke-llm.ts): 1 chamada por schema ao provedor configurado. */
import { describe, expect, it, vi } from "vitest";
import { FIXTURES_EXTRACAO } from "./fixtures/extracao";
import { MENSAGEM_SINTETICA, rodarSmokeLlm } from "./smoke";
import { ErroLlm, type PedidoExtracao, type ProvedorLlm } from "./tipos";

const USO = { provedor: "gemini", modelo: "gemini-3.8-flash", tokensEntrada: 900, tokensSaida: 120, tokensRaciocinio: 40, ms: 812 };

function provedorFalso(responder: (p: PedidoExtracao) => unknown): ProvedorLlm & { pedidos: PedidoExtracao[] } {
  const pedidos: PedidoExtracao[] = [];
  return {
    nome: "gemini",
    pedidos,
    async extrair(p) {
      pedidos.push(p);
      return { bruto: await responder(p), uso: USO };
    },
  };
}

const RESPOSTAS: Record<string, unknown> = {
  extracao: FIXTURES_EXTRACAO[0].saida,
  classificacao: { relevante: true, confianca: 0.9 },
  resumo: { resumo: "texto do modelo que não pode aparecer no log" },
};

describe("rodarSmokeLlm", () => {
  it("chama extração, classificação e resumo uma vez cada; imprime status, tokens e ms, nunca texto", async () => {
    const p = provedorFalso((pedido) => RESPOSTAS[pedido.nome ?? "extracao"]);
    const linhas: string[] = [];
    const ok = await rodarSmokeLlm({ provedor: () => p, log: (l) => linhas.push(l) });
    expect(ok).toBe(true);
    expect(p.pedidos.map((x) => x.nome ?? "extracao")).toEqual(["extracao", "classificacao", "resumo"]);
    const saida = linhas.join("\n");
    for (const op of ["extracao", "classificacao", "resumo"])
      expect(saida).toMatch(new RegExp(`${op} ok provedor=gemini modelo=gemini-3\\.8-flash ms=812 tokens_in=900 tokens_out=120 tokens_reasoning=40`));
    expect(saida).not.toContain("texto do modelo");
    expect(saida).not.toContain(MENSAGEM_SINTETICA);
    // A mensagem sintética não tem dado pessoal (nem telefone, nem email).
    expect(MENSAGEM_SINTETICA).not.toMatch(/\d{4,}|@/);
  });

  it("erro do provedor → linha FALHA só com código/status e retorno false (continua os outros)", async () => {
    const p = provedorFalso(() => {
      throw new ErroLlm("HTTP", { status: 400, detalhe: { codigo: "INVALID_ARGUMENT" } });
    });
    const linhas: string[] = [];
    expect(await rodarSmokeLlm({ provedor: () => p, log: (l) => linhas.push(l) })).toBe(false);
    expect(p.pedidos).toHaveLength(3);
    expect(linhas.join("\n")).toMatch(/extracao FALHA codigo=HTTP status=400 \(LLM HTTP HTTP 400 \(INVALID_ARGUMENT\)\)/);
  });

  it("saída fora do schema → FALHA SAIDA_INVALIDA com só os nomes dos campos", async () => {
    const p = provedorFalso((pedido) => (pedido.nome === "classificacao" ? { relevante: "sim, texto secreto" } : RESPOSTAS[pedido.nome ?? "extracao"]));
    const linhas: string[] = [];
    expect(await rodarSmokeLlm({ provedor: () => p, log: (l) => linhas.push(l) })).toBe(false);
    const saida = linhas.join("\n");
    expect(saida).toMatch(/classificacao FALHA codigo=SAIDA_INVALIDA campos=/);
    expect(saida).not.toContain("texto secreto");
  });

  it("sem chave / provedor inválido → FALHA na configuração, sem chamar nada", async () => {
    const linhas: string[] = [];
    const ok = await rodarSmokeLlm({
      provedor: () => {
        throw new ErroLlm("SEM_CHAVE", { detalhe: "GEMINI_API_KEY ausente" });
      },
      log: (l) => linhas.push(l),
    });
    expect(ok).toBe(false);
    expect(linhas.join("\n")).toContain("FALHA codigo=SEM_CHAVE");
    expect(linhas.join("\n")).toContain("GEMINI_API_KEY ausente");
  });

  it("erro que não é ErroLlm → só o nome da classe", async () => {
    const p = provedorFalso(() => {
      throw new Error("mensagem com texto qualquer");
    });
    const linhas: string[] = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await rodarSmokeLlm({ provedor: () => p, log: (l) => linhas.push(l) })).toBe(false);
    expect(linhas.join("\n")).toContain("FALHA codigo=Error");
    expect(linhas.join("\n")).not.toContain("texto qualquer");
  });
});

import { describe, expect, it } from "vitest";
import { RECEBIDA_EM, saida } from "@/lib/llm/fixtures/extracao";
import { MOTIVO_DATA_FORA_DO_TEXTO, MOTIVO_ORCAMENTO_FORA_DO_TEXTO, interpretarCamposExtracao } from "./comum";

const ex = (campos: Parameters<typeof saida>[0]["campos"]) => saida({ intencao: "ATUALIZAR", campos });

describe("interpretarCamposExtracao — dinheiro e data ancorados no texto da mensagem ATUAL (GAB-49)", () => {
  it("orçamento e data escritos na mensagem entram", () => {
    const motivos: string[] = [];
    const r = interpretarCamposExtracao(ex({ orcamento_previsto: "uns 15k", proxima_acao: "mandar proposta", proxima_acao_em: "sexta" }), RECEBIDA_EM, motivos, "#crm orçamento uns 15k, mando proposta sexta");
    expect(r.campos.orcamentoPrevisto).toBe("15000.00");
    expect(r.proximaAcaoEm).not.toBeNull();
    expect(motivos).toEqual([]);
  });

  it("valor escrito de outro jeito mas igual ('R$ 15.000' vs '15k') também entra", () => {
    const motivos: string[] = [];
    const r = interpretarCamposExtracao(ex({ orcamento_previsto: "15k" }), RECEBIDA_EM, motivos, "#crm orçamento de R$ 15.000");
    expect(r.campos.orcamentoPrevisto).toBe("15000.00");
    expect(motivos).toEqual([]);
  });

  it("orçamento/data que só estavam no histórico: campo descartado + revisar com motivo; texto livre da próxima ação fica", () => {
    const motivos: string[] = [];
    const r = interpretarCamposExtracao(ex({ orcamento_previsto: "uns 15k", proxima_acao: "mandar proposta", proxima_acao_em: "sexta" }), RECEBIDA_EM, motivos, "#crm ele topou, manda o case");
    expect(r.campos.orcamentoPrevisto).toBeUndefined();
    expect(r.campos.proximaAcaoEm).toBeUndefined();
    expect(r.proximaAcaoEm).toBeNull();
    expect(r.campos.proximaAcao).toBe("mandar proposta");
    expect(motivos).toEqual([MOTIVO_ORCAMENTO_FORA_DO_TEXTO, MOTIVO_DATA_FORA_DO_TEXTO]);
  });

  it("data com acento/caixa diferente ainda casa ('Terça que vem')", () => {
    const motivos: string[] = [];
    interpretarCamposExtracao(ex({ proxima_acao_em: "terca que vem" }), RECEBIDA_EM, motivos, "#crm reunião Terça que vem");
    expect(motivos).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { interpretarGanho, interpretarPerda } from "@/lib/projetos/terminal-regras";
import { dadosDoFechamento } from "./fechamento";

const GANHO = { tipoTerminal: "GANHO" as const };
const PERDIDO = { tipoTerminal: "PERDIDO" as const };

describe("dadosDoFechamento — ganho/perdido pelo WhatsApp nunca inventa dado", () => {
  it("ganho com valor como escrito → valor no formato que o gancho de ganho aceita", () => {
    const r = dadosDoFechamento(GANHO, { valor_fechado: "fechou em 15k", motivo_perda: null }, "#crm fechou em 15k!");
    expect(r).toEqual({ ok: true, dados: { valorFechado: "15.000,00" } });
    if (r.ok) expect(interpretarGanho(r.dados)).toEqual({ ok: true, valorFechado: "15000.00" });
  });

  it("ganho sem valor, ou valor ilegível → não move, motivo de revisão", () => {
    expect(dadosDoFechamento(GANHO, { valor_fechado: null, motivo_perda: null }, "#crm fechamos")).toEqual({
      ok: false,
      motivo: "venda ganha sem valor fechado na mensagem: mova pelo CRM",
    });
    expect(dadosDoFechamento(GANHO, { valor_fechado: "um bom valor", motivo_perda: null }, "#crm fechamos por um bom valor")).toMatchObject({ ok: false });
  });

  it("perda com motivo da lista → a chave dela; outro texto → 'outro' com o texto como detalhe", () => {
    expect(dadosDoFechamento(PERDIDO, { valor_fechado: null, motivo_perda: "Preço" }, "#crm perdemos por preço")).toEqual({ ok: true, dados: { motivo: "preco" } });
    expect(dadosDoFechamento(PERDIDO, { valor_fechado: null, motivo_perda: "sem resposta" }, "#crm o cliente desistiu, sem resposta")).toEqual({ ok: true, dados: { motivo: "sem_resposta" } });
    const r = dadosDoFechamento(PERDIDO, { valor_fechado: null, motivo_perda: "  achou caro\ne foi pro concorrente " }, "#crm perdeu: achou caro e foi pro concorrente");
    expect(r).toEqual({ ok: true, dados: { motivo: "outro", detalhe: "achou caro e foi pro concorrente" } });
    if (r.ok) expect(interpretarPerda(r.dados)).toEqual({ ok: true, motivoPerda: "Outro: achou caro e foi pro concorrente" });
  });

  it("detalhe longo é cortado no limite do diálogo (não estoura a regra)", () => {
    const r = dadosDoFechamento(PERDIDO, { valor_fechado: null, motivo_perda: "x".repeat(900) }, "#crm perdemos");
    expect(r.ok && interpretarPerda(r.dados).ok).toBe(true);
  });

  it("perda sem motivo → não move, motivo de revisão", () => {
    expect(dadosDoFechamento(PERDIDO, { valor_fechado: null, motivo_perda: "   " }, "#crm perdemos")).toEqual({
      ok: false,
      motivo: "venda perdida sem motivo na mensagem: mova pelo CRM",
    });
  });

  it("terminal sem tipo não pede dados", () => {
    expect(dadosDoFechamento({ tipoTerminal: null }, { valor_fechado: null, motivo_perda: null }, "#crm x")).toEqual({ ok: true, dados: {} });
  });

  it("detalhe de 300 emojis (600 unidades UTF-16) é cortado na mesma unidade que a regra mede", () => {
    const r = dadosDoFechamento(PERDIDO, { valor_fechado: null, motivo_perda: "😡".repeat(300) }, "#crm perdemos 😡");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(interpretarPerda(r.dados).ok).toBe(true);
      expect(r.dados.detalhe!.length).toBeLessThanOrEqual(500);
      expect(r.dados.detalhe).not.toMatch(/[\uD800-\uDBFF]$/); // não corta emoji ao meio
    }
  });
});

describe("dadosDoFechamento — o dado tem de estar no TEXTO da mensagem", () => {
  it("valor inventado pela LLM (não está no texto) → não move", () => {
    expect(dadosDoFechamento(GANHO, { valor_fechado: "18 mil", motivo_perda: null }, "#crm fechamos o Gustavo!")).toEqual({
      ok: false,
      motivo: "valor fechado não confere com a mensagem: mova pelo CRM",
    });
  });

  it("valor diferente do escrito (LLM errou a conta) → não move; igual em outro formato → move", () => {
    expect(dadosDoFechamento(GANHO, { valor_fechado: "20 mil", motivo_perda: null }, "#crm fechamos, 18 mil")).toMatchObject({ ok: false });
    expect(dadosDoFechamento(GANHO, { valor_fechado: "R$ 18.000", motivo_perda: null }, "#crm fechamos com o Gustavo por 18k, 12 pessoas")).toEqual({
      ok: true,
      dados: { valorFechado: "18.000,00" },
    });
  });

  it("perda sem sinal de perda no texto (motivo inventado) → não move", () => {
    expect(dadosDoFechamento(PERDIDO, { valor_fechado: null, motivo_perda: "preço" }, "#crm falei com o Gustavo hoje")).toEqual({
      ok: false,
      motivo: "perda não confirmada pela mensagem: mova pelo CRM",
    });
  });

  it("sinais de perda normalizados: perdemos/perdeu/não fechou/desistiu, ou o próprio motivo", () => {
    for (const texto of ["#crm PERDEMOS o Gustavo", "#crm o Gustavo perdeu o interesse", "#crm nao fechou com a gente", "#crm ele desistiu", "#crm foi pro concorrente"]) {
      expect(dadosDoFechamento(PERDIDO, { valor_fechado: null, motivo_perda: "foi pro concorrente" }, texto).ok, texto).toBe(true);
    }
  });
});

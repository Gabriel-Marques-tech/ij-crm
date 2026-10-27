import { describe, expect, it } from "vitest";
import { interpretarGanho, interpretarPerda } from "@/lib/oportunidades/terminal-regras";
import { dadosDoFechamento } from "./fechamento";

const GANHO = { tipoTerminal: "GANHO" as const };
const PERDIDO = { tipoTerminal: "PERDIDO" as const };

describe("dadosDoFechamento — ganho/perdido pelo WhatsApp nunca inventa dado", () => {
  it("ganho com valor como escrito → valor no formato que o gancho de ganho aceita", () => {
    const r = dadosDoFechamento(GANHO, { valor_fechado: "fechou em 15k", motivo_perda: null });
    expect(r).toEqual({ ok: true, dados: { valorFechado: "15.000,00" } });
    if (r.ok) expect(interpretarGanho(r.dados)).toEqual({ ok: true, valorFechado: "15000.00" });
  });

  it("ganho sem valor, ou valor ilegível → não move, motivo de revisão", () => {
    expect(dadosDoFechamento(GANHO, { valor_fechado: null, motivo_perda: null })).toEqual({
      ok: false,
      motivo: "venda ganha sem valor fechado na mensagem: mova pelo CRM",
    });
    expect(dadosDoFechamento(GANHO, { valor_fechado: "um bom valor", motivo_perda: null })).toMatchObject({ ok: false });
  });

  it("perda com motivo da lista → a chave dela; outro texto → 'outro' com o texto como detalhe", () => {
    expect(dadosDoFechamento(PERDIDO, { valor_fechado: null, motivo_perda: "Preço" })).toEqual({ ok: true, dados: { motivo: "preco" } });
    expect(dadosDoFechamento(PERDIDO, { valor_fechado: null, motivo_perda: "sem resposta" })).toEqual({ ok: true, dados: { motivo: "sem_resposta" } });
    const r = dadosDoFechamento(PERDIDO, { valor_fechado: null, motivo_perda: "  achou caro\ne foi pro concorrente " });
    expect(r).toEqual({ ok: true, dados: { motivo: "outro", detalhe: "achou caro e foi pro concorrente" } });
    if (r.ok) expect(interpretarPerda(r.dados)).toEqual({ ok: true, motivoPerda: "Outro: achou caro e foi pro concorrente" });
  });

  it("detalhe longo é cortado no limite do diálogo (não estoura a regra)", () => {
    const r = dadosDoFechamento(PERDIDO, { valor_fechado: null, motivo_perda: "x".repeat(900) });
    expect(r.ok && interpretarPerda(r.dados).ok).toBe(true);
  });

  it("perda sem motivo → não move, motivo de revisão", () => {
    expect(dadosDoFechamento(PERDIDO, { valor_fechado: null, motivo_perda: "   " })).toEqual({
      ok: false,
      motivo: "venda perdida sem motivo na mensagem: mova pelo CRM",
    });
  });

  it("terminal sem tipo não pede dados", () => {
    expect(dadosDoFechamento({ tipoTerminal: null }, { valor_fechado: null, motivo_perda: null })).toEqual({ ok: true, dados: {} });
  });
});

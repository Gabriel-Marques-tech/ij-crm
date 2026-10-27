import { describe, expect, it } from "vitest";
import { textoCriado, textoCriadoSemTag, textoFalha, textoPendente } from "./confirmacao";

const BASE = {
  titulo: "Gustavo — Economia Sensata",
  faseNome: "Primeiro Contato",
  responsavelNome: "João",
  proximaAcao: "mandar proposta",
  proximaAcaoEm: "2025-10-31",
  revisar: false,
  motivosRevisar: [],
};

describe("confirmação no grupo", () => {
  it("formato do ticket", () => {
    expect(textoCriado(BASE)).toBe("✅ Gustavo — Economia Sensata → Primeiro Contato. Resp: João. Próx.: mandar proposta (31/10)");
  });

  it("sem próxima ação; só data; revisar com o primeiro motivo em 2ª linha", () => {
    expect(textoCriado({ ...BASE, proximaAcao: null, proximaAcaoEm: null })).toBe("✅ Gustavo — Economia Sensata → Primeiro Contato. Resp: João.");
    expect(textoCriado({ ...BASE, proximaAcao: null })).toBe("✅ Gustavo — Economia Sensata → Primeiro Contato. Resp: João. Próx.: 31/10");
    const r = textoCriado({ ...BASE, revisar: true, motivosRevisar: ["já existe empresa com esse nome", "confiança baixa da leitura"] });
    expect(r).toBe("⚠️ Gustavo — Economia Sensata → Primeiro Contato. Resp: João. Próx.: mandar proposta (31/10)\nMarquei para revisar: já existe empresa com esse nome.");
  });

  it("1 a 3 linhas, emoji de status primeiro", () => {
    const textos = [
      textoCriado(BASE),
      textoCriado({ ...BASE, revisar: true, motivosRevisar: ["x"] }),
      textoPendente("SEM_NOME"),
      textoPendente("ATUALIZAR"),
      textoFalha("ab12cd34"),
    ];
    for (const t of textos) {
      expect(t.split("\n").length).toBeLessThanOrEqual(3);
      expect(t).toMatch(/^(✅|⚠️|❌) /u);
    }
    expect(textoFalha("ab12cd34")).toBe("❌ não consegui processar, veja no CRM (ref: ab12cd34)");
  });

  it("texto vindo da LLM é achatado (sem quebras) e cortado: continua 1–3 linhas", () => {
    const longo = "x".repeat(500);
    const r = textoCriado({
      ...BASE,
      titulo: "Gustavo\n\n\nlinha extra — Eco\r\nnomia",
      proximaAcao: `mandar\nproposta ${longo}`,
      revisar: true,
      motivosRevisar: [`motivo\ncom\nquebras ${longo}`],
    });
    const linhas = r.split("\n");
    expect(linhas.length).toBeLessThanOrEqual(3);
    expect(linhas[0]).toMatch(/^⚠️ Gustavo linha extra — Eco nomia → /u);
    expect(r).toContain("…");
    expect(r).not.toContain("x".repeat(100));
    for (const l of linhas) expect(l.length).toBeLessThan(300);
  });

  it("reprocessada depois de um ❌: avisa no começo, emoji primeiro", () => {
    expect(textoCriado(BASE, { reprocessada: true })).toBe(
      "✅ Reprocessada: Gustavo — Economia Sensata → Primeiro Contato. Resp: João. Próx.: mandar proposta (31/10)",
    );
    expect(textoCriado({ ...BASE, revisar: true, motivosRevisar: ["x"] }, { reprocessada: true })).toMatch(/^⚠️ Reprocessada: Gustavo/u);
    expect(textoPendente("SEM_NOME", { reprocessada: true })).toBe("⚠️ Reprocessada: não identifiquei o lead — responde esta mensagem com o nome");
  });

  it("sem #crm (GAB-39): ↪️ deixa claro que não houve tag; revisar e reprocessada continuam", () => {
    expect(textoCriadoSemTag(BASE)).toBe(
      "↪️ entendi como atualização: Gustavo — Economia Sensata → Primeiro Contato. Resp: João. Próx.: mandar proposta (31/10)",
    );
    expect(textoCriadoSemTag({ ...BASE, revisar: true, motivosRevisar: ["x"] })).toMatch(/^↪️ entendi como atualização: Gustavo .*\nMarquei para revisar: x\.$/);
    expect(textoCriadoSemTag(BASE, { reprocessada: true })).toMatch(/^↪️ Reprocessada: entendi como atualização: Gustavo/);
    expect(textoCriadoSemTag(BASE)).not.toBe(textoCriado(BASE));
    expect(textoPendente("SEM_TAG_INCERTO")).toMatch(/^⚠️ .*sem #crm.*fila de revisão/);
    expect(textoPendente("SEM_TAG_SEM_IDENTIFICADOR")).toMatch(/^⚠️ .*sem #crm.*telefone, email ou CNPJ/);
  });
});

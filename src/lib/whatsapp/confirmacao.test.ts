import { describe, expect, it } from "vitest";
import { textoCriado, textoFalha, textoPendente } from "./confirmacao";

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
});

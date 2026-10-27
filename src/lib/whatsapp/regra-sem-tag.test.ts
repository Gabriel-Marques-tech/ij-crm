import { describe, expect, it } from "vitest";
import { regraSemTag } from "./regra-sem-tag";

const LIMIAR = 0.85;
const COM_ID = "fechei com a Alfa, contato carla@alfa.com.br";
const SEM_ID = "fechei com a Alfa";

describe("regraSemTag", () => {
  it("com #crm nunca interfere", () => {
    expect(regraSemTag(false, { intencao: "IGNORAR", confianca: 0.1 }, SEM_ID, LIMIAR)).toBeNull();
  });

  it("IGNORAR só apaga com confiança ≥ limiar; abaixo vai para revisão", () => {
    expect(regraSemTag(true, { intencao: "IGNORAR", confianca: 0.9 }, SEM_ID, LIMIAR)).toBe("DESCARTAR");
    expect(regraSemTag(true, { intencao: "IGNORAR", confianca: 0.85 }, SEM_ID, LIMIAR)).toBe("DESCARTAR");
    expect(regraSemTag(true, { intencao: "IGNORAR", confianca: 0.6 }, SEM_ID, LIMIAR)).toBe("INCERTO");
  });

  it("confiança abaixo do limiar → INCERTO", () => {
    expect(regraSemTag(true, { intencao: "CRIAR", confianca: 0.8 }, COM_ID, LIMIAR)).toBe("INCERTO");
  });

  it("CRIAR sem telefone/email/CNPJ citado → SEM_IDENTIFICADOR, mesmo com confiança 1.0 (injeção)", () => {
    expect(regraSemTag(true, { intencao: "CRIAR", confianca: 1 }, SEM_ID, LIMIAR)).toBe("SEM_IDENTIFICADOR");
    expect(regraSemTag(true, { intencao: "CRIAR", confianca: 1 }, COM_ID, LIMIAR)).toBeNull();
    expect(regraSemTag(true, { intencao: "CRIAR", confianca: 1 }, "Alfa 11 98765-4321", LIMIAR)).toBeNull();
    expect(regraSemTag(true, { intencao: "CRIAR", confianca: 1 }, "Alfa 12.345.678/0001-95", LIMIAR)).toBeNull();
  });

  it("ATUALIZAR confiante segue as regras de alvo do fluxo normal (não exige identificador)", () => {
    expect(regraSemTag(true, { intencao: "ATUALIZAR", confianca: 0.95 }, SEM_ID, LIMIAR)).toBeNull();
  });
});

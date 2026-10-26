import { describe, expect, it } from "vitest";
import { confirmacaoConfere, mensagemLixeira, podeApagarDeVez, podeMesclar, podeRestaurar, validarMerge } from "./regras";

const vivo = (id: string, extra: Partial<{ deletadoEm: Date | null; mergedIntoId: string | null }> = {}) => ({ id, deletadoEm: null, mergedIntoId: null, ...extra });

describe("permissões (matriz §4.5)", () => {
  it("restaurar e mesclar: gestor e admin; apagar de vez: só admin", () => {
    expect([podeRestaurar("VENDEDOR"), podeRestaurar("GESTOR"), podeRestaurar("ADMIN")]).toEqual([false, true, true]);
    expect([podeMesclar("VENDEDOR"), podeMesclar("GESTOR"), podeMesclar("ADMIN")]).toEqual([false, true, true]);
    expect([podeApagarDeVez("VENDEDOR"), podeApagarDeVez("GESTOR"), podeApagarDeVez("ADMIN")]).toEqual([false, false, true]);
  });
});

describe("validarMerge", () => {
  it("dois registros vivos, perdedor sem mesclados → ok", () => {
    expect(validarMerge({ principal: vivo("a"), perdedor: vivo("b"), mescladosNoPerdedor: 0 })).toBeNull();
  });

  it("mesmo registro, ausente, excluído ou já mesclado → erro específico", () => {
    expect(validarMerge({ principal: vivo("a"), perdedor: vivo("a"), mescladosNoPerdedor: 0 })).toBe("MESMO_REGISTRO");
    expect(validarMerge({ principal: null, perdedor: vivo("b"), mescladosNoPerdedor: 0 })).toBe("PRINCIPAL_INVALIDO");
    expect(validarMerge({ principal: vivo("a", { deletadoEm: new Date() }), perdedor: vivo("b"), mescladosNoPerdedor: 0 })).toBe("PRINCIPAL_INVALIDO");
    expect(validarMerge({ principal: vivo("a", { mergedIntoId: "z" }), perdedor: vivo("b"), mescladosNoPerdedor: 0 })).toBe("PRINCIPAL_INVALIDO");
    expect(validarMerge({ principal: vivo("a"), perdedor: null, mescladosNoPerdedor: 0 })).toBe("PERDEDOR_INVALIDO");
    expect(validarMerge({ principal: vivo("a"), perdedor: vivo("b", { deletadoEm: new Date() }), mescladosNoPerdedor: 0 })).toBe("PERDEDOR_INVALIDO");
    expect(validarMerge({ principal: vivo("a"), perdedor: vivo("b", { mergedIntoId: "a" }), mescladosNoPerdedor: 0 })).toBe("PERDEDOR_INVALIDO");
  });

  it("perdedor que já é principal de outros → recusa (merge tem 1 nível; evita cadeia e ciclo)", () => {
    expect(validarMerge({ principal: vivo("a"), perdedor: vivo("b"), mescladosNoPerdedor: 1 })).toBe("PERDEDOR_TEM_MESCLADOS");
  });
});

describe("confirmacaoConfere", () => {
  it("exige o título exato (espaços nas pontas e repetidos não contam)", () => {
    expect(confirmacaoConfere("  Acme   Ltda ", "Acme Ltda")).toBe(true);
    expect(confirmacaoConfere("acme ltda", "Acme Ltda")).toBe(false);
    expect(confirmacaoConfere("", "Acme Ltda")).toBe(false);
    expect(confirmacaoConfere("Acme", "Acme Ltda")).toBe(false);
  });
});

describe("mensagemLixeira", () => {
  it("fase arquivada cita a fase e pede para escolher", () => {
    expect(mensagemLixeira({ erro: "FASE_ARQUIVADA_ESCOLHA", fase: { id: "f", nome: "Proposta" } })).toMatch(/Proposta.*arquivada.*Escolha/);
  });
  it("todo erro tem texto em português", () => {
    expect(mensagemLixeira({ erro: "SEM_PERMISSAO" })).toMatch(/permissão/);
    expect(mensagemLixeira({ erro: "PERDEDOR_TEM_MESCLADOS" })).toMatch(/desfaça/i);
  });
});

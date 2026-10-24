import { describe, expect, it } from "vitest";
import { Limitador } from "./limitador";

describe("Limitador de tentativas", () => {
  it("bloqueia a chave depois de N falhas dentro da janela e libera após a janela", () => {
    const l = new Limitador({ maxFalhas: 3, janelaMs: 60_000 });
    const t0 = 1_000_000;
    expect(l.bloqueado("a", t0)).toBe(false);
    l.registrarFalha("a", t0);
    l.registrarFalha("a", t0 + 1);
    expect(l.bloqueado("a", t0 + 2)).toBe(false);
    l.registrarFalha("a", t0 + 3);
    expect(l.bloqueado("a", t0 + 4)).toBe(true);
    expect(l.bloqueado("b", t0 + 4)).toBe(false);
    expect(l.bloqueado("a", t0 + 60_001)).toBe(false);
  });

  it("sucesso zera o contador", () => {
    const l = new Limitador({ maxFalhas: 2, janelaMs: 60_000 });
    l.registrarFalha("a", 0);
    l.registrarSucesso("a");
    l.registrarFalha("a", 1);
    expect(l.bloqueado("a", 2)).toBe(false);
  });
});

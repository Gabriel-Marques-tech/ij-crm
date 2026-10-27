import { describe, expect, it } from "vitest";
import { FreioEsqueci, Limitador } from "./limitador";

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

describe("Limitador — memória limitada", () => {
  it("chaves expiradas são varridas mesmo sem serem consultadas de novo", () => {
    const l = new Limitador({ maxFalhas: 3, janelaMs: 1_000 });
    for (let i = 0; i < 100; i++) l.registrarFalha(`lixo-${i}`, 0);
    expect(l.tamanho).toBe(100);
    l.registrarFalha("nova", 5_000);
    expect(l.tamanho).toBe(1);
  });

  it("teto de chaves: acima dele as mais antigas saem", () => {
    const l = new Limitador({ maxFalhas: 3, janelaMs: 60_000, maxChaves: 50 });
    for (let i = 0; i < 500; i++) l.registrarFalha(`k-${i}`, i);
    expect(l.tamanho).toBe(50);
    expect(l.bloqueado("k-499", 600)).toBe(false);
    // A mais recente continua contando; a mais antiga foi descartada.
    l.registrarFalha("k-499", 601);
    l.registrarFalha("k-499", 602);
    expect(l.bloqueado("k-499", 603)).toBe(true);
  });

  it("padrão do teto é 10 mil chaves", () => {
    const l = new Limitador({ maxFalhas: 3, janelaMs: 60_000 });
    for (let i = 0; i < 10_500; i++) l.registrarFalha(`k-${i}`, 0);
    expect(l.tamanho).toBe(10_000);
  });
});

describe("FreioEsqueci (por IP + por IP+email)", () => {
  const novo = () =>
    new FreioEsqueci(new Limitador({ maxFalhas: 10, janelaMs: 15 * 60_000 }), new Limitador({ maxFalhas: 3, janelaMs: 60 * 60_000 }));

  it("3 pedidos do mesmo IP para o mesmo email; o 4º é freado", () => {
    const f = novo();
    expect([1, 2, 3, 4].map((t) => f.tentar("6.6.6.6", "vitima@ij.test", t))).toEqual([true, true, true, false]);
  });

  it("atacante esgotando o limite da vítima a partir do IP dele NÃO bloqueia a vítima em outro IP", () => {
    const f = novo();
    for (let t = 0; t < 5; t++) f.tentar("6.6.6.6", "vitima@ij.test", t);
    expect(f.tentar("6.6.6.6", "vitima@ij.test", 10)).toBe(false);
    expect(f.tentar("200.1.1.1", "vitima@ij.test", 11)).toBe(true);
  });

  it("o freio por IP segura muitos emails diferentes do mesmo IP", () => {
    const f = novo();
    const r = Array.from({ length: 12 }, (_, i) => f.tentar("6.6.6.6", `e${i}@ij.test`, i));
    expect(r.filter(Boolean)).toHaveLength(10);
  });
});

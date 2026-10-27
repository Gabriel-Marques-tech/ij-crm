import { describe, expect, it } from "vitest";
import { cortarTexto } from "./texto";

describe("cortarTexto", () => {
  it("curto passa inteiro, sem marca de corte", () => {
    expect(cortarTexto("abc", 5)).toEqual({ texto: "abc", truncado: false });
    expect(cortarTexto("abcde", 5)).toEqual({ texto: "abcde", truncado: false });
  });

  it("longo é cortado em `max` e marcado", () => {
    expect(cortarTexto("abcdef", 5)).toEqual({ texto: "abcde", truncado: true });
  });

  it("não parte emoji (par substituto) no ponto de corte", () => {
    // "abcd" + 😀 (2 unidades UTF-16): cortar em 5 partiria o emoji ao meio.
    const r = cortarTexto("abcd😀ef", 5);
    expect(r).toEqual({ texto: "abcd", truncado: true });
    expect(r.texto).not.toMatch(/[\uD800-\uDFFF]/);
    expect(cortarTexto("abcd😀ef", 6)).toEqual({ texto: "abcd😀", truncado: true });
  });

  it("o resultado nunca passa de `max` unidades (o limite do zod conta .length)", () => {
    const r = cortarTexto("😀".repeat(10), 7);
    expect(r.texto.length).toBeLessThanOrEqual(7);
    expect(r.texto).toBe("😀😀😀");
  });
});

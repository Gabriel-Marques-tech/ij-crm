import { describe, expect, it } from "vitest";
import { ruidoObvio } from "./ruido";

describe("ruidoObvio (não chama a LLM)", () => {
  it.each([
    ["👍👍👍", true],
    ["  🎉 ", true],
    ["!!! ??? ...", true],
    ["", true],
    // Curtas mas com letra/dígito: podem ser venda, vão ao classificador.
    ["fechou!", false],
    ["perdeu", false],
    ["fechado", false],
    ["ok", false],
    ["20k", false],
  ])("%j → %s", (texto, esperado) => {
    expect(ruidoObvio(texto)).toBe(esperado);
  });
});

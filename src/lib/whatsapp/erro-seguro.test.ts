import { describe, expect, it } from "vitest";
import { descreverErro } from "@/lib/erros/registrar";
import { ErroLlm } from "@/lib/llm/tipos";
import { erroSeguro } from "./erro-seguro";

describe("erroSeguro", () => {
  it("erro qualquer perde a mensagem (pode ter o texto da mensagem) e mantém o nome", () => {
    const e = new TypeError("falhou com 'fechei com a Padaria Segredo'");
    const d = descreverErro(erroSeguro(e));
    expect(d).toContain("TypeError: (mensagem omitida)");
    expect(d).not.toContain("Padaria");
  });

  it("ErroLlm passa intacto (mensagem só de código)", () => {
    const e = new ErroLlm("TIMEOUT");
    expect(erroSeguro(e)).toBe(e);
  });
});

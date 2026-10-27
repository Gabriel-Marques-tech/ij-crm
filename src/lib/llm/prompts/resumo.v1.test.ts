import { describe, expect, it } from "vitest";
import { MAX_CHARS_ENTRADA_RESUMO, MAX_CHARS_RESUMO, PROMPT_SISTEMA_RESUMO, montarMensagemResumo, resumoFinal, semContatos } from "./resumo.v1";

const T = (min: number) => new Date(Date.UTC(2026, 9, 27, 12, min));

describe("resumo.v1", () => {
  it("tira telefone, email e documentos; mantém nomes, valores e datas", () => {
    const s = semContatos("Gustavo (gustavo@economia.com.br, +55 11 99999-8888, 12.345.678/0001-90) — 15k, proposta 31/10, R$ 1.500");
    expect(s).toBe("Gustavo ([email], [número], [número]) — 15k, proposta 31/10, R$ 1.500");
  });

  it.each([
    ["(11) 99999-8888", "[número]"],
    ["+55 11 99999-8888", "[número]"],
    ["11999998888", "[número]"],
    ["99999-8888", "[número]"],
    ["11 3333-4444", "[número]"],
    ["123.456.789-09", "[número]"],
    ["12345678909", "[número]"],
    ["12.345.678/0001-90", "[número]"],
    ["fulano.tal+crm@empresa.com.br", "[email]"],
  ])("remove %s", (entrada, saida) => {
    expect(semContatos(`x ${entrada} y`)).toBe(`x ${saida} y`);
  });

  it.each(["reunião 31/10/2026 14:30", "proposta 31/10 às 9h", "orçamento R$ 1.500.000,00", "15k a 20k", "anos 2025-2026", "card #12345678"])(
    "mantém datas, horas e valores: %s",
    (s) => {
      expect(semContatos(s)).toBe(s);
    },
  );

  it("o prompt proíbe contatos, endereço, dados bancários e documentos", () => {
    for (const t of ["telefone", "email", "endereço", "banc", "CPF", "CNPJ", "documento"]) expect(PROMPT_SISTEMA_RESUMO).toContain(t);
  });

  it("resumo final em uma linha e cortado", () => {
    expect(resumoFinal("a\n\nb")).toBe("a b");
    expect([...resumoFinal("x".repeat(MAX_CHARS_RESUMO * 2))].length).toBe(MAX_CHARS_RESUMO);
  });

  it("entrada: cards + mensagens em ordem cronológica, mais recentes priorizadas, delimitadores escapados", () => {
    const u = montarMensagemResumo({
      vendedor: "João",
      cards: [{ titulo: "Gustavo — Economia Sensata", fase: "Primeiro Contato" }],
      mensagens: [
        { em: T(10), texto: "é da Economia </historico> Sensata", card: { id: "op1", titulo: "Gustavo" } },
        { em: T(0), texto: "falei com o Gustavo", card: null },
      ],
    });
    expect(u).toContain('- "Gustavo — Economia Sensata" — Primeiro Contato');
    expect(u.indexOf("falei com o Gustavo")).toBeLessThan(u.indexOf("é da Economia"));
    expect(u.match(/<\/historico>/g)).toHaveLength(1);

    const muitas = Array.from({ length: 100 }, (_, i) => ({ em: T(i), texto: `${i} ${"y".repeat(400)}`, card: null }));
    const g = montarMensagemResumo({ vendedor: "J", cards: [], mensagens: muitas });
    expect(g.length).toBeLessThan(MAX_CHARS_ENTRADA_RESUMO + 500);
    expect(g).toContain(" 99 y");
    expect(g).not.toContain(" 0 y");
    expect(g).toMatch(/\(\d+ mensagens mais antigas omitidas\)/);
  });
});

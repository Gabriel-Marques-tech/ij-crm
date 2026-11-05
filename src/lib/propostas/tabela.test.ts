import { describe, expect, it } from "vitest";
import { markdownParaDocumento } from "./markdown";
import type { Tabela } from "./documento";
import { CELULA_MAX, largurasDaTabela, medirTabela, motivoForaDoLimite, TABELA_COLUNAS_MAX, TABELA_LINHAS_MAX } from "./tabela";

const tabela = (md: string) => markdownParaDocumento(md).content[0] as Tabela;

describe("largurasDaTabela", () => {
  it("somam 1, com a coluna de texto longo mais larga que a de número", () => {
    const l = largurasDaTabela(tabela("| Premissa | Valor |\n| --- | --- |\n| Tempo para acompanhar um pedido do começo ao fim | 2 |"));
    expect(l[0] + l[1]).toBeCloseTo(1);
    expect(l[0]).toBeGreaterThan(l[1]);
  });

  it("colunas vazias dividem igual, e nenhuma fica abaixo do piso", () => {
    expect(largurasDaTabela(tabela("|  |  |\n| --- | --- |"))).toEqual([0.5, 0.5]);
    const l = largurasDaTabela(tabela(`| ${"x".repeat(500)} | a | b | c |\n| --- | --- | --- | --- |`));
    for (const f of l) expect(f).toBeGreaterThanOrEqual(0.5 / 4);
    expect(l.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it("texto muito longo não toma a tabela: o valor em reais continua cabendo com 8 colunas", () => {
    const longo = "y".repeat(90);
    const l = largurasDaTabela(tabela(`| ${longo} | a | a | ${longo} | a | a | a | a |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| b | 17.000,00 | 17.000,00 | c | 17.000,00 | 17.000,00 | 17.000,00 | 17.000,00 |`));
    // 455 pt úteis menos 10 de respiro; "17.000,00" em negrito 9,5 pt mede cerca de 42 pt.
    expect(l[1] * 455 - 10).toBeGreaterThan(42.3);
  });
});

describe("limites", () => {
  it("cada limite tem o seu motivo; no limite passa", () => {
    expect(motivoForaDoLimite({ linhas: TABELA_LINHAS_MAX, colunas: TABELA_COLUNAS_MAX, maiorCelula: CELULA_MAX })).toBeNull();
    expect(motivoForaDoLimite({ linhas: TABELA_LINHAS_MAX + 1, colunas: 1, maiorCelula: 0 })).toContain("linhas");
    expect(motivoForaDoLimite({ linhas: 1, colunas: TABELA_COLUNAS_MAX + 1, maiorCelula: 0 })).toContain("colunas");
    expect(motivoForaDoLimite({ linhas: 1, colunas: 1, maiorCelula: CELULA_MAX + 1 })).toContain("caracteres");
  });

  it("mede pelo texto, sem contar as marcas do Markdown", () => {
    expect(medirTabela(tabela("| **abc** | d |\n| --- | --- |\n| e |  |"))).toEqual({ linhas: 2, colunas: 2, maiorCelula: 3 });
  });
});

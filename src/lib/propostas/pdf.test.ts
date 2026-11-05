import { describe, expect, it } from "vitest";
import type { BlocoPdf } from "@/lib/pdf/tipos";
import { avisosDosDados } from "./blocos-dados";
import { ESTRUTURADO_VAZIO } from "./estruturado";
import { documentoPdfDaProposta, ENDERECO_IJ, formatarReais, nomeArquivoPdf } from "./pdf";

const base = {
  projeto: "Site da Padaria",
  empresa: "Padaria São João",
  numero: 3,
  data: new Date("2026-11-03T15:00:00Z"),
  markdown: "## Escopo\n\nSite com **5 páginas** e *blog*.\n\n- Home\n- Contato\n  - formulário\n\n1. Fase um\n2. Fase dois\n\n---\n\nFim.",
  estruturado: {
    valor: "12500.00",
    prazoDias: 60,
    escopoResumo: "Site institucional",
    entregas: [
      { titulo: "Protótipo", dia: "2026-12-01", duracao: null, valor: "5000.00" },
      { titulo: "Site no ar", dia: "2027-01-15", duracao: null, valor: null },
    ],
  },
};

describe("documentoPdfDaProposta", () => {
  it("capa, texto e os blocos móveis; proposta antiga, sem bloco posicionado, sai com os dois no fim", () => {
    const d = documentoPdfDaProposta(base);
    expect(d.titulo).toBe("Proposta Comercial de Projeto");
    expect(d.capa).toEqual({ titulo: "PROPOSTA COMERCIAL", empresa: "Padaria São João", data: "São Paulo, 3 de novembro de 2026", endereco: ENDERECO_IJ });
    expect(d.blocos).toContainEqual({ tipo: "titulo", nivel: 2, trechos: [{ texto: "Escopo" }] });
    expect(d.blocos).toContainEqual({
      tipo: "paragrafo",
      trechos: [{ texto: "Site com " }, { texto: "5 páginas", negrito: true }, { texto: " e " }, { texto: "blog", italico: true }, { texto: "." }],
    });
    expect(d.blocos).toContainEqual({ tipo: "item", marcador: "•", nivel: 0, trechos: [{ texto: "Home" }] });
    expect(d.blocos).toContainEqual({ tipo: "item", marcador: "–", nivel: 1, trechos: [{ texto: "formulário" }] });
    expect(d.blocos).toContainEqual({ tipo: "item", marcador: "2.", nivel: 0, trechos: [{ texto: "Fase dois" }] });
    expect(d.blocos.slice(-5)).toEqual([
      { tipo: "titulo", nivel: 2, trechos: [{ texto: "Cronograma" }] },
      {
        tipo: "tabela",
        colunas: [
          { titulo: "Etapas Principais", largura: 0.56, alinhar: "esquerda" },
          { titulo: "Data", largura: 0.2, alinhar: "centro" },
          { titulo: "Valor", largura: 0.24, alinhar: "direita" },
        ],
        linhas: [
          ["Protótipo", "01/12/2026", "R$ 5.000,00"],
          ["Site no ar", "15/01/2027", "—"],
        ],
        // Só datas, e uma entrega sem parcela: a tabela não afirma total nenhum.
        total: undefined,
      },
      { tipo: "titulo", nivel: 2, trechos: [{ texto: "Investimento" }] },
      { tipo: "paragrafo", semRecuo: true, trechos: [{ texto: "Total em valores: R$ 12.500,00", negrito: true }] },
      { tipo: "paragrafo", semRecuo: true, trechos: [{ texto: "Prazo: 60 dias corridos" }] },
    ]);
  });

  it("o escopo resumido é dado do sistema: não vai para o PDF", () => {
    expect(JSON.stringify(documentoPdfDaProposta(base))).not.toContain("Site institucional");
  });

  it("bloco posicionado sai no lugar dele; bloco tirado da folha não sai, e os dados não somem do resto", () => {
    const meio = documentoPdfDaProposta({ ...base, markdown: "Antes.\n\n<!-- bloco:cronograma -->\n\nDepois." });
    expect(meio.blocos.map((b) => b.tipo)).toEqual(["paragrafo", "titulo", "tabela", "paragrafo"]);
    const nenhum = documentoPdfDaProposta({ ...base, markdown: "Antes.\n\n<!-- bloco:nenhum -->" });
    expect(nenhum.blocos).toEqual([{ tipo: "paragrafo", trechos: [{ texto: "Antes." }] }]);
  });

  it("duração no cronograma: a coluna e o total somam as semanas, como no modelo", () => {
    const d = documentoPdfDaProposta({
      ...base,
      markdown: "<!-- bloco:cronograma -->",
      estruturado: { valor: null, prazoDias: null, escopoResumo: null, entregas: [{ titulo: "Um", dia: null, duracao: "2 semanas", valor: null }, { titulo: "Dois", dia: null, duracao: "1 semana", valor: null }] },
    });
    expect(d.blocos[1]).toMatchObject({ colunas: [{ titulo: "Etapas Principais" }, { titulo: "Duração" }], linhas: [["Um", "2 semanas"], ["Dois", "1 semana"]], total: ["Total", "3 semanas"] });
  });

  it("os totais da tabela nunca contradizem o bloco Investimento", () => {
    const total = (valor: string | null, prazoDias: number | null, entregas: { duracao: string; valor: string | null }[]) => {
      const d = documentoPdfDaProposta({ ...base, markdown: "<!-- bloco:cronograma -->", estruturado: { valor, prazoDias, escopoResumo: null, entregas: entregas.map((e, i) => ({ titulo: `E${i}`, dia: null, ...e })) } });
      return (d.blocos[1] as { total?: string[] }).total;
    };
    const duas = [{ duracao: "2 semanas", valor: "1000.00" }, { duracao: "1 semana", valor: "500.00" }];
    expect(total("1500.00", 21, duas)).toEqual(["Total", "3 semanas", "R$ 1.500,00"]);
    expect(total("2000.00", 21, duas)).toEqual(["Total", "3 semanas", ""]);
    expect(total("1500.00", 30, duas)).toEqual(["Total", "", "R$ 1.500,00"]);
    expect(total("2000.00", 30, duas)).toBeUndefined();
    expect(total(null, null, duas)).toEqual(["Total", "3 semanas", ""]);
  });

  it("cronograma misto ou só de datas não tem total de prazo; durações conhecidas acima do prazo avisam", () => {
    const e = (entregas: { dia: string | null; duracao: string | null }[], prazoDias: number | null) => ({ valor: null, prazoDias, escopoResumo: null, entregas: entregas.map((x, i) => ({ titulo: `E${i}`, valor: null, ...x })) });
    const misto = e([{ dia: null, duracao: "2 semanas" }, { dia: "2027-01-10", duracao: null }], 60);
    expect((documentoPdfDaProposta({ ...base, markdown: "<!-- bloco:cronograma -->", estruturado: misto }).blocos[1] as { total?: string[] }).total).toBeUndefined();
    expect(avisosDosDados(misto)).toEqual([]);
    const estourado = e([{ dia: null, duracao: "3 meses" }, { dia: "2027-01-10", duracao: null }], 60);
    expect(avisosDosDados(estourado)[0]).toMatch(/já somam 90 dias, mais que o prazo de 60/);
  });

  it("prévia do rascunho traz a marca visível; versão não", () => {
    expect(documentoPdfDaProposta({ ...base, numero: null }).marca).toMatch(/^RASCUNHO/);
    expect(documentoPdfDaProposta(base).marca).toBeUndefined();
  });

  it("sem parte estruturada: só o texto (bloco vazio não sai); sem empresa: o projeto na capa", () => {
    const d = documentoPdfDaProposta({ ...base, empresa: null, markdown: "Oi.", estruturado: { valor: null, prazoDias: null, escopoResumo: null, entregas: [] } });
    expect(d.capa!.empresa).toBe("Site da Padaria");
    expect(d.blocos).toEqual([{ tipo: "paragrafo", trechos: [{ texto: "Oi." }] }]);
  });

  it("formatos", () => {
    expect(formatarReais("1234567.5")).toBe("R$ 1.234.567,50");
    expect(nomeArquivoPdf('Site / "Padaria"', 2)).toBe("Proposta - Site Padaria - v2.pdf");
    expect(nomeArquivoPdf("Site", null)).toBe("Proposta - Site - rascunho.pdf");
  });
});

describe("tabela livre (GAB-102)", () => {
  const dados = (markdown: string) => ({ projeto: "P", empresa: "E", numero: 1, data: new Date("2026-11-04T12:00:00Z"), markdown, estruturado: ESTRUTURADO_VAZIO });
  const tabela = (markdown: string) => documentoPdfDaProposta(dados(markdown)).blocos.find((b) => b.tipo === "tabela") as Extract<BlocoPdf, { tipo: "tabela" }>;

  it("no lugar dela, com primeira coluna à esquerda, demais ao centro, larguras somando 1", () => {
    const blocos = documentoPdfDaProposta(dados("Antes.\n\n| Item | Valor |\n| --- | --- |\n| Site | 10 |\n\nDepois.\n\n<!-- bloco:nenhum -->")).blocos;
    expect(blocos.map((b) => b.tipo)).toEqual(["paragrafo", "tabela", "paragrafo"]);
    const t = blocos[1] as Extract<BlocoPdf, { tipo: "tabela" }>;
    expect(t.colunas.map((c) => c.alinhar)).toEqual(["esquerda", "centro"]);
    expect(t.colunas.reduce((s, c) => s + c.largura, 0)).toBeCloseTo(1);
  });

  it("negrito e itálico chegam às células e ao cabeçalho", () => {
    const t = tabela("| **A** | b |\n| --- | --- |\n| *c* | d |");
    expect(t.colunas[0].titulo).toEqual([{ texto: "A", negrito: true }]);
    expect(t.linhas[0][0]).toEqual([{ texto: "c", italico: true }]);
  });

  it("total é só a marca de quem escreveu, em qualquer linha do corpo; o texto sai como está, sem soma", () => {
    const t = tabela("| a | b |\n| --- | --- |\n| x | 1 |\n| <!-- total --> Subtotal | 999 |\n| y | 2 |\n| <!-- total --> Total | 3 |");
    expect(t.totais).toEqual([1, 3]);
    expect(t.linhas[1][1]).toEqual([{ texto: "999" }]);
    expect(t.total).toBeUndefined();
    expect(tabela("| a |\n| --- |\n| x |").totais).toBeUndefined();
  });

  it("tabela só com cabeçalho e com célula vazia não quebram", () => {
    expect(tabela("| a |  |\n| --- | --- |").linhas).toEqual([]);
    expect(tabela("| a |  |\n| --- | --- |").colunas[1].titulo).toEqual([]);
  });
});

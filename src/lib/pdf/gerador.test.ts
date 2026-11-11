// @vitest-environment node
import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { gerarPdf, limparTexto } from "./gerador";
import { nomeDaCapa } from "./nome-capa";
import { TEMPLATE_IJ } from "./templates/ij";
import type { DocumentoPdf } from "./tipos";

async function texto(bytes: Uint8Array) {
  const doc = await getDocumentProxy(new Uint8Array(bytes));
  const r = await extractText(doc, { mergePages: false });
  return { paginas: r.totalPages, texto: (r.text as string[]).map((t) => t.replace(/\s+/g, " ")) };
}

const ACENTOS = "Ação, coração, pão, órgão, É, Ç, ü, à, ê — “aspas” e R$ 12.500,00";

describe("gerarPdf (pdf-lib + Arimo embutida)", () => {
  it("acentos/UTF-8 saem como texto de verdade (fonte embutida em subconjunto)", async () => {
    const doc: DocumentoPdf = {
      titulo: "Proposta comercial",
      subtitulo: ["Padaria São João"],
      blocos: [
        { tipo: "titulo", nivel: 2, trechos: [{ texto: "Escopo" }] },
        { tipo: "paragrafo", trechos: [{ texto: ACENTOS }] },
        { tipo: "paragrafo", trechos: [{ texto: "texto " }, { texto: "negrito", negrito: true }, { texto: " e " }, { texto: "itálico", italico: true }] },
        { tipo: "item", marcador: "•", nivel: 0, trechos: [{ texto: "Página inicial" }] },
        { tipo: "item", marcador: "1.", nivel: 1, trechos: [{ texto: "Sub-item numerado" }] },
        { tipo: "linha" },
        { tipo: "campos", linhas: [{ rotulo: "Valor total", valor: "R$ 12.500,00" }, { rotulo: "Prazo", valor: "60 dias corridos" }] },
        { tipo: "tabela", colunas: [{ titulo: "Entrega", largura: 0.6 }, { titulo: "Data", largura: 0.2 }, { titulo: "Valor", largura: 0.2, alinhar: "direita" }], linhas: [["Protótipo", "01/12/2026", "R$ 5.000,00"]] },
      ],
    };
    const bytes = await gerarPdf(doc, TEMPLATE_IJ);
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe("%PDF-");
    const t = await texto(bytes);
    expect(t.paginas).toBe(1);
    const p1 = t.texto[0];
    for (const s of ["Proposta comercial", "Padaria São João", "Ação, coração, pão, órgão, É, Ç, ü, à, ê", "negrito", "itálico", "Página inicial", "Sub-item numerado", "Valor total", "R$ 12.500,00", "Protótipo"]) {
      expect(p1).toContain(s);
    }
    // Subconjunto: o PDF não carrega a fonte inteira (4 × ~500 KB). Com as imagens do modelo.
    expect(bytes.length).toBeLessThan(250_000);
  });

  it("quebra linha e página, sem perder texto", async () => {
    const longo = Array.from({ length: 400 }, (_, i) => `palavra${i}`).join(" ");
    const doc: DocumentoPdf = {
      titulo: "Longo",
      blocos: [
        ...Array.from({ length: 6 }, (): DocumentoPdf["blocos"][number] => ({ tipo: "paragrafo", trechos: [{ texto: longo }] })),
        { tipo: "tabela", colunas: [{ titulo: "A", largura: 0.5 }, { titulo: "B", largura: 0.5 }], linhas: Array.from({ length: 80 }, (_, i) => [`linha ${i}`, "x".repeat(300)]) },
      ],
    };
    const t = await texto(await gerarPdf(doc, TEMPLATE_IJ));
    expect(t.paginas).toBeGreaterThan(3);
    expect(t.texto.join(" ")).toContain("palavra399");
    expect(t.texto.join(" ")).toContain("linha 79");
  });

  it("caractere que a fonte não tem (emoji) vira ? em vez de sumir", async () => {
    const t = await texto(await gerarPdf({ titulo: "X", blocos: [{ tipo: "paragrafo", trechos: [{ texto: "oi 🚀 fim" }] }] }, TEMPLATE_IJ));
    expect(t.texto[0]).toContain("oi ? fim");
  });
});

describe("modelo da IJ", () => {
  const coord = (b: Uint8Array) => getDocumentProxy(new Uint8Array(b));
  async function itens(bytes: Uint8Array, pagina: number) {
    const doc = await coord(bytes);
    const c = await (await doc.getPage(pagina)).getTextContent();
    return c.items as { str: string; transform: number[]; width: number }[];
  }

  it("capa em página própria, com empresa, data e endereço; o conteúdo começa na página seguinte", async () => {
    const bytes = await gerarPdf(
      { titulo: "Proposta Comercial de Projeto", capa: { titulo: "PROPOSTA COMERCIAL", empresa: "Padaria São João", data: "São Paulo, 4 de novembro de 2026", endereco: "Avenida X" }, blocos: [{ tipo: "paragrafo", trechos: [{ texto: "Corpo." }] }] },
      TEMPLATE_IJ,
    );
    const t = await texto(bytes);
    expect(t.paginas).toBe(2);
    for (const s of ["PROPOSTA COMERCIAL", "Padaria São João", "São Paulo, 4 de novembro de 2026", "Avenida X"]) expect(t.texto[0]).toContain(s);
    expect(t.texto[0]).not.toContain("Corpo.");
    expect(t.texto[1]).toContain("Corpo.");
  });

  it("nome longo quebra em linhas na capa, inteiro e dentro da moldura", async () => {
    const empresa = "COMPANHIA BRASILEIRA DE DISTRIBUIÇÃO E LOGÍSTICA DE ALIMENTOS DO SUDESTE";
    const bytes = await gerarPdf({ titulo: "T", capa: { titulo: "PROPOSTA COMERCIAL", empresa, data: "d", endereco: "e" }, blocos: [] }, TEMPLATE_IJ);
    const it = (await itens(bytes, 1)).filter((i) => nomeDaCapa(empresa).linhas.includes(i.str));
    expect(it.map((i) => i.str).join(" ")).toBe(empresa);
    for (const i of it) expect(i.transform[4]).toBeGreaterThan(0.11 * 595);
  });

  it("título leva junto a tabela inteira do começo: cabeçalho e 1ª linha, mesmo altos", async () => {
    const enche = Array.from({ length: 900 }, (_, i) => `palavra${i}`).join(" ");
    for (let n = 0; n < 12; n++) {
      const blocos: DocumentoPdf["blocos"] = [
        { tipo: "paragrafo", trechos: [{ texto: enche.slice(0, 3000 + n * 90) }] },
        { tipo: "titulo", nivel: 2, trechos: [{ texto: "TITULODATABELA" }] },
        { tipo: "tabela", colunas: [{ titulo: "CABECALHO", largura: 0.5 }, { titulo: "B", largura: 0.5 }], linhas: [["PRIMEIRALINHA " + "x ".repeat(200), "y"]] },
      ];
      const t = await texto(await gerarPdf({ titulo: "T", blocos }, TEMPLATE_IJ));
      const pag = (s: string) => t.texto.findIndex((p) => p.includes(s));
      expect(pag("TITULODATABELA")).toBe(pag("PRIMEIRALINHA"));
    }
  });

  it("títulos em sequência vão juntos com o começo do bloco seguinte", async () => {
    const enche = Array.from({ length: 900 }, (_, i) => `palavra${i}`).join(" ");
    for (let n = 0; n < 14; n++) {
      const blocos: DocumentoPdf["blocos"] = [
        { tipo: "paragrafo", trechos: [{ texto: enche.slice(0, 3000 + n * 80) }] },
        { tipo: "titulo", nivel: 2, trechos: [{ texto: "TITULOUM" }] },
        { tipo: "titulo", nivel: 3, trechos: [{ texto: "TITULODOIS" }] },
        { tipo: "tabela", colunas: [{ titulo: "CABECALHO", largura: 1 }], linhas: [["PRIMEIRALINHA"]] },
      ];
      const t = await texto(await gerarPdf({ titulo: "T", blocos }, TEMPLATE_IJ));
      const pag = (s: string) => t.texto.findIndex((p) => p.includes(s));
      expect(pag("TITULOUM")).toBe(pag("PRIMEIRALINHA"));
    }
  });

  it("muitos títulos seguidos ocupam o espaço das páginas, em vez de um por página", async () => {
    const blocos = Array.from({ length: 40 }, (_, i): DocumentoPdf["blocos"][number] => ({ tipo: "titulo", nivel: 2, trechos: [{ texto: `Titulo ${i}` }] }));
    const t = await texto(await gerarPdf({ titulo: "T", blocos: [...blocos, { tipo: "paragrafo", trechos: [{ texto: "FIM" }] }] }, TEMPLATE_IJ));
    expect(t.paginas).toBeLessThanOrEqual(4);
    for (let i = 0; i < 40; i++) expect(t.texto.join(" ")).toContain(`Titulo ${i} `);
  });

  it("até três títulos seguidos não ficam órfãos, em qualquer ponto da página", async () => {
    const enche = Array.from({ length: 900 }, (_, i) => `palavra${i}`).join(" ");
    for (let n = 0; n < 16; n++) {
      const blocos: DocumentoPdf["blocos"] = [
        { tipo: "paragrafo", trechos: [{ texto: enche.slice(0, 3000 + n * 70) }] },
        { tipo: "titulo", nivel: 2, trechos: [{ texto: "TITULOUM" }] },
        { tipo: "titulo", nivel: 3, trechos: [{ texto: "TITULODOIS" }] },
        { tipo: "titulo", nivel: 3, trechos: [{ texto: "TITULOTRES" }] },
        { tipo: "paragrafo", trechos: [{ texto: "COMECODOTEXTO" }] },
      ];
      const t = await texto(await gerarPdf({ titulo: "T", blocos }, TEMPLATE_IJ));
      const pag = (s: string) => t.texto.findIndex((p) => p.includes(s));
      expect(pag("TITULOUM")).toBe(pag("COMECODOTEXTO"));
    }
  });

  it("no fim de uma sequência longa, o último título ainda leva o começo do texto", async () => {
    const titulos = Array.from({ length: 60 }, (_, i): DocumentoPdf["blocos"][number] => ({ tipo: "titulo", nivel: 2, trechos: [{ texto: `Titulo ${i}X` }] }));
    for (let n = 0; n < 16; n++) {
      const blocos: DocumentoPdf["blocos"] = [...titulos.slice(n), { tipo: "paragrafo", trechos: [{ texto: "COMECODOTEXTO" }] }];
      const t = await texto(await gerarPdf({ titulo: "T", blocos }, TEMPLATE_IJ));
      const pag = (s: string) => t.texto.findIndex((p) => p.includes(s));
      expect(pag("Titulo 59X")).toBe(pag("COMECODOTEXTO"));
    }
  });

  it("marca de rascunho aparece na capa e nas páginas; sem marca, não aparece", async () => {
    const doc: DocumentoPdf = { titulo: "T", capa: { titulo: "A", empresa: "B", data: "C", endereco: "D" }, blocos: [{ tipo: "paragrafo", trechos: [{ texto: "x" }] }] };
    const com = await texto(await gerarPdf({ ...doc, marca: "RASCUNHO: prévia" }, TEMPLATE_IJ));
    for (const p of com.texto) expect(p).toContain("RASCUNHO");
    expect((await texto(await gerarPdf(doc, TEMPLATE_IJ))).texto.join(" ")).not.toContain("RASCUNHO");
  });

  it("parágrafo justificado: linhas com a mesma borda direita, a última não; primeira linha recuada", async () => {
    const longo = Array.from({ length: 120 }, (_, i) => `palavra${i}`).join(" ");
    const bytes = await gerarPdf({ titulo: "T", blocos: [{ tipo: "paragrafo", trechos: [{ texto: longo }] }] }, TEMPLATE_IJ);
    const pal = (await itens(bytes, 1)).filter((i) => i.str.trim().startsWith("palavra"));
    const porLinha = new Map<number, typeof pal>();
    for (const p of pal) porLinha.set(p.transform[5], [...(porLinha.get(p.transform[5]) ?? []), p]);
    const linhas = [...porLinha.values()];
    expect(linhas.length).toBeGreaterThan(3);
    const direita = (l: typeof pal) => Math.max(...l.map((p) => p.transform[4] + p.width));
    for (const l of linhas.slice(0, -1)) expect(direita(l)).toBeGreaterThan(595.28 - 70 - 6);
    expect(direita(linhas.at(-1)!)).toBeLessThan(595.28 - 70 - 30);
    expect(linhas[0][0].transform[4]).toBeCloseTo(70 + 34, 0);
    expect(linhas[1][0].transform[4]).toBeCloseTo(70, 0);
  });

  it("título principal centralizado; tabela com linha de total", async () => {
    const bytes = await gerarPdf(
      { titulo: "Proposta Comercial de Projeto", blocos: [{ tipo: "tabela", colunas: [{ titulo: "Etapas", largura: 0.76 }, { titulo: "Duração", largura: 0.24, alinhar: "centro" }], linhas: [["Um", "2 semanas"]], total: ["Total", "2 semanas"] }] },
      TEMPLATE_IJ,
    );
    const it = await itens(bytes, 1);
    const titulo = it.find((i) => i.str.includes("Proposta Comercial"))!;
    expect(titulo.transform[4] + titulo.width / 2).toBeCloseTo(595.28 / 2, 0);
    expect(it.map((i) => i.str).join(" ")).toContain("Total");
  });

  it("100 mil caracteres justificados continuam rápidos (posição por palavra com codificação guardada)", async () => {
    const paragrafo = Array.from({ length: 150 }, (_, i) => `palavra${i % 37}`).join(" ");
    const blocos = Array.from({ length: 80 }, (): DocumentoPdf["blocos"][number] => ({ tipo: "paragrafo", trechos: [{ texto: paragrafo }] }));
    const ini = performance.now();
    const bytes = await gerarPdf({ titulo: "T", capa: { titulo: "A", empresa: "B", data: "C", endereco: "D" }, blocos }, TEMPLATE_IJ);
    expect(performance.now() - ini).toBeLessThan(5000);
    expect(bytes.length).toBeLessThan(2_000_000);
  });
});

describe("tabela grande (GAB-102)", () => {
  type Item = { str: string; transform: number[]; width: number };
  async function paginas(bytes: Uint8Array) {
    const doc = await getDocumentProxy(new Uint8Array(bytes));
    return Promise.all(Array.from({ length: doc.numPages }, async (_, i) => (await (await doc.getPage(i + 1)).getTextContent()).items as Item[]));
  }
  const colunas = (n: number, titulo = (j: number) => `Col${j}`): Extract<DocumentoPdf["blocos"][number], { tipo: "tabela" }>["colunas"] => Array.from({ length: n }, (_, j) => ({ titulo: titulo(j), largura: 1 / n }));
  const { margem, largura, altura } = TEMPLATE_IJ.pagina;

  it("quebra entre páginas repetindo o cabeçalho, sem partir linha", async () => {
    const linhas = Array.from({ length: 100 }, (_, i) => [`LINHA${i}`, `b${i} ${"palavra ".repeat(30)}`]);
    const t = await paginas(await gerarPdf({ titulo: "T", blocos: [{ tipo: "tabela", colunas: colunas(2), linhas }] }, TEMPLATE_IJ));
    expect(t.length).toBeGreaterThan(2);
    for (const p of t) expect(p.some((i) => i.str.includes("Col0"))).toBe(true);
    const achadas = t.flatMap((p) => p.map((i) => i.str)).join(" ");
    for (let i = 0; i < 100; i++) expect(achadas).toContain(`LINHA${i}`);
    // Nenhuma linha de tabela começa numa página e termina na outra: cada célula tem 'b<i>' junto do rótulo.
    for (const p of t) {
      const rotulos = p.filter((i) => i.str.startsWith("LINHA")).map((i) => i.str.slice(5));
      for (const n of rotulos) expect(p.some((i) => i.str.startsWith(`b${n} `))).toBe(true);
    }
  });

  it("palavra longa quebra dentro da célula; muitas colunas não saem da página", async () => {
    const linhas = [Array.from({ length: 8 }, (_, j) => `${"W".repeat(60)}${j}`)];
    const [p] = await paginas(await gerarPdf({ titulo: "T", blocos: [{ tipo: "tabela", colunas: colunas(8), linhas }] }, TEMPLATE_IJ));
    const direita = largura - margem.direita;
    for (const i of p) {
      if (i.str.includes("WW")) {
        expect(i.transform[4]).toBeGreaterThanOrEqual(margem.esquerda);
        expect(i.transform[4] + i.width).toBeLessThanOrEqual(direita);
        expect(i.width).toBeLessThanOrEqual((largura - margem.esquerda - margem.direita) / 8);
      }
    }
    expect(p.map((i) => i.str).join("").replace(/\s/g, "")).toContain(`${"W".repeat(60)}7`.slice(-20));
  });

  it("linha maior que a página inteira parte só ela, sem texto fora da folha", async () => {
    const enorme = Array.from({ length: 500 }, (_, i) => `t${i}`).join(" ");
    const blocos: DocumentoPdf["blocos"] = [{ tipo: "tabela", colunas: colunas(8), linhas: [Array.from({ length: 8 }, () => enorme), ["fim", "", "", "", "", "", "", ""]] }];
    const t = await paginas(await gerarPdf({ titulo: "T", blocos }, TEMPLATE_IJ));
    expect(t.length).toBeGreaterThan(1);
    const texto = t.flatMap((p) => p.map((i) => i.str)).join(" ");
    expect(texto).toContain("t499");
    expect(texto).toContain("fim");
    for (const p of t) {
      for (const i of p) {
        expect(i.transform[5]).toBeGreaterThanOrEqual(margem.base);
        expect(i.transform[5]).toBeLessThanOrEqual(altura);
      }
      expect(p.some((i) => i.str.includes("Col7"))).toBe(true);
    }
  });

  it("cabeçalho enorme não se repete nem deixa página em branco", async () => {
    const enorme = Array.from({ length: 900 }, (_, i) => `c${i}`).join(" ");
    const linhas = Array.from({ length: 60 }, (_, i) => [`LINHA${i}`]);
    const t = await paginas(await gerarPdf({ titulo: "T", blocos: [{ tipo: "tabela", colunas: colunas(1, () => enorme), linhas }] }, TEMPLATE_IJ));
    const texto = t.flatMap((p) => p.map((i) => i.str)).join(" ");
    expect(texto).toContain("c899");
    expect(texto).toContain("LINHA59");
    for (const p of t) expect(p.length).toBeGreaterThan(0);
    expect(t.filter((p) => p.some((i) => i.str.includes("c899"))).length).toBe(1);
  });

  it("trechos: negrito e itálico nas células; linha de total em qualquer posição; texto igual ao escrito", async () => {
    const bytes = await gerarPdf(
      {
        titulo: "T",
        blocos: [
          {
            tipo: "tabela",
            colunas: [{ titulo: [{ texto: "Item", italico: true }], largura: 0.5 }, { titulo: "Valor", largura: 0.5, alinhar: "centro" }],
            linhas: [[[{ texto: "forte", negrito: true }, { texto: " e " }, { texto: "inclinado", italico: true }], "10"], ["Subtotal", "999"], [[], "20"]],
            totais: [1],
          },
        ],
      },
      TEMPLATE_IJ,
    );
    const [p] = await paginas(bytes);
    const texto = p.map((i) => i.str).join(" ");
    for (const s of ["Item", "forte", "inclinado", "Subtotal", "999", "20"]) expect(texto).toContain(s);
    const valor = p.find((i) => i.str.trim() === "Valor")!;
    const col = (largura - margem.esquerda - margem.direita) / 2;
    expect(valor.transform[4] + valor.width / 2).toBeCloseTo(margem.esquerda + col * 1.5, 0);
  });

  it("a linha marcada ganha o fundo do total, e as outras não", async () => {
    const base: DocumentoPdf = { titulo: "T", blocos: [{ tipo: "tabela", colunas: colunas(1), linhas: [["a"], ["b"]] }] };
    const sem = await gerarPdf(base, TEMPLATE_IJ);
    const com = await gerarPdf({ ...base, blocos: [{ tipo: "tabela", colunas: colunas(1), linhas: [["a"], ["b"]], totais: [1] }] }, TEMPLATE_IJ);
    const doc = await PDFDocument.load(com);
    const conteudo = (d: PDFDocument) => {
      const fluxos = d.getPages().flatMap((pg) => pg.node.normalizedEntries().Contents?.asArray() ?? []);
      return fluxos.map((r) => inflateSync((d.context.lookup(r) as unknown as { getContents(): Uint8Array }).getContents()).toString("latin1")).join("\n");
    };
    const total = /0\.9529\d* 0\.8901\d* 0\.8901\d* rg/; // #F3E3E3
    expect(conteudo(doc)).toMatch(total);
    expect(conteudo(await PDFDocument.load(sem))).not.toMatch(total);
  });
});

describe("limparTexto", () => {
  it("normaliza espaço/controle e troca o que falta", () => {
    expect(limparTexto("a\tb c\u0007d​e🚀", new Set([..."abcde "].map((c) => c.codePointAt(0)!)))).toBe("a b cde?");
  });
  it("compõe acento decomposto (NFD → NFC)", () => {
    expect(limparTexto("ã", new Set(["ã".codePointAt(0)!]))).toBe("ã");
  });
});

import { describe, expect, it } from "vitest";
import { criarAncora, textoPlano, TRECHO_MAX } from "./ancora";
import type { Documento } from "./documento";
import { documentoParaMarkdown, markdownParaDocumento } from "./markdown";
import { aplicarNoDocumento, ancoraDaLinha, localizarSugestao, trechoSugerivel } from "./sugestao-trecho";

const anc = (texto: string, trecho: string, a = texto.indexOf(trecho)) => criarAncora(texto, a, a + trecho.length)!;

describe("localizarSugestao", () => {
  const texto = "Prazo de 30 dias para o site.\nOutro prazo de 30 dias corridos.";

  it("acha a ocorrência certa pelo contexto", () => {
    const a = anc(texto, "30 dias", texto.lastIndexOf("30 dias"));
    expect(localizarSugestao(texto, a)?.inicio).toBe(texto.lastIndexOf("30 dias"));
  });

  it("edição só de um lado do trecho ainda se aplica", () => {
    const a = anc(texto, "30 dias");
    expect(localizarSugestao(texto.replace("Prazo de", "Tempo de"), a)).not.toBeNull();
  });

  it("trecho mudado: desatualizada, mesmo com o mesmo texto em outro lugar", () => {
    const a = anc(texto, "30 dias");
    expect(localizarSugestao(texto.replace("30 dias para", "45 dias para"), a)).toBeNull();
    expect(localizarSugestao("Sem nada aqui.", a)).toBeNull();
  });

  it("contexto vazio é borda do texto, não coringa", () => {
    const a = anc("abc def", "abc");
    expect(a.antes).toBe("");
    expect(localizarSugestao("zzz abc qqq", a)).toBeNull();
  });

  it("trecho que atravessa blocos ou é bloco móvel não se aplica", () => {
    expect(trechoSugerivel("a\nb")).toBe(false);
    expect(trechoSugerivel("")).toBe(false);
    expect(localizarSugestao("a\nb", { trecho: "a\nb", antes: "", depois: "" })).toBeNull();
  });
});

describe("aplicarNoDocumento", () => {
  const p = (t: string): Documento["content"][number] => ({ type: "paragraph", content: [{ type: "text", text: t }] });

  it("troca dentro do bloco certo, com lista e título, e passa pelo Markdown", () => {
    const md = "## Escopo\n\nSite com loja.\n\n- item um\n- item dois";
    const doc = markdownParaDocumento(md);
    const plano = textoPlano(doc).texto;
    const a = anc(plano, "item dois");
    const novo = aplicarNoDocumento(doc, localizarSugestao(plano, a)!, "item 2")!;
    expect(documentoParaMarkdown(novo)).toBe("## Escopo\n\nSite com loja.\n\n- item um\n- item 2");
  });

  it("o texto novo herda a formatação do começo do trecho; o resto do bloco não muda", () => {
    const doc: Documento = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Site " }, { type: "text", text: "com loja", marks: [{ type: "bold" }] }, { type: "text", text: " e blog." }] }],
    };
    const novo = aplicarNoDocumento(doc, { inicio: 5, fim: 8 }, "sem")!;
    expect(novo.content[0]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "Site " }, { type: "text", text: "sem", marks: [{ type: "bold" }] }, { type: "text", text: " loja", marks: [{ type: "bold" }] }, { type: "text", text: " e blog." }],
    });
  });

  it("texto novo vazio apaga o trecho", () => {
    const doc: Documento = { type: "doc", content: [p("abc def")] };
    expect(documentoParaMarkdown(aplicarNoDocumento(doc, { inicio: 3, fim: 7 }, "")!)).toBe("abc");
  });

  it("não cabe num bloco: null", () => {
    const doc: Documento = { type: "doc", content: [p("abc"), p("def")] };
    expect(aplicarNoDocumento(doc, { inicio: 1, fim: 6 }, "x")).toBeNull();
  });

  it("caracteres de Markdown no texto novo voltam iguais", () => {
    const doc: Documento = { type: "doc", content: [p("abc def")] };
    const md = documentoParaMarkdown(aplicarNoDocumento(doc, { inicio: 4, fim: 7 }, "**x** # y")!);
    expect(textoPlano(markdownParaDocumento(md)).texto.split("\n")[0]).toBe("abc **x** # y");
  });
});

describe("ancoraDaLinha", () => {
  it("bloco curto inteiro; longo cortado no limite, sem cortar palavra", () => {
    expect(ancoraDaLinha("abc\ndef", 4, 3)?.trecho).toBe("def");
    const longo = "palavra ".repeat(100).trim();
    const a = ancoraDaLinha(longo, 0, longo.length)!;
    expect(a.trecho.length).toBeLessThanOrEqual(TRECHO_MAX);
    expect(a.trecho.endsWith("palavra")).toBe(true);
  });
});

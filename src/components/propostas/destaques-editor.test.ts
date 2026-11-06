import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { documentoParaEditor, lerDocumento, type Documento } from "@/lib/propostas/documento";
import { textoPlano } from "@/lib/propostas/ancora";
import { documentoParaMarkdown, markdownParaDocumento } from "@/lib/propostas/markdown";
import { EXTENSOES } from "./editor-texto";
import { ancoraDaSelecao, ancoraDoElemento, chaveDestaques, DestaquesComentarios, planoDoEditor, transacaoDeSugestao } from "./destaques-editor";

const doc: Documento = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Escopo" }] },
    { type: "paragraph", content: [{ type: "text", text: "Site " }, { type: "text", text: "com loja", marks: [{ type: "bold" }] }] },
    { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "item um" }] }] }] },
  ],
};

const novo = () => new Editor({ extensions: [...EXTENSOES, DestaquesComentarios], content: documentoParaEditor(doc) });

describe("texto plano do editor = o da visualização", () => {
  it("mesmo texto que textoPlano(documento) (a âncora vale nos dois)", () => {
    const e = novo();
    expect(planoDoEditor(e.state.doc).texto).toBe(textoPlano(doc).texto);
    e.destroy();
  });
});

describe("ancoraDaSelecao", () => {
  it("seleção do editor → trecho + contexto no texto plano", () => {
    const e = novo();
    const { texto, segmentos } = planoDoEditor(e.state.doc);
    const seg = segmentos[1]; // "Site com loja"
    e.commands.setTextSelection({ from: seg.posicoes[0] + 5, to: seg.posicoes[0] + 13 });
    expect(ancoraDaSelecao(e.state)).toEqual({ trecho: "com loja", antes: texto.slice(0, 12), depois: "\nitem um\n\uE001\n\uE002" });
    e.destroy();
  });

  it("seleção vazia → null", () => {
    const e = novo();
    e.commands.setTextSelection(3);
    expect(ancoraDaSelecao(e.state)).toBeNull();
    e.destroy();
  });

  it("seleção atravessando blocos inclui o \\n", () => {
    const e = novo();
    const { segmentos } = planoDoEditor(e.state.doc);
    e.commands.setTextSelection({ from: segmentos[0].posicoes[0] + 3, to: segmentos[1].posicoes[0] + 4 });
    expect(ancoraDaSelecao(e.state)?.trecho).toBe("opo\nSite");
    e.destroy();
  });
});

describe("decoração do trecho comentado (só visual)", () => {
  it("destaca onde a âncora está, acompanha a edição e some quando o trecho muda — o documento não ganha marca", () => {
    const e = novo();
    e.view.dispatch(e.state.tr.setMeta(chaveDestaques, { destaques: [{ id: "c1", ancora: { trecho: "com loja", antes: "Site ", depois: "" } }], ativo: "c1" }));
    const marcas = () => [...e.view.dom.querySelectorAll("[data-comentario]")].map((n) => [n.textContent, n.className]);
    expect(marcas()).toEqual([["com loja", "comentario-destaque comentario-destaque-ativo"]]);
    // O JSON (o que vai para o Markdown) continua só com o subconjunto.
    expect(lerDocumento(e.getJSON())).toEqual(doc);

    e.commands.insertContentAt(1, "Novo "); // texto antes: a âncora continua achada
    expect(marcas().map(([t]) => t)).toEqual(["com loja"]);

    const { segmentos } = planoDoEditor(e.state.doc);
    e.commands.insertContentAt(segmentos[1].posicoes[0] + 7, "X"); // dentro do trecho: "coXm loja"
    expect(marcas()).toEqual([]);
    e.destroy();
  });
});

describe("espaços que o Markdown não guarda (editor ao vivo × canônico)", () => {
  const cru: Documento = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "  Prazo:  30\tdias  " }] }],
  };
  const editor = () => new Editor({ extensions: [...EXTENSOES, DestaquesComentarios], content: documentoParaEditor(cru) });
  // O que o servidor e os leitores veem: ida e volta pelo Markdown canônico.
  const canonico = () => textoPlano(markdownParaDocumento(documentoParaMarkdown(cru))).texto;

  it("texto plano do editor = o do documento canônico", () => {
    const e = editor();
    expect(canonico()).toBe("Prazo: 30 dias\n\uE001\n\uE002");
    expect(planoDoEditor(e.state.doc).texto).toBe(canonico());
    e.destroy();
  });

  it("selecionar 'Prazo:  30' (dois espaços) no editor dá a âncora canônica", () => {
    const e = editor();
    const p0 = 1; // início do texto do parágrafo
    e.commands.setTextSelection({ from: p0 + 2, to: p0 + 12 }); // "Prazo:  30"
    expect(ancoraDaSelecao(e.state)).toEqual({ trecho: "Prazo: 30", antes: "", depois: " dias\n\uE001\n\uE002" });
    e.destroy();
  });

  it("trecho citado por um leitor ('Prazo: 30 dias') é achado e destacado no editor cru", () => {
    const e = editor();
    e.view.dispatch(e.state.tr.setMeta(chaveDestaques, { destaques: [{ id: "c1", ancora: { trecho: "Prazo: 30 dias", antes: "", depois: "" } }], ativo: null }));
    const marcas = [...e.view.dom.querySelectorAll("[data-comentario]")].map((n) => n.textContent).join("");
    expect(marcas).toBe("Prazo:  30\tdias");
    e.destroy();
  });
});

describe("sugestão no editor (GAB-101)", () => {
  it("troca o trecho com a formatação do começo dele, igual ao servidor, e entra no histórico", () => {
    const e = novo();
    const a = { trecho: "com loja", antes: "Escopo\nSite ", depois: "\nitem um\n\uE001\n\uE002" };
    e.view.dispatch(transacaoDeSugestao(e.state, a, "sem loja")!);
    expect(planoDoEditor(e.state.doc).texto).toContain("Site sem loja");
    const p = e.getJSON().content![1];
    expect(p.content![1]).toMatchObject({ text: "sem loja", marks: [{ type: "bold" }] });
    e.commands.undo();
    expect(planoDoEditor(e.state.doc).texto).toContain("Site com loja");
    e.destroy();
  });

  it("trecho mudado: null; texto novo vazio apaga", () => {
    const e = novo();
    expect(transacaoDeSugestao(e.state, { trecho: "nada disso", antes: "", depois: "" }, "x")).toBeNull();
    const a = { trecho: "item um", antes: "Site com loja\n", depois: "\n\uE001\n\uE002" };
    e.view.dispatch(transacaoDeSugestao(e.state, a, "")!);
    expect(planoDoEditor(e.state.doc).texto).not.toContain("item um");
    e.destroy();
  });

  it("espaços crus no editor: acha pelo texto canônico e troca no lugar certo", () => {
    const e = new Editor({ extensions: [...EXTENSOES, DestaquesComentarios], content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Prazo  de 30   dias." }] }] } });
    const a = { trecho: "30 dias", antes: "Prazo de ", depois: "." };
    e.view.dispatch(transacaoDeSugestao(e.state, a, "45 dias")!);
    expect(e.state.doc.textContent).toBe("Prazo  de 45 dias.");
    e.destroy();
  });
});

describe("o + da linha (GAB-101)", () => {
  it("a âncora é o bloco inteiro; bloco móvel pelo data-bloco; vazio não comenta", () => {
    const e = novo();
    const p = e.view.dom.querySelectorAll("p")[0];
    expect(ancoraDoElemento(e.view, p)?.trecho).toBe("Site com loja");
    const h = e.view.dom.querySelector("h2")!;
    expect(ancoraDoElemento(e.view, h)?.trecho).toBe("Escopo");
    const li = e.view.dom.querySelector("li p")!;
    expect(ancoraDoElemento(e.view, li)?.trecho).toBe("item um");
    const bloco = document.createElement("div");
    bloco.setAttribute("data-bloco", "cronograma");
    expect(ancoraDoElemento(e.view, bloco)?.trecho).toBe("\uE001");
    e.destroy();
  });
});

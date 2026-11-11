import { render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { Fragment, Slice } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import { ancoraDoBloco, criarAncora, textoPlano } from "@/lib/propostas/ancora";
import { documentoParaEditor, lerDocumento, type Documento } from "@/lib/propostas/documento";
import { alternarBloco, blocosNoEditor } from "./bloco-dados-node";
import { ancoraDaSelecao, chaveDestaques, DestaquesComentarios, planoDoEditor } from "./destaques-editor";
import { DocumentoView } from "./documento-view";
import { EXTENSOES, jsonDoEditor } from "./editor-texto";
import { documentoParaMarkdown, markdownParaDocumento } from "@/lib/propostas/markdown";
import { TABELA_COLUNAS_MAX, TABELA_LINHAS_MAX, CELULA_MAX } from "@/lib/propostas/tabela";
import { adicionarNaTabela, alternarTotal, inserirTabela, posicaoNaTabela } from "./tabela-node";

const doc: Documento = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Escopo" }] },
    { type: "paragraph", content: [{ type: "text", text: "Site " }, { type: "text", text: "com loja", marks: [{ type: "bold" }] }, { type: "text", text: " e " }, { type: "text", text: "blog", marks: [{ type: "italic" }] }] },
    {
      type: "orderedList",
      attrs: { start: 3 },
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "três" }] }, { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "sub" }] }] }] }] },
      ],
    },
    { type: "horizontalRule" },
  ],
};

const texto = (t: string) => ({ type: "paragraph" as const, content: [{ type: "text" as const, text: t }] });

function editorCom(content: Documento | string) {
  return new Editor({ extensions: EXTENSOES, content });
}

describe("Tiptap com só as extensões do subconjunto", () => {
  it("o documento canônico entra e sai do editor igual (getJSON → lerDocumento)", () => {
    const e = editorCom(doc);
    expect(lerDocumento(e.getJSON())).toEqual(doc);
    e.destroy();
  });

  it("jsonDoEditor devolve só objetos simples (server action descarta attrs sem protótipo)", () => {
    const e = editorCom(doc);
    // causa do bug: o ProseMirror cria attrs com Object.create(null)
    expect(Object.getPrototypeOf((e.getJSON().content as { attrs: object }[])[0].attrs)).toBeNull();
    const json = jsonDoEditor(e);
    const protos: unknown[] = [];
    const visitar = (v: unknown) => {
      if (v && typeof v === "object") {
        if (!Array.isArray(v)) protos.push(Object.getPrototypeOf(v));
        Object.values(v).forEach(visitar);
      }
    };
    visitar(json);
    expect(protos.every((p) => p === Object.prototype)).toBe(true);
    // Documento sem bloco no editor = os dois fora da folha, marcado (`documentoParaEditor` é quem os põe ao abrir).
    expect(lerDocumento(json)).toEqual({ ...doc, content: [...doc.content, { type: "semBlocos" }] });
    e.destroy();
  });

  it("HTML colado/carregado de fora vira o subconjunto: sem script, link, imagem nem atributos", () => {
    const e = editorCom('<p>Oi <a href="javascript:alert(1)">clique</a> <img src=x onerror="alert(1)"><script>alert(2)</script><strong>forte</strong></p><table><tr><td>célula</td></tr></table><pre><code>x</code></pre>');
    const json = JSON.stringify(e.getJSON());
    expect(json).not.toMatch(/javascript|onerror|img|script|link|href|code/);
    expect(lerDocumento(e.getJSON())).not.toBeNull();
    expect(json).toContain("clique");
    expect(json).toContain("forte");
    e.destroy();
  });
});

describe("DocumentoView (leitura)", () => {
  it("desenha títulos, marcas e listas como elementos; texto com HTML aparece literal", () => {
    render(<DocumentoView documento={{ type: "doc", content: [...doc.content, { type: "paragraph", content: [{ type: "text", text: "<script>alert(1)</script>" }] }] }} />);
    expect(screen.getByRole("heading", { level: 2, name: "Escopo" })).toBeInTheDocument();
    expect(screen.getByText("com loja").tagName).toBe("STRONG");
    expect(screen.getByText("blog").tagName).toBe("EM");
    expect(screen.getAllByRole("list")).toHaveLength(2);
    expect(document.querySelector("ol")?.getAttribute("start")).toBe("3");
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
  });

  it("vazio diz que não há texto", () => {
    render(<DocumentoView documento={{ type: "doc", content: [] }} />);
    expect(screen.getByText("Sem texto.")).toBeInTheDocument();
  });
});

describe("blocos móveis no editor (GAB-100)", () => {
  const bloco = (tipo: "cronograma" | "investimento") => ({ type: "blocoDados" as const, attrs: { tipo } });

  it("bloco entra e sai do editor; o atributo vira objeto simples (server action descarta protótipo nulo)", () => {
    const e = editorCom({ type: "doc", content: [texto("a"), bloco("cronograma"), texto("b")] });
    const json = jsonDoEditor(e);
    const no = json.content[1] as { attrs: object };
    expect(Object.getPrototypeOf(no.attrs)).toBe(Object.prototype);
    expect(lerDocumento(json)?.content.map((b) => b.type)).toEqual(["paragraph", "blocoDados", "paragraph"]);
    e.destroy();
  });

  it("proposta antiga abre com os dois no fim e, sem mexer, continua com o mesmo Markdown", () => {
    const antiga: Documento = { type: "doc", content: [texto("a")] };
    const e = editorCom(documentoParaEditor(antiga));
    expect(blocosNoEditor(e)).toEqual({ cronograma: true, investimento: true });
    expect(lerDocumento(jsonDoEditor(e))).toEqual(antiga);
    e.destroy();
  });

  it("sem nenhum bloco no editor os dois saíram da folha: fica marcado, e reabre sem eles", () => {
    const e = editorCom(documentoParaEditor({ type: "doc", content: [texto("a")] }));
    alternarBloco(e, "cronograma");
    alternarBloco(e, "investimento");
    const lido = lerDocumento(jsonDoEditor(e))!;
    expect(lido.content.at(-1)).toEqual({ type: "semBlocos" });
    const reaberto = editorCom(documentoParaEditor(lido));
    expect(blocosNoEditor(reaberto)).toEqual({ cronograma: false, investimento: false });
    e.destroy();
    reaberto.destroy();
  });

  it("um de cada, mesmo colando outro igual", () => {
    const e = editorCom({ type: "doc", content: [bloco("cronograma"), texto("a")] });
    e.commands.insertContentAt(e.state.doc.content.size, bloco("cronograma"));
    expect(lerDocumento(jsonDoEditor(e))?.content.filter((b) => b.type === "blocoDados")).toHaveLength(1);
    e.destroy();
  });

  it("digitar com o bloco selecionado escreve depois dele, sem apagá-lo", () => {
    const e = editorCom({ type: "doc", content: [texto("a"), bloco("cronograma")] });
    e.commands.setNodeSelection(3);
    const { view } = e;
    const digitar = (t: string) => view.someProp("handleTextInput", (f) => f(view, view.state.selection.from, view.state.selection.to, t, () => view.state.tr));
    expect(digitar("x")).toBe(true);
    const lido = lerDocumento(jsonDoEditor(e))!;
    expect(lido.content.map((b) => b.type)).toEqual(["paragraph", "blocoDados", "paragraph"]);
    expect(lido.content[2]).toEqual(texto("x"));
    e.destroy();
  });

  it("com parágrafo depois, digitar cria parágrafo próprio; colar também não substitui o bloco", () => {
    const e = editorCom({ type: "doc", content: [texto("a"), bloco("cronograma"), texto("b")] });
    const { view } = e;
    e.commands.setNodeSelection(3);
    view.someProp("handleTextInput", (f) => f(view, 3, 4, "x", () => view.state.tr));
    expect(lerDocumento(jsonDoEditor(e))!.content).toEqual([texto("a"), bloco("cronograma"), texto("x"), texto("b")]);
    e.commands.setNodeSelection(3);
    const trecho = new Slice(Fragment.from(e.schema.nodes.paragraph.create(null, e.schema.text("colado"))), 1, 1);
    view.someProp("handlePaste", (f) => f(view, new Event("paste") as ClipboardEvent, trecho));
    expect(lerDocumento(jsonDoEditor(e))!.content).toEqual([texto("a"), bloco("cronograma"), texto("colado"), texto("x"), texto("b")]);
    e.destroy();
  });

  it("colar bloco de tipo desconhecido não vira nó (o servidor recusaria o documento)", () => {
    const e = editorCom('<div data-bloco-dados="lixo"></div><p>a</p>');
    expect(blocosNoEditor(e)).toEqual({ cronograma: false, investimento: false });
    expect(lerDocumento(jsonDoEditor(e))).not.toBeNull();
    e.destroy();
  });

  it("bloco só no nível de cima: a lista não aceita (nem o esquema)", () => {
    const e = editorCom({ type: "doc", content: [texto("a")] });
    expect(e.schema.nodes.listItem.contentMatch.matchType(e.schema.nodes.blocoDados)).toBeFalsy();
    expect(e.schema.nodes.doc.contentMatch.matchType(e.schema.nodes.blocoDados)).toBeTruthy();
    e.destroy();
  });

  it("texto plano do editor bate com o do servidor, e a âncora do bloco é a mesma", () => {
    const doc: Documento = { type: "doc", content: [texto("a"), bloco("investimento"), texto("b")] };
    const e = editorCom(doc);
    expect(planoDoEditor(e.state.doc).texto).toBe(textoPlano(doc).texto);
    e.commands.setNodeSelection(3);
    expect(ancoraDaSelecao(e.state)).toEqual(ancoraDoBloco(doc, "investimento"));
    e.destroy();
  });
});

describe("tabela no editor (GAB-102)", () => {
  const MD = "Antes.\n\n| Item | Valor |\n| --- | --- |\n| **Site** | *R$ 10* |\n| <!-- total --> Total | a\\|b |\n\nDepois.";
  /** Markdown do editor, sem o marcador de "blocos tirados" (estes testes não têm blocos móveis). */
  const lido = (e: Editor) => documentoParaMarkdown(lerDocumento(jsonDoEditor(e))!).replace(/\n*<!-- bloco:nenhum -->$/, "");
  /** Cursor no texto `t`. */
  const cursorEm = (e: Editor, t: string) => {
    let pos = -1;
    e.state.doc.descendants((n, p) => {
      if (n.isText && n.text?.includes(t) && pos < 0) pos = p + n.text.indexOf(t);
    });
    e.commands.setTextSelection(pos);
  };

  it("documento com tabela entra e sai do editor igual; abrir não muda o Markdown (ponto fixo)", () => {
    const d = markdownParaDocumento(MD);
    const e = editorCom(documentoParaEditor(d));
    expect(lerDocumento(jsonDoEditor(e))).toEqual(d);
    expect(documentoParaMarkdown(lerDocumento(jsonDoEditor(e))!)).toBe(MD);
    e.destroy();
  });

  it("tabela no começo do documento: há onde pôr o cursor antes, e o parágrafo vazio não entra no Markdown", () => {
    const d = markdownParaDocumento("| a |\n| --- |");
    const e = editorCom(documentoParaEditor(d));
    expect(e.state.doc.firstChild?.type.name).toBe("paragraph");
    expect(lerDocumento(jsonDoEditor(e))).toEqual(d);
    e.destroy();
  });

  it("jsonDoEditor: atributos da linha e da célula viram objetos simples (server action descarta protótipo nulo)", () => {
    const e = editorCom(markdownParaDocumento(MD));
    const bruto = (e.getJSON().content as { type: string; content: { attrs: object; content: { attrs: object }[] }[] }[]).find((b) => b.type === "table")!;
    expect(Object.getPrototypeOf(bruto.content[1].attrs)).toBeNull();
    expect(Object.getPrototypeOf(bruto.content[1].content[0].attrs)).toBeNull();
    const json = jsonDoEditor(e);
    const protos: unknown[] = [];
    const visitar = (v: unknown) => {
      if (v && typeof v === "object") {
        if (!Array.isArray(v)) protos.push(Object.getPrototypeOf(v));
        Object.values(v).forEach(visitar);
      }
    };
    visitar(json);
    expect(protos.every((p) => p === Object.prototype)).toBe(true);
    e.destroy();
  });

  it("inserir: tabela vazia 3×3 com cabeçalho, no lugar do parágrafo vazio ou depois do bloco, com o cursor na 1ª célula; continua após salvar", () => {
    const e = editorCom({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "texto" }] }] });
    e.commands.setTextSelection(2);
    inserirTabela(e);
    expect(e.state.doc.child(1).type.name).toBe("table");
    expect(e.state.doc.child(0).textContent).toBe("texto");
    expect(posicaoNaTabela(e.state)).toEqual({ linha: 0, coluna: 0, linhas: 3, colunas: 3, total: false });
    const salvo = lerDocumento(jsonDoEditor(e))!;
    const md = documentoParaMarkdown(salvo);
    expect(md).toContain("|  |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |");
    expect(markdownParaDocumento(md).content.find((b) => b.type === "table")).toBeTruthy();
    e.destroy();

    const vazio = editorCom({ type: "doc", content: [{ type: "paragraph" }] });
    inserirTabela(vazio);
    expect(vazio.state.doc.child(0).type.name).toBe("table");
    vazio.destroy();
  });

  it("adicionar e remover linha e coluna; o Markdown acompanha", () => {
    const e = editorCom(markdownParaDocumento(MD));
    cursorEm(e, "Site");
    expect(e.commands.addRowAfter()).toBe(true);
    expect(lido(e)).toContain("| **Site** | *R$ 10* |\n|  |  |\n| <!-- total --> Total");
    expect(e.commands.addColumnAfter()).toBe(true);
    expect(lido(e).split("\n")[2]).toBe("| Item |  | Valor |");
    expect(e.commands.goToNextCell()).toBe(true);
    expect(e.commands.deleteColumn()).toBe(true);
    expect(lido(e).split("\n")[2]).toBe("| Item | Valor |");
    cursorEm(e, "Total");
    e.commands.goToPreviousCell();
    expect(e.commands.deleteRow()).toBe(true);
    expect(lido(e)).toBe(MD);
    e.destroy();
  });

  it("marcar total: liga e desliga, nunca no cabeçalho, e a marca sobrevive a linha nova perto dela", () => {
    const e = editorCom(markdownParaDocumento(MD));
    cursorEm(e, "Site");
    expect(alternarTotal(e)).toBe(true);
    expect(lido(e)).toContain("| <!-- total --> **Site** |");
    expect(alternarTotal(e)).toBe(true);
    expect(lido(e)).toBe(MD);
    cursorEm(e, "Item");
    expect(alternarTotal(e)).toBe(false);
    cursorEm(e, "Total");
    e.commands.addRowBefore();
    expect(lido(e)).toContain("|  |  |\n| <!-- total --> Total | a\\|b |");
    e.destroy();
  });

  it("linha e coluna novas levam o cursor junto: remover em seguida tira a nova, e não a de antes", () => {
    const e = editorCom(markdownParaDocumento("| a | b |\n| --- | --- |\n| c | d |\n| e | f |"));
    cursorEm(e, "d");
    expect(adicionarNaTabela(e, "abaixo")).toBe(true);
    expect(posicaoNaTabela(e.state)).toMatchObject({ linha: 2, coluna: 1, linhas: 4 });
    expect(e.commands.deleteRow()).toBe(true);
    expect(lido(e)).toBe("| a | b |\n| --- | --- |\n| c | d |\n| e | f |");
    cursorEm(e, "e");
    adicionarNaTabela(e, "acima");
    expect(posicaoNaTabela(e.state)).toMatchObject({ linha: 2, coluna: 0, linhas: 4 });
    e.commands.deleteRow();
    cursorEm(e, "c");
    adicionarNaTabela(e, "direita");
    expect(posicaoNaTabela(e.state)).toMatchObject({ linha: 1, coluna: 1, colunas: 3 });
    e.commands.deleteColumn();
    cursorEm(e, "d");
    adicionarNaTabela(e, "esquerda");
    expect(posicaoNaTabela(e.state)).toMatchObject({ linha: 1, coluna: 1, colunas: 3 });
    e.commands.deleteColumn();
    expect(lido(e)).toBe("| a | b |\n| --- | --- |\n| c | d |\n| e | f |");
    cursorEm(e, "a");
    expect(adicionarNaTabela(e, "acima")).toBe(false);
    e.destroy();
  });

  it("primeira linha é sempre o cabeçalho: remover promove a segunda, sem marca de total", () => {
    const e = editorCom(markdownParaDocumento("| a |\n| --- |\n| <!-- total --> b |"));
    cursorEm(e, "a");
    expect(e.commands.deleteRow()).toBe(true);
    const tabela = e.state.doc.child(0);
    expect(tabela.child(0).child(0).type.name).toBe("tableHeader");
    expect(tabela.child(0).attrs.total).toBe(false);
    expect(lido(e)).toBe("| b |\n| --- |");
    e.destroy();
  });

  it("linha acima do cabeçalho não fica: quem é cabeçalho é sempre a primeira", () => {
    const e = editorCom(markdownParaDocumento("| a |\n| --- |\n| b |"));
    cursorEm(e, "a");
    e.commands.addRowBefore();
    const tabela = e.state.doc.child(0);
    expect(tabela.child(0).child(0).type.name).toBe("tableHeader");
    expect(tabela.child(1).child(0).type.name).toBe("tableCell");
    e.destroy();
  });

  it("Tab anda entre células e, na última, cria linha", () => {
    const e = editorCom(markdownParaDocumento("| a | b |\n| --- | --- |"));
    cursorEm(e, "a");
    const { view } = e;
    const tecla = (key: string, shiftKey = false) => view.someProp("handleKeyDown", (f) => f(view, new KeyboardEvent("keydown", { key, shiftKey })));
    tecla("Tab");
    expect(posicaoNaTabela(e.state)?.coluna).toBe(1);
    tecla("Tab");
    expect(posicaoNaTabela(e.state)).toMatchObject({ linha: 1, coluna: 0, linhas: 2 });
    e.destroy();
  });

  it("atalhos de teclado fazem o mesmo que a barra", () => {
    const e = editorCom(markdownParaDocumento("| a | b |\n| --- | --- |\n| c | d |"));
    cursorEm(e, "c");
    const { view } = e;
    const tecla = (key: string) => view.someProp("handleKeyDown", (f) => f(view, new KeyboardEvent("keydown", { key, altKey: true, shiftKey: true })));
    tecla("ArrowDown");
    expect(posicaoNaTabela(e.state)?.linhas).toBe(3);
    tecla("ArrowRight");
    expect(posicaoNaTabela(e.state)?.colunas).toBe(3);
    tecla("t");
    expect(posicaoNaTabela(e.state)?.total).toBe(true);
    tecla("Delete");
    expect(posicaoNaTabela(e.state)?.colunas).toBe(2);
    tecla("Backspace");
    expect(posicaoNaTabela(e.state)?.linhas).toBe(2);
    e.destroy();
  });

  it("célula só com texto: Enter não abre parágrafo; título, lista e linha horizontal não entram", () => {
    const e = editorCom(markdownParaDocumento("| abc |\n| --- |"));
    cursorEm(e, "abc");
    e.commands.enter();
    expect(e.state.doc.child(0).child(0).child(0).childCount).toBe(1);
    expect(e.commands.toggleHeading({ level: 1 })).toBe(false);
    e.commands.toggleBulletList();
    expect(e.commands.setHorizontalRule()).toBe(false);
    expect(lido(e)).toBe("| abc |\n| --- |");
    expect(e.schema.nodes.tableCell.contentMatch.matchType(e.schema.nodes.heading)).toBeFalsy();
    e.destroy();
  });

  it("digitar '--- ' ou '# ' na célula não quebra nem vira bloco", () => {
    const e = editorCom(markdownParaDocumento("| a |\n| --- |"));
    cursorEm(e, "a");
    const { view } = e;
    e.commands.setTextSelection(e.state.selection.from + 1);
    e.commands.deleteRange({ from: e.state.selection.from - 1, to: e.state.selection.from });
    for (const t of ["-", "-", "-", " ", "#", " "]) {
      const { from, to } = view.state.selection;
      if (!view.someProp("handleTextInput", (f) => f(view, from, to, t, () => view.state.tr))) view.dispatch(view.state.tr.insertText(t, from, to));
    }
    expect(e.state.doc.childCount).toBe(2); // a tabela e o parágrafo do fim: a linha não partiu a tabela
    expect(e.state.doc.child(0).child(0).child(0).child(0).type.name).toBe("paragraph");
    expect(lerDocumento(jsonDoEditor(e))).not.toBeNull();
    e.destroy();
  });

  it("tabela só no nível de cima: a lista não aceita", () => {
    const e = editorCom({ type: "doc", content: [texto("a")] });
    expect(e.schema.nodes.listItem.contentMatch.matchType(e.schema.nodes.table)).toBeFalsy();
    expect(e.schema.nodes.doc.contentMatch.matchType(e.schema.nodes.table)).toBeTruthy();
    e.destroy();
  });

  it("colar tabela de fora: colspan e alinhamento não entram, e o documento continua válido", () => {
    const e = editorCom('<table><tr><th colspan="2" style="text-align:right" align="right">a</th></tr><tr><td>b</td><td data-total="true">c</td></tr></table>');
    const json = JSON.stringify(e.getJSON());
    expect(json).not.toMatch(/"colspan":2|align|style/);
    expect(json).toContain("a");
    expect(lerDocumento(jsonDoEditor(e))).not.toBeNull();
    e.destroy();
  });

  it("colar vários parágrafos na célula junta o texto, sem perder nada", () => {
    const e = editorCom(markdownParaDocumento("| a |\n| --- |"));
    cursorEm(e, "a");
    e.commands.setTextSelection(e.state.selection.from + 1);
    const { paragraph } = e.schema.nodes;
    const trecho = new Slice(Fragment.from([paragraph.create(null, e.schema.text("um")), paragraph.create(null, e.schema.text("dois"))]), 1, 1);
    const { view } = e;
    expect(view.someProp("handlePaste", (f) => f(view, new Event("paste") as ClipboardEvent, trecho))).toBe(true);
    expect(lido(e)).toBe("| aum dois |\n| --- |");
    e.destroy();
  });

  it("limites: a edição que passaria é recusada, com aviso, e o documento continua válido", () => {
    const larga = `| ${Array.from({ length: TABELA_COLUNAS_MAX }, (_, i) => `c${i}`).join(" | ")} |\n| ${Array.from({ length: TABELA_COLUNAS_MAX }, () => "---").join(" | ")} |`;
    const e = editorCom(markdownParaDocumento(larga));
    const avisos: string[] = [];
    (e.storage as unknown as { tabelaGarantias: { aoRecusar: (m: string) => void } }).tabelaGarantias.aoRecusar = (m) => avisos.push(m);
    cursorEm(e, "c0");
    e.commands.addColumnAfter();
    expect(e.state.doc.child(0).child(0).childCount).toBe(TABELA_COLUNAS_MAX);
    expect(avisos[0]).toContain(`${TABELA_COLUNAS_MAX} colunas`);
    e.destroy();

    const alta = editorCom(markdownParaDocumento(["| a |", "| --- |", ...Array.from({ length: TABELA_LINHAS_MAX - 1 }, () => "| b |")].join("\n")));
    cursorEm(alta, "a");
    alta.commands.addRowAfter();
    expect(alta.state.doc.child(0).childCount).toBe(TABELA_LINHAS_MAX);
    alta.destroy();

    const cheia = editorCom(markdownParaDocumento(`| ${"x".repeat(CELULA_MAX)} |\n| --- |`));
    cursorEm(cheia, "x");
    cheia.view.dispatch(cheia.state.tr.insertText("y"));
    expect(cheia.state.doc.child(0).textContent).toHaveLength(CELULA_MAX);
    cheia.destroy();
  });

  it("tabela torta colada com mais colunas que o limite é recusada inteira (colspan vira 1; a conta é pelo máximo entre as linhas)", () => {
    const e = editorCom({ type: "doc", content: [texto("a")] });
    const avisos: string[] = [];
    (e.storage as unknown as { tabelaGarantias: { aoRecusar: (m: string) => void } }).tabelaGarantias.aoRecusar = (m) => avisos.push(m);
    const tabelas = () => e.state.doc.content.content.filter((b) => b.type.name === "table").length;
    const n = TABELA_COLUNAS_MAX + 2;
    const linha = `<tr>${Array.from({ length: n }, (_, i) => `<td>c${i}</td>`).join("")}</tr>`;
    // Excel/Sheets: 1ª linha é um título mesclado sobre todas as colunas, as outras têm n células.
    // jsdom não tem ClipboardEvent: o evento é só para o `handlePaste`.
    const colar = (html: string) => e.view.pasteHTML(html, new Event("paste") as ClipboardEvent);
    colar(`<table><tr><td colspan="${n}">Título</td></tr>${linha}${linha}</table>`);
    expect(tabelas()).toBe(0);
    expect(e.state.doc.childCount).toBe(1);
    expect(avisos[0]).toContain(`${TABELA_COLUNAS_MAX} colunas`);
    expect(lerDocumento(jsonDoEditor(e))).not.toBeNull();

    // O mesmo por JSON: 1ª linha com 1 célula e a 2ª com 9.
    const celula = (t: string) => ({ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });
    e.commands.insertContent({
      type: "table",
      content: [
        { type: "tableRow", content: [celula("só uma")] },
        { type: "tableRow", content: Array.from({ length: TABELA_COLUNAS_MAX + 1 }, (_, i) => celula(`d${i}`)) },
      ],
    });
    expect(tabelas()).toBe(0);
    expect(lerDocumento(jsonDoEditor(e))).not.toBeNull();

    // 1ª linha no limite e outra uma a mais: idem.
    e.commands.insertContent({
      type: "table",
      content: [
        { type: "tableRow", content: Array.from({ length: TABELA_COLUNAS_MAX }, (_, i) => celula(`h${i}`)) },
        { type: "tableRow", content: Array.from({ length: TABELA_COLUNAS_MAX + 1 }, (_, i) => celula(`d${i}`)) },
      ],
    });
    expect(tabelas()).toBe(0);
    expect(lerDocumento(jsonDoEditor(e))).not.toBeNull();

    // Tabela torta dentro do limite entra, completada pelo `fixTables`, e o documento continua válido.
    colar('<table><tr><td colspan="3">Título</td></tr><tr><td>1</td><td>2</td><td>3</td></tr></table>');
    expect(tabelas()).toBe(1);
    const d = lerDocumento(jsonDoEditor(e))!;
    expect(d).not.toBeNull();
    expect(d.content.find((b) => b.type === "table")).toMatchObject({ content: [{ content: [{}, {}, {}] }, { content: [{}, {}, {}] }] });
    e.destroy();
  });

  it("texto plano do editor bate com o do servidor, e a âncora em célula é a mesma; célula vazia não conta", () => {
    const d = markdownParaDocumento("Antes.\n\n| Item |  |\n| --- | --- |\n| a\\|b | fim |\n\nDepois.");
    const e = editorCom(documentoParaEditor(d));
    expect(planoDoEditor(e.state.doc).texto).toBe(textoPlano(d).texto);
    cursorEm(e, "a|b");
    const de = e.state.selection.from;
    e.commands.setTextSelection({ from: de, to: de + 3 });
    const a = ancoraDaSelecao(e.state)!;
    expect(a.trecho).toBe("a|b");
    const { texto } = textoPlano(d);
    expect(a).toEqual(criarAncora(texto, texto.indexOf("a|b"), texto.indexOf("a|b") + 3));
    e.destroy();
  });

  it("destaque de comentário em célula aparece no editor, e o documento não muda", () => {
    const d = markdownParaDocumento("| Item |\n| --- |\n| comentado aqui |");
    const e = new Editor({ extensions: [...EXTENSOES, DestaquesComentarios], content: d });
    const { texto } = textoPlano(d);
    const ancora = criarAncora(texto, texto.indexOf("comentado"), texto.indexOf("comentado") + 9)!;
    e.view.dispatch(e.state.tr.setMeta(chaveDestaques, { destaques: [{ id: "c1", ancora }], ativo: null }));
    expect(e.view.dom.querySelector("td [data-comentario='c1']")?.textContent).toBe("comentado");
    expect(lerDocumento(jsonDoEditor(e))?.content[0]).toEqual(d.content[0]);
    e.destroy();
  });
});

describe("tabela na leitura (GAB-102)", () => {
  const d = markdownParaDocumento("| **Item** | Valor |\n| --- | --- |\n| *Site* | a\\|b |\n| <!-- total --> Total | <script>x</script> |");

  it("cabeçalho, marcas e linha de total iguais ao editor; texto sempre escapado", () => {
    render(<DocumentoView documento={d} />);
    expect(screen.getByRole("columnheader", { name: "Item" }).querySelector("strong")).not.toBeNull();
    expect(screen.getByText("Site").tagName).toBe("EM");
    expect(screen.getByText("a|b")).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Total/ })).toHaveClass("total");
    expect(screen.getByText("<script>x</script>")).toBeInTheDocument();
    expect(document.querySelector("table script")).toBeNull();
    expect(document.querySelector("table")).toHaveClass("tabela-livre");
    expect(document.querySelectorAll("colgroup col")).toHaveLength(2);
    expect(document.querySelector(".tabela-rolagem table")).not.toBeNull();
  });

  it("anotada: offsets e destaque em célula, para quem lê poder comentar", () => {
    const { texto } = textoPlano(d);
    const i = texto.indexOf("Site");
    render(<DocumentoView documento={d} destaques={[{ id: "c1", inicio: i, fim: i + 4 }]} />);
    expect(document.querySelector("td mark[data-comentario='c1']")?.textContent).toBe("Site");
    expect(document.querySelector(`td [data-o='${texto.indexOf("a|b")}']`)?.textContent).toBe("a|b");
  });
});

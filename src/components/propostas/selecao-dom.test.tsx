import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { textoPlano } from "@/lib/propostas/ancora";
import type { Documento } from "@/lib/propostas/documento";
import { markdownParaDocumento } from "@/lib/propostas/markdown";
import { DocumentoView } from "./documento-view";
import { ancoraDaSelecaoDom } from "./selecao-dom";

const doc: Documento = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Escopo" }] },
    { type: "paragraph", content: [{ type: "text", text: "Site " }, { type: "text", text: "com loja", marks: [{ type: "bold" }] }, { type: "text", text: " e blog." }] },
  ],
};
const plano = textoPlano(doc).texto;

function selecionar(inicio: [Node, number], fim: [Node, number]) {
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  const r = document.createRange();
  r.setStart(...inicio);
  r.setEnd(...fim);
  sel.addRange(r);
  return sel;
}

const textoDe = (el: Element) => {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  return w.nextNode()!;
};

describe("DocumentoView com destaques: realce só visual", () => {
  it("trecho comentado vira <mark data-comentario>; o resto fica igual", () => {
    const f = plano.indexOf("com loja");
    render(<DocumentoView documento={doc} destaques={[{ id: "c1", inicio: f, fim: f + 3 }]} ativo="c1" />);
    const m = document.querySelector("mark[data-comentario='c1']")!;
    expect(m.textContent).toBe("com");
    expect(m.className).toContain("comentario-destaque-ativo");
    expect(screen.getByTestId("documento-proposta").textContent).toBe("EscopoSite com loja e blog.");
  });

  it("sem destaques: nenhum span de offset (versões, diff)", () => {
    render(<DocumentoView documento={doc} />);
    expect(document.querySelector("[data-o]")).toBeNull();
  });
});

describe("ancoraDaSelecaoDom: seleção do leitor → âncora no texto plano", () => {
  it("seleção dentro do negrito", () => {
    render(<DocumentoView documento={doc} destaques={[]} />);
    const raiz = screen.getByTestId("documento-proposta");
    const negrito = textoDe(raiz.querySelector("strong")!);
    const sel = selecionar([negrito, 0], [negrito, 8]);
    expect(ancoraDaSelecaoDom(raiz, plano, sel)).toEqual({ trecho: "com loja", antes: "Escopo\nSite ", depois: " e blog.\n\uE001\n\uE002" });
  });

  it("seleção atravessando o título e o parágrafo", () => {
    render(<DocumentoView documento={doc} destaques={[]} />);
    const raiz = screen.getByTestId("documento-proposta");
    const titulo = textoDe(raiz.querySelector("h2")!);
    const site = textoDe(raiz.querySelector("p")!);
    expect(ancoraDaSelecaoDom(raiz, plano, selecionar([titulo, 3], [site, 4]))?.trecho).toBe("opo\nSite");
  });

  it("seleção vazia ou fora do texto → null", () => {
    render(
      <div>
        <p data-testid="fora">fora</p>
        <DocumentoView documento={doc} destaques={[]} />
      </div>,
    );
    const raiz = screen.getByTestId("documento-proposta");
    const fora = textoDe(screen.getByTestId("fora"));
    expect(ancoraDaSelecaoDom(raiz, plano, selecionar([fora, 0], [fora, 2]))).toBeNull();
    const t = textoDe(raiz.querySelector("p")!);
    expect(ancoraDaSelecaoDom(raiz, plano, selecionar([t, 1], [t, 1]))).toBeNull();
  });
});

describe("seleção em tabela (GAB-102)", () => {
  it("dentro da célula e atravessando células dá a mesma âncora do texto plano", () => {
    const d = markdownParaDocumento("Antes.\n\n| Item | a\\|b |\n| --- | --- |\n|  | fim |");
    const { texto } = textoPlano(d);
    const { container } = render(<DocumentoView documento={d} destaques={[]} />);
    const pedaco = (t: string) => [...container.querySelectorAll("[data-o]")].find((e) => e.textContent === t)!;
    const selecionar = (de: Element, ate: Element) => {
      const r = document.createRange();
      r.setStart(de.firstChild!, 0);
      r.setEnd(ate.firstChild!, ate.textContent!.length);
      const s = window.getSelection()!;
      s.removeAllRanges();
      s.addRange(r);
    };
    selecionar(pedaco("a|b"), pedaco("a|b"));
    expect(ancoraDaSelecaoDom(container, texto)?.trecho).toBe("a|b");
    selecionar(pedaco("Item"), pedaco("fim"));
    expect(ancoraDaSelecaoDom(container, texto)?.trecho).toBe("Item\na|b\nfim");
  });
});

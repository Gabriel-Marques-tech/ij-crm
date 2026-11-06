import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Documento } from "@/lib/propostas/documento";

vi.mock("./comentarios-actions", () => ({}));

const { ComentariosProvider, TextoComentavel } = await import("./comentarios-contexto");
const { ComentarNaFolha } = await import("./comentar-na-folha");
const { PainelComentarios } = await import("./painel-comentarios");

const doc: Documento = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Prazo de 30 dias." }] },
    { type: "paragraph", content: [{ type: "text", text: "Segundo bloco." }] },
    { type: "blocoDados", attrs: { tipo: "cronograma" } },
  ],
};

function montar() {
  return render(
    <ComentariosProvider projetoId="p1" euId="u1" inicial={{ versao: "1.1", threads: [] }}>
      <ComentarNaFolha larga>
        <div data-folha>
          <TextoComentavel documento={doc} dados={{ valor: null, prazoDias: null, escopoResumo: null, entregas: [] }} />
        </div>
        <p>Fora da folha</p>
      </ComentarNaFolha>
      <PainelComentarios />
    </ComentariosProvider>,
  );
}

function selecionar(texto: string) {
  const no = [...document.querySelectorAll("[data-o]")].find((e) => e.textContent?.includes(texto))!.firstChild!;
  const i = no.textContent!.indexOf(texto);
  const r = document.createRange();
  r.setStart(no, i);
  r.setEnd(no, i + texto.length);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(r);
  Range.prototype.getBoundingClientRect = () => ({ top: 300, bottom: 320, left: 100, width: 50 }) as DOMRect;
}

const mudouSelecao = () => act(async () => {
  document.dispatchEvent(new Event("selectionchange"));
  await vi.advanceTimersByTimeAsync(200);
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ versao: "1.1" })))));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.getSelection()?.removeAllRanges();
});

describe("+ da linha", () => {
  it("aparece no bloco sob o mouse e cita o bloco inteiro; fora da folha, some", () => {
    montar();
    expect(screen.queryByRole("button", { name: "Comentar esta linha" })).toBeNull();
    fireEvent.mouseMove(screen.getByText("Segundo bloco."));
    fireEvent.click(screen.getByRole("button", { name: "Comentar esta linha" }));
    expect(screen.getByText("“Segundo bloco.”")).toBeTruthy();
    fireEvent.mouseMove(screen.getByText("Fora da folha"));
    expect(screen.queryByRole("button", { name: "Comentar esta linha" })).toBeNull();
  });

  it("bloco de dados comenta o bloco; digitar tira o + da frente", () => {
    montar();
    fireEvent.mouseMove(document.querySelector("[data-bloco=cronograma] h2")!);
    fireEvent.click(screen.getByRole("button", { name: "Comentar esta linha" }));
    expect(screen.getByText("“Cronograma”")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sugerir texto" })).toBeNull();
    fireEvent.keyDown(document, { key: "a" });
    expect(screen.queryByRole("button", { name: "Comentar esta linha" })).toBeNull();
  });
});

describe("balão da seleção", () => {
  it("selecionar na folha mostra Comentar e Sugerir; Sugerir abre o texto novo; soltar a seleção some", async () => {
    montar();
    selecionar("30 dias");
    await mudouSelecao();
    const balao = screen.getByRole("toolbar", { name: "Comentar a seleção" });
    expect(balao.textContent).toContain("Comentar");
    fireEvent.click(screen.getByRole("button", { name: "Sugerir" }));
    expect((screen.getByLabelText("Texto novo do trecho") as HTMLTextAreaElement).value).toBe("30 dias");
    window.getSelection()!.removeAllRanges();
    await mudouSelecao();
    expect(screen.queryByRole("toolbar", { name: "Comentar a seleção" })).toBeNull();
  });

  it("não aparece durante o arraste, e aparece ao soltar; Esc dispensa", async () => {
    montar();
    fireEvent.pointerDown(document.body, { pointerType: "mouse" });
    selecionar("30 dias");
    await mudouSelecao();
    expect(screen.queryByRole("toolbar", { name: "Comentar a seleção" })).toBeNull();
    fireEvent.pointerUp(document.body);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(screen.getByRole("toolbar", { name: "Comentar a seleção" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("toolbar", { name: "Comentar a seleção" })).toBeNull();
  });

  it("seleção fora da folha não mostra o balão", async () => {
    montar();
    const no = screen.getByText("Fora da folha").firstChild!;
    const r = document.createRange();
    r.selectNodeContents(no);
    window.getSelection()!.addRange(r);
    await mudouSelecao();
    expect(screen.queryByRole("toolbar", { name: "Comentar a seleção" })).toBeNull();
  });
});

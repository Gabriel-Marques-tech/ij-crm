import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarcarQuadroAtivo, QuadroAtivoProvider, useQuadroAtivo } from "./quadro-ativo";

function Mostrar() {
  return <p data-testid="quadro">{useQuadroAtivo() ?? "nenhum"}</p>;
}

describe("quadro ativo declarado pela página", () => {
  it("o detalhe do card declara o quadro; ao sair, some", () => {
    const { rerender } = render(
      <QuadroAtivoProvider>
        <Mostrar />
        <MarcarQuadroAtivo quadro="projetos" />
      </QuadroAtivoProvider>,
    );
    expect(screen.getByTestId("quadro")).toHaveTextContent("projetos");
    rerender(
      <QuadroAtivoProvider>
        <Mostrar />
      </QuadroAtivoProvider>,
    );
    expect(screen.getByTestId("quadro")).toHaveTextContent("nenhum");
  });
});

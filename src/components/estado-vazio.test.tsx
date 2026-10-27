import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EstadoVazio } from "./estado-vazio";

describe("EstadoVazio", () => {
  it("mostra título, texto e o mascote decorativo (alt vazio, fora da árvore de acessibilidade)", () => {
    const { container } = render(<EstadoVazio mascote="relax" titulo="Tudo em dia por aqui" texto="Nada vencido." />);
    expect(screen.getByText("Tudo em dia por aqui")).toBeInTheDocument();
    expect(screen.getByText("Nada vencido.")).toBeInTheDocument();
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("alt", "");
    expect(img?.getAttribute("src")).toContain("mascote-relax");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("reserva o espaço da imagem na proporção do arquivo (sem layout shift)", () => {
    const { container } = render(<EstadoVazio mascote="cabeca" titulo="Vazio" tamanho="sm" />);
    const img = container.querySelector("img");
    // mascote-cabeca: 265×210 → 96 px de altura = 121 px de largura.
    expect(img).toHaveAttribute("height", "96");
    expect(img).toHaveAttribute("width", "121");
  });

  it("ação é opcional", () => {
    const { rerender } = render(<EstadoVazio mascote="cabeca" titulo="Vazio" />);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<EstadoVazio mascote="cabeca" titulo="Vazio" acao={<button type="button">Limpar filtros</button>} />);
    expect(screen.getByRole("button", { name: "Limpar filtros" })).toBeInTheDocument();
  });
});

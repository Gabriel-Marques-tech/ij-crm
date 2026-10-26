import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ErroCarregamento } from "./erro-carregamento";

describe("ErroCarregamento", () => {
  it("mostra a ref (mono) para o usuário repassar", () => {
    render(<ErroCarregamento codigo="a1b2c3d4" />);
    expect(screen.getByRole("alert").textContent).toContain("Não deu para carregar esta página");
    expect(screen.getByText("a1b2c3d4").className).toContain("font-mono");
  });
});

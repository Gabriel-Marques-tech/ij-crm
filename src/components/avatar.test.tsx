import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Avatar, iniciais, urlFoto } from "./avatar";

describe("Avatar", () => {
  it("sem foto → iniciais, nenhum <img>", () => {
    const { container } = render(<Avatar nome="Ana Maria Souza" usuarioId="u1" fotoEm={null} />);
    expect(screen.getByRole("img", { name: "Ana Maria Souza" }).textContent).toBe("AS");
    expect(container.querySelector("img")).toBeNull();
  });

  it("com foto → <img> com cache-bust pela versão; erro de carga → iniciais", () => {
    const { container } = render(<Avatar nome="Ana" usuarioId="u1" fotoEm={1_700_000_000_000} tamanho="lg" />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(urlFoto("u1", 1_700_000_000_000));
    expect(img.getAttribute("src")).toMatch(/^\/api\/usuarios\/u1\/foto\?v=[0-9a-z]+$/);
    fireEvent.error(img);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("img", { name: "Ana" }).textContent).toBe("A");
  });

  it("iniciais de nome vazio", () => {
    expect(iniciais("   ")).toBe("?");
  });
});

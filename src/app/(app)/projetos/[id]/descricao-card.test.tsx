import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DescricaoCard } from "./descricao-card";

const { editarCampoAction } = vi.hoisted(() => ({ editarCampoAction: vi.fn() }));
vi.mock("../../kanban/actions", () => ({ editarCampoAction }));

beforeEach(() => {
  editarCampoAction.mockReset();
  editarCampoAction.mockResolvedValue({ ok: true });
});

describe("DescricaoCard", () => {
  it("vazio: convida a adicionar", () => {
    render(<DescricaoCard cardId="c1" valor={null} />);
    expect(screen.getByRole("button", { name: /Sem descrição — clique para adicionar/ })).toBeInTheDocument();
  });

  it("mostra o texto puro, mantendo as quebras de linha (sem HTML/markdown)", () => {
    const { container } = render(<DescricaoCard cardId="c1" valor={"**linha 1**\n<script>alert(1)</script>"} />);
    const texto = screen.getByTestId("descricao-texto");
    expect(texto.textContent).toBe("**linha 1**\n<script>alert(1)</script>");
    expect(texto).toHaveClass("whitespace-pre-wrap");
    expect(container.querySelector("script, strong")).toBeNull();
  });

  it("clique edita num textarea multilinha e salva pela action de campo", async () => {
    render(<DescricaoCard cardId="c1" valor="antes" />);
    fireEvent.click(screen.getByTestId("descricao-texto"));
    const campo = screen.getByRole("textbox", { name: "Descrição" });
    expect(campo.tagName).toBe("TEXTAREA");
    expect(campo).toHaveAttribute("maxLength", "5000");
    fireEvent.change(campo, { target: { value: "linha 1\nlinha 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(editarCampoAction).toHaveBeenCalledWith("c1", "descricao", "linha 1\nlinha 2"));
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  });

  it("Esc cancela sem salvar; erro da action aparece e mantém a edição", async () => {
    render(<DescricaoCard cardId="c1" valor="antes" />);
    fireEvent.click(screen.getByTestId("descricao-texto"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(editarCampoAction).not.toHaveBeenCalled();

    editarCampoAction.mockResolvedValue({ erro: "Descrição: no máximo 5000 caracteres." });
    fireEvent.click(screen.getByTestId("descricao-texto"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "novo" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText(/no máximo 5000 caracteres/)).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });
});

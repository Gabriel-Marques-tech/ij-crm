import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TelaDeErro } from "./tela-de-erro";

function erroDoServidor(digest: string) {
  // Em produção o Next troca a mensagem por uma genérica; o digest é a ref logada no servidor.
  return Object.assign(new Error("Prisma P1001 senha=segredo"), { digest });
}

describe("TelaDeErro (error.tsx / global-error.tsx)", () => {
  it("mostra o digest como ref (mono), sem mensagem nem stack", () => {
    const { container } = render(<TelaDeErro error={erroDoServidor("2338718455")} retry={() => {}} />);
    expect(screen.getByRole("alert").textContent).toContain("Não deu para carregar esta página");
    expect(screen.getByText("2338718455").className).toContain("font-mono");
    expect(container.textContent).not.toContain("segredo");
    expect(container.textContent).not.toContain("Prisma");
  });

  it("'Tentar de novo' chama retry", () => {
    const retry = vi.fn();
    render(<TelaDeErro error={erroDoServidor("1")} retry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("erro do cliente (sem digest, ou nem Error) → mensagem sem ref", () => {
    const { container } = render(<TelaDeErro error="quebrou" retry={() => {}} />);
    expect(screen.getByRole("alert").textContent).toContain("Não deu para carregar esta página");
    expect(container.textContent).not.toContain("ref:");
    expect(container.textContent).not.toContain("quebrou");
  });
});

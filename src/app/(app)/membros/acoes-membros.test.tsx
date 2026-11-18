import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/gg/actions", () => ({ ligarContasAction: vi.fn(), criarMembroAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { AcoesMembros } = await import("./acoes-membros");

/** GAB-105/106: conta do CRM nasce no formulário único (Cadastrar pessoa); o "Novo membro" (sem conta) é do editor de G&G. */
describe("Membros: Novo membro do editor de G&G", () => {
  it("editor que é da gestão: Novo membro e ligar contas, sem atalho para a Gestão (o cadastro está na página)", () => {
    render(<AcoesMembros editor gestao />);
    expect(screen.getByRole("button", { name: "Novo membro" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ligar contas pelo e-mail" })).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText(/a conta é criada por gestor ou admin/)).toBeNull();
  });

  it("editor de G&G que não é gestor: Novo membro com o aviso de que conta é com a gestão", () => {
    render(<AcoesMembros editor gestao={false} />);
    expect(screen.getByText(/a conta é criada por gestor ou admin/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Novo membro" }));
    expect(screen.getByRole("dialog").textContent).toMatch(/Sem conta do CRM/);
    expect(screen.getByLabelText("Nome")).toBeTruthy();
  });

  it("quem não edita G&G: nada", () => {
    render(<AcoesMembros editor={false} gestao />);
    expect(screen.queryByRole("button", { name: "Novo membro" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ligar contas pelo e-mail" })).toBeNull();
  });
});

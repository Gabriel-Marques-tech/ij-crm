import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({ ligarContasAction: vi.fn(), criarMembroAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { AcoesMembros } = await import("./acoes-membros");

/** GAB-105: conta do CRM nasce na Gestão; o "Novo membro" (sem conta) segue para quem edita G&G. */
describe("G&G → Membros: Novo membro e atalho para a Gestão", () => {
  it("editor que é da gestão: Novo membro, ligar contas e o atalho para Gestão → Usuários", () => {
    render(<AcoesMembros editor gestao />);
    expect(screen.getByRole("link", { name: /Cadastrar em Gestão → Usuários/ }).getAttribute("href")).toBe("/gestao/usuarios");
    expect(screen.getByRole("button", { name: "Novo membro" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ligar contas pelo e-mail" })).toBeTruthy();
  });

  it("editor de G&G que não é gestor: Novo membro com o texto e o link para a Gestão", () => {
    render(<AcoesMembros editor gestao={false} />);
    expect(screen.getByText(/sem conta do CRM; para criar conta use/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Gestão → Usuários" }).getAttribute("href")).toBe("/gestao/usuarios");
    fireEvent.click(screen.getByRole("button", { name: "Novo membro" }));
    expect(screen.getByRole("dialog").textContent).toMatch(/Sem conta do CRM; para criar conta use/);
    expect(screen.getByLabelText("Nome")).toBeTruthy();
  });

  it("gestor que não edita G&G: só o atalho (sem Novo membro nem ligar contas)", () => {
    render(<AcoesMembros editor={false} gestao />);
    expect(screen.queryByRole("button", { name: "Novo membro" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ligar contas pelo e-mail" })).toBeNull();
    expect(screen.getByRole("link", { name: /Cadastrar em Gestão → Usuários/ })).toBeTruthy();
  });
});

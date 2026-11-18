import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({ ligarContasAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { AcoesMembros } = await import("./acoes-membros");

/** GAB-105: pessoa nova é cadastrada na Gestão; o G&G só aponta para lá. */
describe("G&G → Membros: cadastro aponta para a Gestão", () => {
  it("gestão vê o atalho para Gestão → Usuários; não há mais Novo membro", () => {
    render(<AcoesMembros editor gestao />);
    expect(screen.getByRole("link", { name: /Cadastrar em Gestão → Usuários/ }).getAttribute("href")).toBe("/gestao/usuarios");
    expect(screen.queryByRole("button", { name: "Novo membro" })).toBeNull();
    expect(screen.getByRole("button", { name: "Ligar contas pelo e-mail" })).toBeTruthy();
  });

  it("editor de G&G que não é gestor vê o texto e segue ligando contas", () => {
    render(<AcoesMembros editor gestao={false} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/a gestão cadastra em Gestão → Usuários/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ligar contas pelo e-mail" })).toBeTruthy();
  });
});

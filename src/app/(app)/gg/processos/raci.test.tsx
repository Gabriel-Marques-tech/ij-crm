import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const acoes = vi.hoisted(() => ({ criarProcessoAction: vi.fn(), definirRaciAction: vi.fn(), excluirProcessoAction: vi.fn() }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("../actions", () => acoes);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { ExcluirProcesso } from "./raci";

beforeEach(() => vi.clearAllMocks());

const abrir = () => fireEvent.click(screen.getByRole("button", { name: "Excluir processo Onboarding" }));
const confirmar = () => act(async () => fireEvent.click(screen.getByRole("button", { name: "Confirmar exclusão" })));

describe("ExcluirProcesso (GAB-110)", () => {
  it("confirma inline antes de excluir; cancelar volta sem chamar a action", async () => {
    acoes.excluirProcessoAction.mockResolvedValue({ ok: true });
    render(<ExcluirProcesso processoId="p1" nome="Onboarding" />);
    abrir();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(acoes.excluirProcessoAction).not.toHaveBeenCalled();
    abrir();
    await confirmar();
    expect(acoes.excluirProcessoAction).toHaveBeenCalledWith("p1");
    expect(refresh).toHaveBeenCalled();
  });

  it("recusa do servidor aparece na linha e não recarrega", async () => {
    acoes.excluirProcessoAction.mockResolvedValue({ erro: "Só a área de Gente & Gestão e a administração fazem isso." });
    render(<ExcluirProcesso processoId="p1" nome="Onboarding" />);
    abrir();
    await confirmar();
    expect(screen.getByText(/Só a área de Gente & Gestão/)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("falha inesperada mostra a ref do erro", async () => {
    acoes.excluirProcessoAction.mockResolvedValue({ ok: false, erro: "INESPERADO", ref: "ERR-ABC123" });
    render(<ExcluirProcesso processoId="p1" nome="Onboarding" />);
    abrir();
    await confirmar();
    expect(screen.getByText(/ERR-ABC123/)).toBeInTheDocument();
  });
});

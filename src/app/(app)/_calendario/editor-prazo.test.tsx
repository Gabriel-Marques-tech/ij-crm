import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrazoItem } from "@/lib/prazos/prazos";
import { excluirPrazoAction } from "./actions";
import { PrazosProvider, useEditorPrazo } from "./editor-prazo";

vi.mock("./actions", () => ({
  criarPrazoAction: vi.fn(),
  editarPrazoAction: vi.fn(),
  concluirPrazoAction: vi.fn(),
  excluirPrazoAction: vi.fn(async () => ({ ok: true })),
}));

const prazo: PrazoItem = {
  id: "p1",
  titulo: "Entregar proposta",
  dia: "2026-10-30",
  estado: "pendente",
  responsavel: { id: "u1", nome: "Ana Vendas", fotoEm: null },
  card: null,
  podeMexer: true,
};

function Abrir() {
  const { abrir } = useEditorPrazo();
  return (
    <button type="button" onClick={() => abrir(prazo)}>
      abrir
    </button>
  );
}

function montar() {
  render(
    <PrazosProvider eu={{ id: "u1", nome: "Ana Vendas" }} gestor={false} responsaveis={[{ id: "u1", nome: "Ana Vendas" }]} responsavelPadrao="u1">
      <Abrir />
    </PrazosProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "abrir" }));
}

beforeEach(() => vi.mocked(excluirPrazoAction).mockClear());

describe("editor de prazo: excluir com confirmação explícita", () => {
  it("Excluir só pergunta; Cancelar volta sem excluir; o aviso fica numa região aria-live", async () => {
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Excluir" }));
    const aviso = screen.getByText(/Excluir “Entregar proposta”\?/);
    expect(aviso.closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByText(/Excluir “Entregar proposta”\?/)).toBeNull();
    expect(screen.getByRole("button", { name: "Excluir" })).toBeInTheDocument();
    expect(excluirPrazoAction).not.toHaveBeenCalled();
  });

  it("confirmar chama a exclusão uma vez", async () => {
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Excluir" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Excluir prazo" }));
    });
    await waitFor(() => expect(excluirPrazoAction).toHaveBeenCalledWith("p1"));
  });
});

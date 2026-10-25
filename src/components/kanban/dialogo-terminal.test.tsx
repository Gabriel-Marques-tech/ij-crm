import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DialogoTerminal, type PedidoTerminal } from "./dialogo-terminal";

const ganho: PedidoTerminal = { titulo: "Site da padaria", faseNome: "Contrato assinado", tipo: "GANHO" };
const perdido: PedidoTerminal = { titulo: "Site da padaria", faseNome: "Perdido", tipo: "PERDIDO" };

function montar(pedido: PedidoTerminal | null) {
  const onConfirmar = vi.fn();
  const onCancelar = vi.fn();
  render(<DialogoTerminal pedido={pedido} onConfirmar={onConfirmar} onCancelar={onCancelar} />);
  return { onConfirmar, onCancelar };
}

describe("DialogoTerminal — ganho", () => {
  it("valor é opcional: confirma vazio", async () => {
    const { onConfirmar } = montar(ganho);
    fireEvent.click(await screen.findByRole("button", { name: "Marcar como ganho" }));
    expect(onConfirmar).toHaveBeenCalledWith({ valorFechado: "" });
  });

  it("repassa o valor digitado; inválido mostra erro e não confirma", async () => {
    const { onConfirmar } = montar(ganho);
    const campo = await screen.findByLabelText("Valor fechado (opcional)");
    fireEvent.change(campo, { target: { value: "dez mil" } });
    fireEvent.click(screen.getByRole("button", { name: "Marcar como ganho" }));
    expect(onConfirmar).not.toHaveBeenCalled();
    expect(screen.getByText("Valor inválido. Ex.: 12.500,00")).toBeInTheDocument();

    fireEvent.change(campo, { target: { value: "12.500,00" } });
    fireEvent.click(screen.getByRole("button", { name: "Marcar como ganho" }));
    expect(onConfirmar).toHaveBeenCalledWith({ valorFechado: "12.500,00" });
  });

  it("cancelar não confirma", async () => {
    const { onConfirmar, onCancelar } = montar(ganho);
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    expect(onCancelar).toHaveBeenCalled();
    expect(onConfirmar).not.toHaveBeenCalled();
  });
});

describe("DialogoTerminal — perdido", () => {
  it("motivo obrigatório", async () => {
    const { onConfirmar } = montar(perdido);
    fireEvent.click(await screen.findByRole("button", { name: "Marcar como perdido" }));
    expect(onConfirmar).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Escolha um motivo.");
  });

  it("motivo da lista confirma; “Outro” exige texto", async () => {
    const { onConfirmar } = montar(perdido);
    fireEvent.click(await screen.findByLabelText("Outro"));
    fireEvent.click(screen.getByRole("button", { name: "Marcar como perdido" }));
    expect(onConfirmar).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Descreva o motivo.");

    fireEvent.change(screen.getByLabelText("Qual foi o motivo?"), { target: { value: "empresa fechou" } });
    fireEvent.click(screen.getByRole("button", { name: "Marcar como perdido" }));
    expect(onConfirmar).toHaveBeenCalledWith({ motivo: "outro", detalhe: "empresa fechou" });
  });

  it("preço sem detalhe", async () => {
    const { onConfirmar } = montar(perdido);
    fireEvent.click(await screen.findByLabelText("Preço"));
    fireEvent.click(screen.getByRole("button", { name: "Marcar como perdido" }));
    expect(onConfirmar).toHaveBeenCalledWith({ motivo: "preco", detalhe: "" });
  });
});

describe("DialogoTerminal — fechado", () => {
  it("sem pedido não renderiza nada", () => {
    montar(null);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

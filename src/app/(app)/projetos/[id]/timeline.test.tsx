import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Timeline } from "./timeline";

const entrada = (payload: object) => ({
  id: "t1",
  projetoId: "c1",
  tipo: "PRAZO" as const,
  payload,
  usuarioId: "u1",
  mensagemBrutaId: null,
  em: new Date("2026-10-27T13:00:00Z"),
  usuario: { id: "u1", nome: "Ana Vendas" },
});

describe("Timeline: PRAZO (GAB-51)", () => {
  it("criado e concluído, com o dia em mono", () => {
    const { rerender } = render(<Timeline entradas={[entrada({ evento: "criado", titulo: "Enviar proposta", dia: "2026-10-30" })]} fases={new Map()} nomes={new Map()} />);
    expect(screen.getByText(/criou o prazo/)).toBeInTheDocument();
    expect(screen.getByText("Enviar proposta")).toBeInTheDocument();
    expect(screen.getByText("30/10/2026")).toHaveClass("font-mono");
    rerender(<Timeline entradas={[entrada({ evento: "concluido", titulo: "Enviar proposta", dia: "2026-10-30" })]} fases={new Map()} nomes={new Map()} />);
    expect(screen.getByText(/concluiu o prazo/)).toBeInTheDocument();
  });
});

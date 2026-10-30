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

describe("Timeline: pares não unidos do ciclo único (GAB-81)", () => {
  const vinculo = (payload: object) => ({ ...entrada(payload), tipo: "VINCULO_PROJETO" as const, usuarioId: null, usuario: null });

  it("ciclo_unico_nao_unido linka o card irmão vivo; sem ele, aparece como removido", () => {
    const relacionados = new Map([["p2", { titulo: "Oficina (projeto)", quadro: "projetos" }]]);
    const { rerender } = render(
      <Timeline entradas={[vinculo({ evento: "ciclo_unico_nao_unido", projetoId: "p2", vendaFase: "Em negociação" })]} fases={new Map()} nomes={new Map()} relacionados={relacionados} />,
    );
    expect(screen.getByText(/manteve separados/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Oficina (projeto)" })).toHaveAttribute("href", "/projetos/p2");
    rerender(<Timeline entradas={[vinculo({ evento: "ciclo_unico_nao_unido", vendaId: "v9" })]} fases={new Map()} nomes={new Map()} />);
    expect(screen.getByText(/venda \(removido\)/)).toBeInTheDocument();
  });

  it("reganho_projeto_existente: na venda linka o projeto anterior; no projeto linka a venda", () => {
    const relacionados = new Map([
      ["p2", { titulo: "Oficina (projeto)", quadro: "projetos" }],
      ["v1", { titulo: "Oficina", quadro: "projetos" }],
    ]);
    const { rerender } = render(<Timeline entradas={[vinculo({ evento: "reganho_projeto_existente", projetoId: "p2" })]} fases={new Map()} nomes={new Map()} relacionados={relacionados} />);
    expect(screen.getByText(/o projeto da venda anterior já existe/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Oficina (projeto)" })).toHaveAttribute("href", "/projetos/p2");
    rerender(<Timeline entradas={[vinculo({ evento: "reganho_projeto_existente", vendaId: "v1" })]} fases={new Map()} nomes={new Map()} relacionados={relacionados} />);
    expect(screen.getByRole("link", { name: "Oficina" })).toHaveAttribute("href", "/projetos/v1");
  });
});

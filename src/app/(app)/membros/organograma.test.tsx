import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BaseOrg } from "@/lib/gg/organizacao";

vi.mock("@/app/(app)/gg/actions", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { Organograma } = await import("./organograma");

const base = (extra: Partial<BaseOrg> = {}): BaseOrg => ({
  hoje: "2026-11-18",
  areas: [{ id: "proj", nome: "Projetos", tipo: "AREA", superiorId: null, ladoCrm: "PROJETOS", ehGG: false }],
  cargos: [{ id: "pm", nome: "PM", categoria: "LIDERANCA", ehGp: true }],
  posicoes: [
    { id: "p_pm", nome: "PM", areaId: "proj", cargoId: "pm", liderancaId: null },
    // Área e cargo desativados (fora da base), com a posição ainda ativa.
    { id: "p_orfa", nome: "Posição órfã", areaId: "area_inativa", cargoId: "cargo_inativo", liderancaId: null },
  ],
  ocupacoes: [],
  membros: [],
  vinculos: [],
  ...extra,
});

/** GAB-106: vaga aparece como "Vago"; quem cadastra tem o atalho; área ou cargo inativo não derruba a página. */
describe("Organograma", () => {
  it("leitura: vaga é só 'Vago'; área e cargo inativos aparecem como tal", () => {
    render(<Organograma base={base()} editor={false} cadastra={false} />);
    expect(screen.getAllByText("Vago")).toHaveLength(2);
    expect(screen.queryByRole("link", { name: /^Vago: cadastrar/ })).toBeNull();
    expect(screen.getByText("área inativa")).toBeTruthy();
    expect(screen.getByText("cargo inativo")).toBeTruthy();
  });

  it("quem cadastra: a vaga leva ao cadastro já na posição", () => {
    render(<Organograma base={base()} editor={false} cadastra />);
    expect(screen.getByRole("link", { name: "Vago: cadastrar pessoa em PM" }).getAttribute("href")).toBe("/membros?visao=organograma&fechado=&cadastrar=p_pm");
  });

  it("ocupação encerrada (ex.: importada como inativa) deixa a posição vaga", () => {
    const b = base({
      membros: [{ id: "m1", nome: "Ex PM", email: null, status: "INATIVO", usuarioId: null }],
      ocupacoes: [{ id: "o1", membroId: "m1", posicaoId: "p_pm", inicio: "2025-03-01", fim: "2026-11-18", principal: false, invalidadoEm: null, motivoInvalidacao: null }],
    });
    render(<Organograma base={b} editor={false} cadastra={false} />);
    expect(screen.queryByText("Ex PM")).toBeNull();
    expect(screen.getAllByText("Vago")).toHaveLength(2);
  });
});

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

  describe("cúpula (GAB-109)", () => {
    const cupula = (): BaseOrg =>
      base({
        areas: [
          { id: "pres", nome: "Presidência", tipo: "INSTITUCIONAL", superiorId: null, ladoCrm: null, ehGG: false },
          { id: "vp", nome: "Vice-Presidência", tipo: "INSTITUCIONAL", superiorId: null, ladoCrm: null, ehGG: false },
          { id: "proj", nome: "Projetos", tipo: "AREA", superiorId: null, ladoCrm: "PROJETOS", ehGG: false },
        ],
        cargos: [{ id: "dir", nome: "Diretor", categoria: "DIRETORIA", ehGp: false }],
        posicoes: [
          { id: "p_pres", nome: "Presidente", areaId: "pres", cargoId: "dir", liderancaId: null },
          { id: "p_vp", nome: "Vice", areaId: "vp", cargoId: "dir", liderancaId: "p_pres" },
          { id: "p_dir", nome: "Diretoria de Projetos", areaId: "proj", cargoId: "dir", liderancaId: "p_vp" },
        ],
      });

    it("Presidência e Vice na mesma linha, diretorias abaixo; um só 'recolher'", () => {
      const { container } = render(<Organograma base={cupula()} editor={false} cadastra={false} />);
      const linha = container.querySelector(".org-cupula")!;
      expect(linha.textContent).toContain("Presidente");
      expect(linha.textContent).toContain("Vice");
      expect(linha.textContent).not.toContain("Diretoria de Projetos");
      expect(screen.getByText("Diretoria de Projetos")).toBeTruthy();
      expect(screen.getAllByRole("link", { name: "▾ recolher" })).toHaveLength(1);
      expect(screen.getByRole("link", { name: "▾ recolher" }).getAttribute("href")).toBe("/membros?visao=organograma&fechado=p_pres");
    });

    it("`?fechado=` antigo com a VP ainda recolhe a linha, e reabrir limpa os dois ids", () => {
      render(<Organograma base={cupula()} editor={false} cadastra={false} fechado="p_vp,p_pres,outro" />);
      expect(screen.queryByText("Diretoria de Projetos")).toBeNull();
      const mostrar = screen.getByRole("link", { name: "▸ mostrar 1 abaixo" });
      expect(mostrar.getAttribute("href")).toBe("/membros?visao=organograma&fechado=outro");
    });
  });
});

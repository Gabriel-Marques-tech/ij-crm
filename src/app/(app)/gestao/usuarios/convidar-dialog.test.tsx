import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Papel } from "@prisma/client";
import type { GrupoPosicoes } from "@/lib/auth/cadastro";

vi.mock("./actions", () => ({ criarConviteAction: vi.fn(async () => undefined) }));

const { CorpoConvite } = await import("./convidar-dialog");
const { AVISO_SEM_AREA_GG } = await import("./campo-posicao");

/** GAB-105: "Posição na IJ" no cadastro pré-preenche papel/área/cargos e vai no FormData. */
const GRUPOS: GrupoPosicoes[] = [
  { rotulo: "Gente & Gestão", opcoes: [{ id: "p_agg", rotulo: "Gente & Gestão · Analista", ehGG: true, pareceGG: true, sugestao: { papel: "VISUALIZADOR", area: null, cargos: [] } }] },
  {
    rotulo: "Projetos",
    opcoes: [
      { id: "p_dproj", rotulo: "Projetos · Diretor", ehGG: false, pareceGG: false, sugestao: { papel: "GESTOR", area: "PROJETOS", cargos: ["DIRETOR"] } },
      { id: "p_pm", rotulo: "Projetos · PM", ehGG: false, pareceGG: false, sugestao: { papel: "PROJETOS", area: "PROJETOS", cargos: ["PM"] } },
    ],
  },
  { rotulo: "Vendas", opcoes: [{ id: "p_mv", rotulo: "Vendas · Membro", ehGG: false, pareceGG: false, sugestao: { papel: "VENDEDOR", area: "VENDAS", cargos: [] } }] },
];

function montar({ papelAtor = "GESTOR" as Papel, grupos = GRUPOS, temAreaGG = true } = {}) {
  const r = render(<CorpoConvite papelAtor={papelAtor} googleAtivo posicoes={{ grupos, temAreaGG }} onFechar={() => {}} />);
  const form = r.container.querySelector("form")!;
  return {
    form,
    dados: () => new FormData(form),
    escolher: (id: string) => fireEvent.change(screen.getByLabelText("Posição na IJ (opcional)"), { target: { value: id } }),
  };
}
const papel = () => (screen.getByLabelText("Papel") as HTMLSelectElement).value;

describe("cadastro: campo Posição na IJ", () => {
  it("lista as posições agrupadas por área, com área e cargo", () => {
    montar();
    const grupos = Array.from(document.querySelectorAll("optgroup")).map((g) => [g.label, Array.from(g.querySelectorAll("option")).map((o) => o.textContent)]);
    expect(grupos).toEqual([
      ["Gente & Gestão", ["Gente & Gestão · Analista"]],
      ["Projetos", ["Projetos · Diretor", "Projetos · PM"]],
      ["Vendas", ["Vendas · Membro"]],
    ]);
  });

  it("sem escolher: papel padrão e posicaoId vazio", () => {
    const { dados } = montar();
    expect(papel()).toBe("VENDEDOR");
    expect(dados().get("posicaoId")).toBe("");
  });

  it("PM de Projetos preenche papel Projetos e cargo PM, e manda a posição", () => {
    const { dados, escolher } = montar();
    escolher("p_pm");
    expect(papel()).toBe("PROJETOS");
    expect(dados().get("area")).toBe("PROJETOS");
    expect(dados().getAll("cargos")).toEqual(["PM"]);
    expect(dados().get("posicaoId")).toBe("p_pm");
  });

  it("quem cadastra ajusta depois de escolher (o servidor reaplica a régua)", () => {
    const { dados, escolher } = montar();
    escolher("p_pm");
    fireEvent.click(screen.getByLabelText("PO de projetos"));
    expect(dados().getAll("cargos")).toEqual(["PM", "PO"]);
    fireEvent.change(screen.getByLabelText("Papel"), { target: { value: "VISUALIZADOR" } });
    expect(dados().getAll("cargos")).toEqual([]);
    expect(dados().get("posicaoId")).toBe("p_pm");
  });

  it("diretoria preenche Gestor + Diretor; Vendas preenche Vendedor", () => {
    const { dados, escolher } = montar();
    escolher("p_dproj");
    expect(papel()).toBe("GESTOR");
    expect(dados().getAll("cargos")).toEqual(["DIRETOR"]);
    escolher("p_mv");
    expect(papel()).toBe("VENDEDOR");
    expect(dados().get("area")).toBe("VENDAS");
  });

  it("sugestão de papel que o ator não pode atribuir não é aplicada", () => {
    const grupos: GrupoPosicoes[] = [{ rotulo: "X", opcoes: [{ id: "p_x", rotulo: "X · Admin", ehGG: false, pareceGG: false, sugestao: { papel: "ADMIN", area: null, cargos: [] } }] }];
    const { escolher } = montar({ grupos });
    escolher("p_x");
    expect(papel()).toBe("VENDEDOR");
    expect(screen.getByText(/não pode atribuir/)).toBeTruthy();
  });

  it("posição de G&G avisa que a pessoa passa a editar o G&G", () => {
    const { escolher } = montar();
    escolher("p_agg");
    expect(screen.getByText(/passa a editar o G&G/)).toBeTruthy();
    expect(screen.queryByText(AVISO_SEM_AREA_GG)).toBeNull();
  });

  it("sem área marcada ehGG: aviso ao escolher posição de G&G e ao procurar por ela", () => {
    const um = montar({ temAreaGG: false });
    expect(screen.queryByText(AVISO_SEM_AREA_GG)).toBeNull();
    um.escolher("p_agg");
    expect(screen.getByText(AVISO_SEM_AREA_GG)).toBeTruthy();
    um.escolher("p_pm");
    expect(screen.queryByText(AVISO_SEM_AREA_GG)).toBeNull();
    fireEvent.change(screen.getByLabelText("Procurar posição"), { target: { value: "gente" } });
    expect(screen.getByText(AVISO_SEM_AREA_GG)).toBeTruthy();
  });

  it("a busca filtra as opções sem perder a escolhida", () => {
    const { escolher } = montar();
    escolher("p_pm");
    fireEvent.change(screen.getByLabelText("Procurar posição"), { target: { value: "vendas" } });
    const opcoes = Array.from(document.querySelectorAll("optgroup option")).map((o) => o.getAttribute("value"));
    expect(opcoes).toEqual(["p_pm", "p_mv"]);
  });
});

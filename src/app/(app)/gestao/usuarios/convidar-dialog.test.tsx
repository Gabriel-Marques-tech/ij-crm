import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Papel } from "@prisma/client";
import type { AreaPosicoes, OpcaoPosicao } from "@/lib/auth/cadastro";

const acoes = vi.hoisted(() => ({ criarConviteAction: vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => undefined) }));
vi.mock("./actions", () => acoes);

const { CorpoConvite } = await import("./convidar-dialog");
const { AVISO_SEM_AREA_GG } = await import("./campo-posicao");

/** GAB-105: "Posição na IJ" em cascata (área → frente → cargo) pré-preenche papel/área/cargos e manda o id da posição. */
const op = (id: string, rotulo: string, cargo: string, sugestao: OpcaoPosicao["sugestao"], gg = false): OpcaoPosicao => ({ id, rotulo, cargo, ehGG: gg, pareceGG: gg, sugestao });
const VIS = { papel: "VISUALIZADOR" as const, area: null, cargos: [] };
const AREAS: AreaPosicoes[] = [
  {
    id: "gg",
    nome: "Gente & Gestão",
    ehGG: true,
    pareceGG: true,
    posicoes: [op("p_dgg", "Gente & Gestão · Diretor", "Diretor", { papel: "GESTOR", area: null, cargos: [] }, true)],
    frentes: [{ id: "rh", nome: "RH", posicoes: [op("p_arh", "RH · Analista", "Analista", VIS, true), op("p_grh", "RH · Gerente", "Gerente", VIS, true)] }],
  },
  {
    id: "proj",
    nome: "Projetos",
    ehGG: false,
    pareceGG: false,
    posicoes: [op("p_dproj", "Projetos · Diretor", "Diretor", { papel: "GESTOR", area: "PROJETOS", cargos: ["DIRETOR"] }), op("p_pm", "Projetos · PM", "PM", { papel: "PROJETOS", area: "PROJETOS", cargos: ["PM"] })],
    frentes: [],
  },
  { id: "vend", nome: "Vendas", ehGG: false, pareceGG: false, posicoes: [op("p_mv", "Vendas · Membro", "Membro", { papel: "VENDEDOR", area: "VENDAS", cargos: [] })], frentes: [] },
];

function montar({ papelAtor = "GESTOR" as Papel, areas = AREAS, temAreaGG = true } = {}) {
  const r = render(<CorpoConvite papelAtor={papelAtor} googleAtivo posicoes={{ areas, temAreaGG }} onFechar={() => {}} />);
  const form = r.container.querySelector("form")!;
  return { dados: () => new FormData(form) };
}
const sel = (rotulo: string) => screen.getByLabelText(rotulo) as HTMLSelectElement;
const opcoes = (rotulo: string) => Array.from(sel(rotulo).options).map((o) => o.textContent);
const escolher = (rotulo: string, value: string) => fireEvent.change(sel(rotulo), { target: { value } });
const papel = () => sel("Papel").value;

describe("cadastro: Posição na IJ em cascata", () => {
  it("só os três selects, sem caixa de busca; começa só com a área (áreas de topo + Sem posição)", () => {
    montar();
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(opcoes("Área da IJ")).toEqual(["Sem posição", "Gente & Gestão", "Projetos", "Vendas"]);
    expect(screen.queryByLabelText("Subárea ou frente")).toBeNull();
    expect(screen.queryByLabelText("Cargo na IJ")).toBeNull();
  });

  it("sem escolher: papel padrão e posicaoId vazio", () => {
    const { dados } = montar();
    expect(papel()).toBe("VENDEDOR");
    expect(dados().get("posicaoId")).toBe("");
  });

  it("área sem frentes: vai direto para o cargo; PM preenche Projetos + PM e manda a posição", () => {
    const { dados } = montar();
    escolher("Área da IJ", "proj");
    expect(screen.queryByLabelText("Subárea ou frente")).toBeNull();
    expect(opcoes("Cargo na IJ")).toEqual(["Escolha o cargo", "Diretor", "PM"]);
    expect(dados().get("posicaoId")).toBe("");
    expect(papel()).toBe("VENDEDOR");
    escolher("Cargo na IJ", "p_pm");
    expect(papel()).toBe("PROJETOS");
    expect(dados().get("area")).toBe("PROJETOS");
    expect(dados().getAll("cargos")).toEqual(["PM"]);
    expect(dados().get("posicaoId")).toBe("p_pm");
  });

  it("cargo único no nó vem escolhido sozinho", () => {
    const { dados } = montar();
    escolher("Área da IJ", "vend");
    expect(sel("Cargo na IJ").value).toBe("p_mv");
    expect(opcoes("Cargo na IJ")).toEqual(["Membro"]);
    expect(dados().get("posicaoId")).toBe("p_mv");
    expect(papel()).toBe("VENDEDOR");
    expect(dados().get("area")).toBe("VENDAS");
  });

  it("área com frentes: frente opcional com 'A própria área'; trocar a frente limpa o cargo", () => {
    const { dados } = montar();
    escolher("Área da IJ", "gg");
    expect(opcoes("Subárea ou frente")).toEqual(["A própria área", "RH"]);
    // A própria área tem um cargo só (Diretor): já vem escolhido.
    expect(dados().get("posicaoId")).toBe("p_dgg");
    expect(papel()).toBe("GESTOR");
    escolher("Subárea ou frente", "rh");
    expect(opcoes("Cargo na IJ")).toEqual(["Escolha o cargo", "Analista", "Gerente"]);
    expect(dados().get("posicaoId")).toBe("");
    escolher("Cargo na IJ", "p_arh");
    expect(dados().get("posicaoId")).toBe("p_arh");
    expect(papel()).toBe("VISUALIZADOR");
    expect(screen.getByText(/passa a editar o G&G/)).toBeTruthy();
    escolher("Subárea ou frente", "");
    expect(dados().get("posicaoId")).toBe("p_dgg");
  });

  it("trocar a área limpa frente e cargo", () => {
    const { dados } = montar();
    escolher("Área da IJ", "gg");
    escolher("Subárea ou frente", "rh");
    escolher("Cargo na IJ", "p_grh");
    escolher("Área da IJ", "proj");
    expect(screen.queryByLabelText("Subárea ou frente")).toBeNull();
    expect(sel("Cargo na IJ").value).toBe("");
    expect(dados().get("posicaoId")).toBe("");
    escolher("Área da IJ", "gg");
    expect(sel("Subárea ou frente").value).toBe("");
    escolher("Área da IJ", "");
    expect(screen.queryByLabelText("Cargo na IJ")).toBeNull();
    expect(dados().get("posicaoId")).toBe("");
  });

  it("quem cadastra ajusta depois de escolher (o servidor reaplica a régua)", () => {
    const { dados } = montar();
    escolher("Área da IJ", "proj");
    escolher("Cargo na IJ", "p_pm");
    fireEvent.click(screen.getByLabelText("PO de projetos"));
    expect(dados().getAll("cargos")).toEqual(["PM", "PO"]);
    fireEvent.change(sel("Papel"), { target: { value: "VISUALIZADOR" } });
    expect(dados().getAll("cargos")).toEqual([]);
    expect(dados().get("posicaoId")).toBe("p_pm");
  });

  it("diretoria de Projetos preenche Gestor + Diretor", () => {
    const { dados } = montar();
    escolher("Área da IJ", "proj");
    escolher("Cargo na IJ", "p_dproj");
    expect(papel()).toBe("GESTOR");
    expect(dados().getAll("cargos")).toEqual(["DIRETOR"]);
  });

  it("sugestão de papel que o ator não pode atribuir não é aplicada", () => {
    const areas: AreaPosicoes[] = [{ id: "x", nome: "X", ehGG: false, pareceGG: false, posicoes: [op("p_x", "X · Admin", "Admin", { papel: "ADMIN", area: null, cargos: [] })], frentes: [] }];
    montar({ areas });
    escolher("Área da IJ", "x");
    expect(papel()).toBe("VENDEDOR");
    expect(screen.getByText(/não pode atribuir/)).toBeTruthy();
  });

  it("sem área marcada ehGG: aviso ao escolher a área de G&G, e some ao trocar", () => {
    montar({ temAreaGG: false });
    expect(screen.queryByText(AVISO_SEM_AREA_GG)).toBeNull();
    escolher("Área da IJ", "gg");
    expect(screen.getByText(AVISO_SEM_AREA_GG)).toBeTruthy();
    escolher("Área da IJ", "proj");
    expect(screen.queryByText(AVISO_SEM_AREA_GG)).toBeNull();
  });
});

describe("cadastro: homônimo e ficha ligada", () => {
  it("homônimo sem e-mail: pergunta, e 'Ligar a ele e salvar' reenvia os mesmos dados com o membro; o resultado mostra a ficha", async () => {
    acoes.criarConviteAction
      .mockResolvedValueOnce({ erro: 'Já existe "Ana Souza" sem e-mail no G&G. É a mesma pessoa?', homonimo: { id: "m1", nome: "Ana Souza" } })
      .mockResolvedValueOnce({ link: "https://crm/convite/x", expiraEm: new Date().toISOString(), email: "ana@ij.test", fichaLigada: { nome: "Ana Souza", posicoes: ["Vendas · Membro"] } });
    montar();
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Ana Souza" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ana@ij.test" } });
    escolher("Área da IJ", "vend");
    fireEvent.submit(screen.getByRole("button", { name: "Cadastrar" }).closest("form")!);
    expect(await screen.findByText(/sem e-mail no G&G. Ligar a ele\?/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ligar a ele e salvar" }));
    await waitFor(() => expect(acoes.criarConviteAction).toHaveBeenCalledTimes(2));
    const enviado = acoes.criarConviteAction.mock.calls[1][1] as FormData;
    expect(enviado.get("ligarMembroId")).toBe("m1");
    expect(enviado.get("nome")).toBe("Ana Souza");
    expect(enviado.get("posicaoId")).toBe("p_mv");
    expect(await screen.findByText(/Ficha existente no G&G ligada/)).toBeTruthy();
    expect(screen.getByText(/Vendas · Membro/)).toBeTruthy();
  });

  it("'É outra pessoa' reenvia com criarMembroNovo", async () => {
    acoes.criarConviteAction.mockReset();
    acoes.criarConviteAction.mockResolvedValueOnce({ erro: "x", homonimo: { id: "m1", nome: "Ana Souza" } }).mockResolvedValueOnce({ erro: "outra coisa" });
    montar();
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Ana Souza" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ana@ij.test" } });
    fireEvent.submit(screen.getByRole("button", { name: "Cadastrar" }).closest("form")!);
    fireEvent.click(await screen.findByRole("button", { name: "É outra pessoa: criar membro novo" }));
    await waitFor(() => expect(acoes.criarConviteAction).toHaveBeenCalledTimes(2));
    const enviado = acoes.criarConviteAction.mock.calls[1][1] as FormData;
    expect(enviado.get("criarMembroNovo")).toBe("1");
    expect(enviado.get("ligarMembroId")).toBeNull();
    expect(await screen.findByText("outra coisa")).toBeTruthy();
  });
});

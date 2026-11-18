import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AreaPosicoes } from "@/lib/auth/cadastro";

const acoes = vi.hoisted(() => ({
  adicionarPosicaoUsuarioAction: vi.fn(async (): Promise<{ ok?: true; erro?: string }> => ({ ok: true })),
  encerrarOcupacaoUsuarioAction: vi.fn(async (): Promise<{ ok?: true; erro?: string }> => ({ ok: true })),
}));
vi.mock("./actions", () => acoes);

const { PosicoesUsuario } = await import("./posicoes-usuario");

const AREAS: AreaPosicoes[] = [
  {
    id: "proj",
    nome: "Projetos",
    ehGG: false,
    pareceGG: false,
    frentes: [],
    posicoes: [
      { id: "p_pm", rotulo: "Projetos · PM", cargo: "PM", ehGG: false, pareceGG: false, sugestao: { papel: "PROJETOS", area: "PROJETOS", cargos: ["PM"] } },
      { id: "p_po", rotulo: "Projetos · PO", cargo: "PO", ehGG: false, pareceGG: false, sugestao: { papel: "PROJETOS", area: "PROJETOS", cargos: ["PO"] } },
    ],
  },
];
const escolherPm = () => {
  fireEvent.change(screen.getByLabelText("Área da IJ"), { target: { value: "proj" } });
  fireEvent.change(screen.getByLabelText("Cargo na IJ"), { target: { value: "p_pm" } });
};

afterEach(() => vi.clearAllMocks());

describe("edição: Posição na IJ", () => {
  it("mostra as ocupações abertas e encerra a escolhida", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<PosicoesUsuario usuarioId="u1" ocupacoes={[{ ocupacaoId: "o1", rotulo: "Vendas · Membro", principal: true, inicio: "2026-03-01" }]} areas={AREAS} temAreaGG />);
    expect(screen.getByText("Vendas · Membro")).toBeTruthy();
    expect(screen.getByText("desde 01/03/2026")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Encerrar" }));
    await waitFor(() => expect(acoes.encerrarOcupacaoUsuarioAction).toHaveBeenCalledWith("u1", "o1"));
    expect(await screen.findByText(/encerrada/)).toBeTruthy();
  });

  it("adiciona a posição escolhida e mostra a sugestão para a conta", async () => {
    render(<PosicoesUsuario usuarioId="u1" ocupacoes={[]} areas={AREAS} temAreaGG />);
    expect(screen.getByText("Sem posição atual no organograma.")).toBeTruthy();
    const botao = screen.getByRole("button", { name: "Adicionar posição" }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Área da IJ"), { target: { value: "proj" } });
    expect(botao.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Cargo na IJ"), { target: { value: "p_pm" } });
    fireEvent.click(botao);
    await waitFor(() => expect(acoes.adicionarPosicaoUsuarioAction).toHaveBeenCalledWith("u1", "p_pm"));
    expect(await screen.findByText(/sugere: Projetos · Projetos · PM/)).toBeTruthy();
  });

  it("erro da action aparece (com a ref, quando é do servidor)", async () => {
    acoes.adicionarPosicaoUsuarioAction.mockResolvedValueOnce({ erro: "Erro no servidor (ref: abcd1234). Tente de novo; se persistir, informe a ref." });
    render(<PosicoesUsuario usuarioId="u1" ocupacoes={[]} areas={AREAS} temAreaGG />);
    escolherPm();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar posição" }));
    expect((await screen.findByRole("alert")).textContent).toContain("ref: abcd1234");
  });
});

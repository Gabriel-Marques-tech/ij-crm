import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AreaPosicoes } from "@/lib/auth/cadastro";

type Estado = { ok?: true; erro?: string; conta?: string; homonimos?: { id: string; nome: string }[]; confirmarConta?: { atual: string; conta: string; posicoes: string[] } };
const acoes = vi.hoisted(() => ({
  adicionarPosicaoUsuarioAction: vi.fn<(...a: unknown[]) => Promise<Estado>>(async () => ({ ok: true, conta: "Membro de Projetos · PM" })),
  encerrarOcupacaoUsuarioAction: vi.fn<(...a: unknown[]) => Promise<Estado>>(async () => ({ ok: true, conta: "Visualizador (só leitura)" })),
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
    await waitFor(() => expect(acoes.encerrarOcupacaoUsuarioAction).toHaveBeenCalledWith("u1", "o1", null));
    expect(await screen.findByText(/encerrada\. Conta no CRM: Visualizador \(só leitura\)\./)).toBeTruthy();
  });

  it("adiciona a posição escolhida e mostra como a conta ficou", async () => {
    render(<PosicoesUsuario usuarioId="u1" ocupacoes={[]} areas={AREAS} temAreaGG />);
    expect(screen.getByText("Sem posição atual no organograma.")).toBeTruthy();
    const botao = screen.getByRole("button", { name: "Adicionar posição" }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Área da IJ"), { target: { value: "proj" } });
    expect(botao.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Cargo na IJ"), { target: { value: "p_pm" } });
    fireEvent.click(botao);
    await waitFor(() => expect(acoes.adicionarPosicaoUsuarioAction).toHaveBeenCalledWith("u1", "p_pm", {}));
    expect(await screen.findByText("Posição atribuída. Conta no CRM: Membro de Projetos · PM.")).toBeTruthy();
  });

  it("erro da action aparece (com a ref, quando é do servidor)", async () => {
    acoes.adicionarPosicaoUsuarioAction.mockResolvedValueOnce({ erro: "Erro no servidor (ref: abcd1234). Tente de novo; se persistir, informe a ref." });
    render(<PosicoesUsuario usuarioId="u1" ocupacoes={[]} areas={AREAS} temAreaGG />);
    escolherPm();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar posição" }));
    expect((await screen.findByRole("alert")).textContent).toContain("ref: abcd1234");
  });

  it("mudança de papel: mostra a conta resultante; confirmar refaz com a conta confirmada (adicionar e encerrar)", async () => {
    const pedido = { atual: "Visualizador (só leitura)", conta: "Gestor de Projetos · Diretor", posicoes: ["Projetos · Diretor"] };
    acoes.adicionarPosicaoUsuarioAction.mockResolvedValueOnce({ erro: "x", confirmarConta: pedido }).mockResolvedValueOnce({ ok: true, conta: pedido.conta });
    render(<PosicoesUsuario usuarioId="u1" ocupacoes={[{ ocupacaoId: "o1", rotulo: "Vendas · Membro", principal: true, inicio: null }]} areas={AREAS} temAreaGG />);
    escolherPm();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar posição" }));
    expect(await screen.findByText(/Hoje a conta é: Visualizador/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar: Gestor de Projetos · Diretor" }));
    await waitFor(() => expect(acoes.adicionarPosicaoUsuarioAction).toHaveBeenLastCalledWith("u1", "p_pm", { confirmarConta: "Gestor de Projetos · Diretor" }));
    expect(await screen.findByText(/Conta no CRM: Gestor de Projetos · Diretor/)).toBeTruthy();

    vi.spyOn(window, "confirm").mockReturnValue(true);
    acoes.encerrarOcupacaoUsuarioAction.mockResolvedValueOnce({ erro: "x", confirmarConta: { ...pedido, conta: "Membro de Projetos" } });
    fireEvent.click(screen.getByRole("button", { name: "Encerrar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar: Membro de Projetos" }));
    await waitFor(() => expect(acoes.encerrarOcupacaoUsuarioAction).toHaveBeenLastCalledWith("u1", "o1", "Membro de Projetos"));
  });

  it("homônimo sem e-mail: pergunta e 'Ligar a ele' reenvia com o membro", async () => {
    acoes.adicionarPosicaoUsuarioAction.mockResolvedValueOnce({ erro: "x", homonimos: [{ id: "m1", nome: "Edu Lima" }] });
    render(<PosicoesUsuario usuarioId="u1" ocupacoes={[]} areas={AREAS} temAreaGG />);
    escolherPm();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar posição" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ligar a ele" }));
    await waitFor(() => expect(acoes.adicionarPosicaoUsuarioAction).toHaveBeenLastCalledWith("u1", "p_pm", { ligarMembroId: "m1" }));
    expect(await screen.findByText(/Posição atribuída/)).toBeTruthy();
  });
});

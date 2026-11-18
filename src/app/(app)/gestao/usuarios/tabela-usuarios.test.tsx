import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Papel } from "@prisma/client";

const acoes = vi.hoisted(() => ({
  desligarGoogleAction: vi.fn(async () => ({ ok: true as const })),
  reemitirConviteAction: vi.fn(async () => ({ link: "https://crm/convite/x", expiraEm: new Date().toISOString() })),
  gerarLinkRedefinicaoAction: vi.fn(),
  alternarAtivoAction: vi.fn(),
  editarUsuarioAction: vi.fn(),
  criarConviteAction: vi.fn(),
  adicionarPosicaoUsuarioAction: vi.fn(),
  encerrarOcupacaoUsuarioAction: vi.fn(),
}));
vi.mock("./actions", () => acoes);
vi.mock("@/components/avatar", () => ({ Avatar: () => null }));

const { TabelaUsuarios } = await import("./tabela-usuarios");

function usuario(p: Partial<Parameters<typeof TabelaUsuarios>[0]["usuarios"][number]> & { id: string; papel: Papel }) {
  return {
    nome: `Pessoa ${p.id}`,
    email: `${p.id}@sou.inteli.edu.br`,
    area: null,
    cargos: [],
    areaEntrada: null,
    telefoneWhatsapp: null,
    ativo: true,
    convitePendente: false,
    entraComGoogle: false,
    semSenha: false,
    conviteExpiraEm: null,
    redefinicaoPedidaEm: null,
    redefinicaoLinkAtivo: false,
    fotoEm: null,
    ...p,
  };
}

afterEach(() => vi.clearAllMocks());

describe("tabela de usuários × Google", () => {
  it("só Google (sem senha): link para definir senha e Desligar Google; sem botão de redefinição que o servidor recusaria", () => {
    render(<TabelaUsuarios ator={{ id: "g", papel: "GESTOR" }} googleAtivo usuarios={[usuario({ id: "v", papel: "VENDEDOR", entraComGoogle: true, semSenha: true })]} />);
    expect(screen.getByRole("button", { name: "Gerar link para definir senha" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desligar Google" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Gerar link de redefinição" })).toBeNull();
    expect(screen.getByText("Google")).toBeInTheDocument();
  });

  it("Desligar Google pede confirmação e chama a action", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<TabelaUsuarios ator={{ id: "g", papel: "GESTOR" }} googleAtivo usuarios={[usuario({ id: "v", papel: "VENDEDOR", entraComGoogle: true })]} />);
    fireEvent.click(screen.getByRole("button", { name: "Desligar Google" }));
    await waitFor(() => expect(acoes.desligarGoogleAction).toHaveBeenCalledWith("v"));
  });

  it("gestor não vê Desligar Google em outro gestor, nem em si mesmo; admin vê", () => {
    const lista = [usuario({ id: "g2", papel: "GESTOR", entraComGoogle: true }), usuario({ id: "g", papel: "GESTOR", entraComGoogle: true })];
    const { unmount } = render(<TabelaUsuarios ator={{ id: "g", papel: "GESTOR" }} googleAtivo usuarios={lista} />);
    expect(screen.queryByRole("button", { name: "Desligar Google" })).toBeNull();
    unmount();
    render(<TabelaUsuarios ator={{ id: "a", papel: "ADMIN" }} googleAtivo usuarios={lista} />);
    expect(screen.getAllByRole("button", { name: "Desligar Google" })).toHaveLength(2);
  });

  it("com senha e Google: redefinição disponível, sem link de convite", () => {
    render(<TabelaUsuarios ator={{ id: "g", papel: "GESTOR" }} googleAtivo usuarios={[usuario({ id: "v", papel: "VENDEDOR", entraComGoogle: true })]} />);
    expect(screen.getByRole("button", { name: "Gerar link de redefinição" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reemitir convite|definir senha/ })).toBeNull();
  });
});

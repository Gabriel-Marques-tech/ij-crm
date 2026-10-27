import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VISUALIZACAO_PADRAO } from "@/lib/preferencias/preferencias";
import { QuadroKanban } from "./quadro-kanban";
import type { CardCliente, FaseCliente } from "./tipos";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/kanban",
}));
vi.mock("./actions", () => ({
  criarCardAction: vi.fn(),
  moverCardAction: vi.fn(),
  salvarVisualizacaoKanbanAction: vi.fn(async () => ({ ok: true })),
}));

const AGORA = new Date("2026-10-27T15:00:00Z").getTime();

const fase = (id: string, nome: string): FaseCliente => ({
  id,
  chave: id,
  nome,
  cor: null,
  limiteDiasAlerta: null,
  isTerminal: false,
  tipoTerminal: null,
});
const FASES = [fase("a", "Primeiro Contato"), fase("b", "Proposta")];

const card: CardCliente = {
  id: "c1",
  titulo: "Padaria do Zé",
  descricaoPrevia: null,
  descricaoTruncada: false,
  faseId: "a",
  faseDesdeMs: AGORA,
  revisar: false,
  proximaAcao: null,
  proximaAcaoEmMs: null,
  responsavelId: "u1",
  responsavelNome: "Ana Vendas",
  responsavelFotoEm: null,
  empresaNome: null,
  origem: null,
  estado: null,
  valorFechado: null,
  motivoPerda: null,
  alertaVenda: null,
};

function montar(cards: CardCliente[]) {
  return render(
    <QuadroKanban
      pipelineId="p1"
      fases={FASES}
      cards={cards}
      agoraMs={AGORA}
      responsaveis={[{ id: "u1", nome: "Ana Vendas" }]}
      meuId="u1"
      pipelineChave="vendas"
      visualizacao={{ ...VISUALIZACAO_PADRAO, mostrarVazias: true }}
    />,
  );
}

describe("QuadroKanban: coluna vazia", () => {
  it("coluna vazia mostra só o texto compacto, sem mascote", () => {
    montar([card]);
    const vazia = screen.getByRole("region", { name: "Fase Proposta, 0 card(s)" });
    expect(vazia.textContent).toContain("Nenhum card nesta fase · Solte um card aqui.");
    expect(vazia.querySelector("img")).toBeNull();
  });

  it("quadro todo vazio: um mascote só (no aviso geral), nenhum nas colunas", () => {
    const { container } = montar([]);
    expect(screen.getByText("Este quadro ainda não tem cards")).toBeInTheDocument();
    for (const nome of ["Fase Primeiro Contato, 0 card(s)", "Fase Proposta, 0 card(s)"]) {
      expect(screen.getByRole("region", { name: nome }).querySelector("img")).toBeNull();
    }
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });
});

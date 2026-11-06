import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXIBICAO_PADRAO } from "@/lib/tarefas/exibicao";
import type { PessoaTarefa, TarefaLista } from "@/lib/tarefas/modelo";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), useSearchParams: () => new URLSearchParams() }));
const acoes = vi.hoisted(() => ({
  criarTarefaAction: vi.fn(),
  editarTarefaAction: vi.fn(),
  moverTarefaAction: vi.fn(),
  excluirTarefaAction: vi.fn(),
  salvarExibicaoTarefasAction: vi.fn(),
}));
vi.mock("./actions", () => acoes);

const { QuadroTarefas } = await import("./quadro-tarefas");

const t = (numero: number, extra: Partial<TarefaLista> = {}): TarefaLista => ({
  id: `t${numero}`,
  numero,
  titulo: `Tarefa ${numero}`,
  descricao: null,
  status: "A_FAZER",
  prioridade: "SEM_PRIORIDADE",
  posicao: numero,
  responsavelId: null,
  prazo: null,
  etiquetas: [],
  paiId: null,
  concluidaEmMs: null,
  criadoEmMs: Date.UTC(2026, 10, 1),
  ...extra,
});
const PESSOAS: PessoaTarefa[] = [
  { id: "u1", nome: "Paula", fotoEm: null, ativo: true, podeReceber: true },
  { id: "u2", nome: "Lucas", fotoEm: null, ativo: true, podeReceber: false }, // saiu da equipe
  { id: "u3", nome: "Pedro", fotoEm: null, ativo: true, afastado: true, podeReceber: true },
];

const montar = (tarefas: TarefaLista[]) =>
  render(<QuadroTarefas projetoId="p1" tarefas={tarefas} pessoas={PESSOAS} etiquetas={[]} exibicaoInicial={EXIBICAO_PADRAO} hoje="2026-11-05" agoraMs={Date.UTC(2026, 10, 5)} />);

const cartao = (n: number) => screen.getByRole("button", { name: new RegExp(`^#${n} Tarefa ${n}\\.`) });

beforeEach(() => {
  vi.clearAllMocks();
  for (const a of Object.values(acoes)) a.mockResolvedValue({ ok: true });
});

describe("QuadroTarefas", () => {
  it("Enter num botão focado não abre a tarefa que está sob o mouse", () => {
    montar([t(1)]);
    fireEvent.mouseEnter(cartao(1)); // seleciona (hover)
    const novo = screen.getByRole("button", { name: "Nova tarefa em A fazer" });
    novo.focus();
    fireEvent.keyDown(novo, { key: "Enter" });
    expect(screen.queryByText("Tarefa #1")).toBeNull(); // título (sr-only) do painel de detalhe
    // Do "nada" (body), Enter abre a selecionada.
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(screen.getByText("Tarefa #1")).toBeInTheDocument();
  });

  it("menu de responsável: fora da equipe aparece desabilitado; afastado marcado", async () => {
    montar([t(1, { responsavelId: "u1" })]);
    fireEvent.click(cartao(1));
    const select = await screen.findByDisplayValue("Paula");
    const opcoes = within(select).getAllByRole("option") as HTMLOptionElement[];
    expect(opcoes.map((o) => [o.textContent, o.disabled])).toEqual([
      ["Sem responsável", false],
      ["Paula", false],
      ["Lucas (fora da equipe)", true],
      ["Pedro (afastado)", false],
    ]);
  });

  it("detalhe: servidor recusa a mudança → volta ao valor de antes e mostra o erro", async () => {
    acoes.editarTarefaAction.mockResolvedValue({ erro: "Essa pessoa não pode receber tarefas deste projeto." });
    montar([t(1, { responsavelId: "u1" })]);
    fireEvent.click(cartao(1));
    const select = (await screen.findByDisplayValue("Paula")) as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(select, { target: { value: "u3" } });
    });
    expect(acoes.editarTarefaAction).toHaveBeenCalledWith("p1", "t1", { responsavelId: "u3" });
    await waitFor(() => expect(select.value).toBe("u1"));
    expect(screen.getByText(/não pode receber tarefas/)).toBeInTheDocument();
  });
});

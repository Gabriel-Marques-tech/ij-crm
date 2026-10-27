import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AcaoItem } from "@/lib/calendario/calendario";
import type { PrazoItem } from "@/lib/prazos/prazos";
import { PrazosProvider } from "../_calendario/editor-prazo";
import { ProximaSemana } from "./proxima-semana";

vi.mock("../_calendario/actions", () => ({ criarPrazoAction: vi.fn(), editarPrazoAction: vi.fn(), concluirPrazoAction: vi.fn(), excluirPrazoAction: vi.fn() }));

const pessoa = { id: "u1", nome: "Ana Vendas", fotoEm: null };
const acao: AcaoItem = { cardId: "c1", titulo: "Site", acao: "Ligar para o Zé", dia: "2026-11-03", empresa: "Padaria", fase: "Proposta", quadro: "vendas", responsavel: pessoa, vencida: false };
const prazo: PrazoItem = { id: "p1", titulo: "Entregar proposta", dia: "2026-11-02", estado: "pendente", responsavel: pessoa, card: null, podeMexer: true };

function montar(ui: React.ReactNode) {
  return render(
    <PrazosProvider eu={{ id: "u1", nome: "Ana Vendas" }} gestor={false} responsaveis={[{ id: "u1", nome: "Ana Vendas" }]} responsavelPadrao="u1">
      {ui}
    </PrazosProvider>,
  );
}

describe("ProximaSemana (o que era 'Próximos 7 dias' e passou do domingo)", () => {
  it("lista ações e prazos em ordem de dia, com a data em mono; ação leva ao card", () => {
    montar(<ProximaSemana acoes={[acao]} prazos={[prazo]} ate="2026-11-05" depois={2} kanbanHref="/kanban?resp=u1" />);
    const itens = screen.getAllByRole("listitem");
    expect(itens[0]).toHaveTextContent("Entregar proposta");
    expect(itens[1]).toHaveTextContent("Ligar para o Zé");
    expect(screen.getByRole("link", { name: /Ligar para o Zé/ })).toHaveAttribute("href", "/kanban/c1");
    expect(screen.getByText("SEG 02/11")).toHaveClass("font-mono");
    expect(screen.getByRole("button", { name: /Entregar proposta/ })).toBeInTheDocument();
    expect(screen.getByText(/\+2 cards com próxima ação depois de 05\/11/)).toBeInTheDocument();
  });

  it("vazia: diz até quando olhou", () => {
    montar(<ProximaSemana acoes={[]} prazos={[]} ate="2026-11-05" depois={0} kanbanHref="/kanban" />);
    expect(screen.getByText(/Nada na próxima semana até 05\/11/)).toBeInTheDocument();
  });
});

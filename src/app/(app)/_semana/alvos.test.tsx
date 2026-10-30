import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AcaoItem } from "@/lib/calendario/calendario";
import { agruparPorDia } from "@/lib/calendario/semana";
import type { PrazoItem } from "@/lib/prazos/prazos";
import { PrazosProvider } from "../_calendario/editor-prazo";
import { PrazosDoCard } from "../projetos/[id]/prazos-card";
import { SemanaEmColunas } from "./semana-colunas";

vi.mock("../_calendario/actions", () => ({ criarPrazoAction: vi.fn(), editarPrazoAction: vi.fn(), concluirPrazoAction: vi.fn(), excluirPrazoAction: vi.fn() }));
vi.mock("./actions", () => ({ marcarFeitaAction: vi.fn(), definirProximaAction: vi.fn() }));

const pessoa = { id: "u1", nome: "Ana Vendas", fotoEm: null };
const acao: AcaoItem = { cardId: "c1", titulo: "Site", acao: "Ligar", dia: "2026-10-28", empresa: null, fase: "Proposta", quadro: "vendas", responsavel: pessoa, vencida: false };
const prazo: PrazoItem = { id: "p1", titulo: "Entregar", dia: "2026-10-28", estado: "pendente", responsavel: pessoa, card: null, podeMexer: true };
const dias = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"];

function comProvider(ui: React.ReactNode) {
  return render(
    <PrazosProvider eu={{ id: "u1", nome: "Ana" }} gestor={false} responsaveis={[{ id: "u1", nome: "Ana" }]} responsavelPadrao="u1">
      {ui}
    </PrazosProvider>,
  );
}

describe("alvos de toque ≥ 24×24px (WCAG 2.5.8)", () => {
  it("marcar feita no mini-card", () => {
    comProvider(<SemanaEmColunas dias={agruparPorDia(dias, [acao], [])} hoje="2026-10-27" />);
    expect(screen.getByRole("button", { name: /Marcar feita: Ligar/ })).toHaveClass("size-6");
  });

  it("concluir prazo no card", () => {
    comProvider(<PrazosDoCard cardId="c1" prazos={[prazo]} hoje="2026-10-27" />);
    expect(screen.getByRole("button", { name: "Concluir Entregar" })).toHaveClass("size-6");
  });
});

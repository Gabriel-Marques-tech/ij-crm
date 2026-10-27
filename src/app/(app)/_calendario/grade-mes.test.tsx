import { fireEvent, render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AcaoItem } from "@/lib/calendario/calendario";
import { resolverPeriodo } from "@/lib/calendario/periodo";
import { agruparPorDia } from "@/lib/calendario/semana";
import type { PrazoItem } from "@/lib/prazos/prazos";
import { PrazosProvider } from "./editor-prazo";
import { GradeMes } from "./grade-mes";

vi.mock("./actions", () => ({ criarPrazoAction: vi.fn(), editarPrazoAction: vi.fn(), concluirPrazoAction: vi.fn(), excluirPrazoAction: vi.fn() }));

const pessoa = { id: "u1", nome: "Ana Vendas", fotoEm: null };
const acao = (cardId: string, dia: string, extra: Partial<AcaoItem> = {}): AcaoItem => ({
  cardId,
  titulo: `Card ${cardId}`,
  acao: `Ação ${cardId}`,
  dia,
  empresa: null,
  fase: "Proposta",
  quadro: "vendas",
  responsavel: pessoa,
  vencida: false,
  ...extra,
});
const prazo = (id: string, dia: string): PrazoItem => ({ id, titulo: `Prazo ${id}`, dia, estado: "pendente", responsavel: pessoa, card: null, podeMexer: true });

function montar(acoes: AcaoItem[], prazos: PrazoItem[]) {
  const p = resolverPeriodo("mes", undefined, new Date("2026-10-27T13:00:00Z"));
  render(
    <PrazosProvider eu={{ id: "u1", nome: "Ana Vendas" }} gestor={false} responsaveis={[{ id: "u1", nome: "Ana Vendas" }]} responsavelPadrao="u1">
      <GradeMes dias={agruparPorDia(p.grade, acoes, prazos)} hoje={p.hoje} inicio={p.primeiroDia} fim={p.ultimoDia} />
    </PrazosProvider>,
  );
  return p;
}

const celula = (dia: string) => document.querySelector(`[data-dia="${dia}"]`) as HTMLElement;

describe("GradeMes", () => {
  it("semanas completas seg–dom; dias fora do mês apagados e sem criar prazo; hoje marcado", () => {
    const p = montar([], []);
    expect(document.querySelectorAll("[data-dia]")).toHaveLength(p.grade.length);
    expect(celula("2026-09-28")).toHaveAttribute("data-fora");
    expect(within(celula("2026-09-28")).queryByRole("button", { name: /Novo prazo/ })).toBeNull();
    expect(celula("2026-10-01")).not.toHaveAttribute("data-fora");
    expect(within(celula("2026-10-01")).getByRole("button", { name: "Novo prazo em 01/10" })).toBeInTheDocument();
    expect(within(celula("2026-10-27")).getByText("27")).toHaveAttribute("aria-current", "date");
  });

  it("até 3 itens por dia; mais que isso vira '+N itens', que expande", () => {
    const dia = "2026-10-29";
    montar([acao("a", dia), acao("b", dia), acao("c", dia)], [prazo("p", dia)]);
    const c = celula(dia);
    expect(within(c).getByRole("button", { name: /Prazo p/ })).toBeInTheDocument();
    expect(within(c).getAllByRole("link", { name: /^Ação/ })).toHaveLength(1);
    const botao = within(c).getByRole("button", { name: "Mostrar mais 2 itens em 29/10" });
    expect(botao).toHaveTextContent("+2 itens");
    expect(botao).toHaveAttribute("aria-expanded", "false");
    botao.focus();
    fireEvent.click(botao);
    expect(within(c).getAllByRole("link", { name: /^Ação/ })).toHaveLength(3);
    // O mesmo botão continua montado (o foco não cai no body) e vira "Recolher".
    expect(botao).toBeInTheDocument();
    expect(botao).toHaveFocus();
    expect(botao).toHaveAttribute("aria-expanded", "true");
    expect(botao).toHaveTextContent("Recolher");
    fireEvent.click(botao);
    expect(within(c).getAllByRole("link", { name: /^Ação/ })).toHaveLength(1);
  });

  it("celular: no máximo 6 pontinhos por dia, o resto vira '+N'", () => {
    const dia = "2026-10-15";
    montar(Array.from({ length: 9 }, (_, i) => acao(`x${i}`, dia)), []);
    const pontos = within(celula(dia)).getByRole("link", { name: "9 itens em 15/10" });
    expect(pontos.querySelectorAll("[data-ponto]")).toHaveLength(5);
    expect(pontos).toHaveTextContent("+4");
  });

  it("ação liga ao card; vencida em coral", () => {
    montar([acao("v", "2026-10-20", { vencida: true })], []);
    const link = within(celula("2026-10-20")).getByRole("link", { name: "Ação v" });
    expect(link).toHaveAttribute("href", "/kanban/v");
    expect(link).toHaveAttribute("data-estado", "vencida");
  });
});

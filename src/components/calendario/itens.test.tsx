import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AcaoItem } from "@/lib/calendario/calendario";
import type { PrazoItem } from "@/lib/prazos/prazos";
import { Legenda } from "./legenda";
import { LinhaChegada } from "./linha-chegada";
import { MiniCardAcao } from "./mini-card-acao";

const acao: AcaoItem = {
  cardId: "c1",
  titulo: "Padaria — site novo",
  acao: "Ligar para o Zé",
  dia: "2026-10-28",
  empresa: "Padaria Central",
  fase: "Proposta",
  quadro: "vendas",
  responsavel: { id: "u1", nome: "Ana Vendas", fotoEm: null },
  vencida: false,
};

const prazo: PrazoItem = {
  id: "p1",
  titulo: "Entregar proposta",
  dia: "2026-10-28",
  estado: "pendente",
  responsavel: { id: "u1", nome: "Ana Vendas", fotoEm: null },
  card: null,
  podeMexer: true,
};

describe("MiniCardAcao", () => {
  it("mostra ação, empresa, fase e avatar do responsável; link para o card", () => {
    render(<MiniCardAcao item={acao} />);
    const link = screen.getByRole("link", { name: /Ligar para o Zé/ });
    expect(link).toHaveAttribute("href", "/projetos/c1");
    expect(screen.getByText("Padaria Central")).toBeInTheDocument();
    expect(screen.getByText("Proposta")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Responsável: Ana Vendas" })).toBeInTheDocument();
    expect(screen.getByRole("article")).toHaveAttribute("data-estado", "normal");
  });

  it("vencida: estado coral e rótulo legível", () => {
    render(<MiniCardAcao item={{ ...acao, vencida: true }} />);
    expect(screen.getByRole("article")).toHaveAttribute("data-estado", "vencida");
    expect(screen.getByText(/vencida/)).toBeInTheDocument();
  });

  it("sem texto de ação nem empresa: usa o título do card", () => {
    render(<MiniCardAcao item={{ ...acao, acao: null, empresa: null }} />);
    expect(screen.getByRole("link", { name: /Próxima ação/ })).toBeInTheDocument();
    expect(screen.getByText("Padaria — site novo")).toBeInTheDocument();
  });
});

describe("LinhaChegada", () => {
  it("🏁 com o nome do prazo acima da faixa quadriculada; clique abre o editor", () => {
    const abrir = vi.fn();
    render(<LinhaChegada prazo={prazo} onAbrir={abrir} />);
    const botao = screen.getByRole("button", { name: /Entregar proposta/ });
    expect(botao).toHaveAttribute("data-estado", "pendente");
    expect(botao.textContent).toContain("🏁");
    expect(botao.querySelector("[data-faixa]")).not.toBeNull();
    fireEvent.click(botao);
    expect(abrir).toHaveBeenCalledWith(prazo);
  });

  it("vencido e não feito → estado vencido; feito → ✓ e riscado", () => {
    const { rerender } = render(<LinhaChegada prazo={{ ...prazo, estado: "vencido" }} onAbrir={() => {}} />);
    expect(screen.getByRole("button")).toHaveAttribute("data-estado", "vencido");
    expect(screen.getByRole("button", { name: /vencido/ })).toBeInTheDocument();
    rerender(<LinhaChegada prazo={{ ...prazo, estado: "feito" }} onAbrir={() => {}} />);
    const b = screen.getByRole("button", { name: /feito/ });
    expect(b).toHaveAttribute("data-estado", "feito");
    expect(b.textContent).toContain("✓");
  });
});

describe("Legenda", () => {
  it("explica ação, ação vencida, prazo, prazo vencido, prazo feito e hoje", () => {
    render(<Legenda />);
    for (const t of ["Próxima ação", "Ação vencida", "Prazo", "Prazo vencido", "Prazo feito", "Hoje"]) expect(screen.getByText(t)).toBeInTheDocument();
  });
});

describe("MiniCardAcao: mais urgente (Minha Semana)", () => {
  it("marca o card do destaque", () => {
    render(<MiniCardAcao item={acao} urgente />);
    expect(screen.getByRole("article")).toHaveAttribute("data-urgente");
    expect(screen.getByText(/mais urgente/)).toBeInTheDocument();
  });

  it("sem a marca por padrão", () => {
    render(<MiniCardAcao item={acao} />);
    expect(screen.getByRole("article")).not.toHaveAttribute("data-urgente");
  });
});

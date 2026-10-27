import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TabelaMetricas, type LinhaMetricas } from "./tabela-metricas";

const base: Omit<LinhaMetricas, "id" | "nome"> = {
  fotoEm: null,
  pontos: 0,
  ganhos: 0,
  perdidos: 0,
  conversao: null,
  fechado: 0,
  ticketMedio: null,
  tempoMedioGanhoDias: null,
  avancos: 0,
  acoesFeitas: 0,
  abertos: 0,
  emAberto: 0,
};
const linhas: LinhaMetricas[] = [
  { ...base, id: "a", nome: "Ana", pontos: 10, conversao: 0.5 },
  { ...base, id: "b", nome: "Bia", pontos: 30, conversao: null },
  { ...base, id: "c", nome: "Caio", pontos: 20, conversao: 0.9 },
];

const nomes = () =>
  within(screen.getAllByRole("rowgroup")[1])
    .getAllByRole("rowheader")
    .map((th) => th.querySelector(".truncate")?.textContent);

describe("TabelaMetricas", () => {
  it("começa por pontos (maior primeiro), ordena por coluna e deixa '—' no fim", () => {
    render(<TabelaMetricas linhas={linhas} time={{ ...base, id: "time", nome: "Time", pontos: 60 }} euId="a" />);
    expect(nomes()).toEqual(["Bia", "Caio", "Ana"]);
    fireEvent.click(screen.getByRole("button", { name: /Conversão/ }));
    expect(nomes()).toEqual(["Caio", "Ana", "Bia"]);
    fireEvent.click(screen.getByRole("button", { name: /Conversão/ }));
    expect(nomes()).toEqual(["Ana", "Caio", "Bia"]);
    expect(screen.getByText(/total · médias do time/)).toBeInTheDocument();
  });
});

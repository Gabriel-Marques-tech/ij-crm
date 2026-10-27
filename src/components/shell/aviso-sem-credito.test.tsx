import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AvisoSemCredito } from "./aviso-sem-credito";

describe("banner de sem crédito na LLM (GAB-46)", () => {
  it("mostra desde quando, em fuso de São Paulo e fonte mono", () => {
    render(<AvisoSemCredito desde={new Date("2026-10-26T13:05:00Z")} />);
    const alerta = screen.getByRole("alert");
    expect(alerta).toHaveTextContent("Sem crédito na API de LLM");
    expect(alerta).toHaveTextContent("reprocessadas depois da recarga");
    const hora = screen.getByText("26/10/2026 10:05");
    expect(hora.className).toContain("font-mono");
  });
});

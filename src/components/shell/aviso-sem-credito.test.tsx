import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AvisoSemCredito } from "./aviso-sem-credito";

describe("banner de sem crédito na LLM (GAB-46)", () => {
  it("mostra desde quando e o último erro, em fuso de São Paulo e fonte mono", () => {
    render(<AvisoSemCredito desde={new Date("2026-10-26T13:05:00Z")} ultimoErro={new Date("2026-10-27T09:40:00Z")} />);
    const alerta = screen.getByRole("alert");
    expect(alerta).toHaveTextContent("Sem crédito na API de LLM");
    expect(alerta).toHaveTextContent("reprocessadas depois da recarga");
    // Mesmo incidente da cota diária do Gemini (COTA_DIARIA divide a linha do alerta).
    expect(alerta).toHaveTextContent("ou quando a cota diária do Gemini voltar");
    const hora = screen.getByText("26/10/2026 10:05");
    expect(hora.className).toContain("font-mono");
    expect(alerta).toHaveTextContent("Último erro de crédito: 27/10/2026 06:40");
    expect(screen.getByText("27/10/2026 06:40").className).toContain("font-mono");
  });
});

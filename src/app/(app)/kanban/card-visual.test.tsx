import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CardVisual } from "./card-visual";
import type { CardCliente } from "./tipos";

const AGORA = new Date("2026-10-27T15:00:00Z").getTime();

const base: CardCliente = {
  id: "c1",
  titulo: "Padaria do Zé",
  descricaoPrevia: null,
  descricaoTruncada: false,
  faseId: "f1",
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
};

describe("CardVisual: prévia da descrição", () => {
  it("mostra a descrição em texto apagado, presa em 2 linhas", () => {
    render(<CardVisual card={{ ...base, descricaoPrevia: "Site novo\ncom loja\ne blog" }} fase={undefined} agoraMs={AGORA} />);
    const previa = screen.getByTestId("previa-descricao");
    expect(previa.textContent).toBe("Site novo\ncom loja\ne blog");
    expect(previa).toHaveClass("line-clamp-2");
    expect(previa).toHaveClass("text-fg-mute");
  });

  it("prévia truncada no servidor ganha reticências", () => {
    render(<CardVisual card={{ ...base, descricaoPrevia: "começo", descricaoTruncada: true }} fase={undefined} agoraMs={AGORA} />);
    expect(screen.getByTestId("previa-descricao").textContent).toBe("começo…");
  });

  it("sem descrição, nada de prévia (o card não cresce)", () => {
    render(<CardVisual card={base} fase={undefined} agoraMs={AGORA} />);
    expect(screen.queryByTestId("previa-descricao")).toBeNull();
  });

  it("HTML na descrição aparece como texto, não vira elemento", () => {
    const { container } = render(<CardVisual card={{ ...base, descricaoPrevia: "<img src=x onerror=alert(1)>" }} fase={undefined} agoraMs={AGORA} />);
    expect(screen.getByTestId("previa-descricao").textContent).toBe("<img src=x onerror=alert(1)>");
    expect(container.querySelector("img")).toBeNull();
  });
});

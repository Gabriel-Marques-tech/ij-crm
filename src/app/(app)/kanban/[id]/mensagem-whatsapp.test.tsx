import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MensagemWhatsapp } from "./mensagem-whatsapp";

describe("MensagemWhatsapp (Timeline)", () => {
  it("mostra o texto original e o JSON da LLM recolhido", () => {
    const { container } = render(
      <MensagemWhatsapp
        payload={{
          texto: "#crm falei com o Gustavo",
          versao: "extracao.v1",
          modelo: "claude-haiku-5-5",
          saida: { intencao: "CRIAR", confianca: 0.9 },
          motivosRevisar: ["confiança baixa da leitura"],
          sugestoes: [],
        }}
      />,
    );
    expect(screen.getByText("#crm falei com o Gustavo")).toBeInTheDocument();
    expect(screen.getByText("confiança baixa da leitura", { selector: "span" })).toBeInTheDocument();
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain("Leitura da LLM");
    expect(details.textContent).toContain("extracao.v1 · claude-haiku-5-5");
    expect(details.querySelector("pre")!.textContent).toContain('"intencao": "CRIAR"');
  });

  it("sem resultado da LLM (ex.: import antigo) mostra só o texto", () => {
    const { container } = render(<MensagemWhatsapp payload={{ texto: "oi" }} />);
    expect(container.querySelector("details")).toBeNull();
  });
});

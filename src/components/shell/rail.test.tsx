import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QuadroAtivoProvider } from "./quadro-ativo";
import { Rail } from "./rail";

vi.mock("next/navigation", () => ({
  usePathname: () => "/semana",
  useSearchParams: () => new URLSearchParams(),
}));

describe("Rail: logo da IJ no topo", () => {
  it("mostra o símbolo da IJ com alt em português, levando ao início", () => {
    render(
      <QuadroAtivoProvider>
        <Rail papel="VENDEDOR" />
      </QuadroAtivoProvider>,
    );
    const [desktop] = screen.getAllByRole("navigation", { name: "Principal" });
    const logo = within(desktop).getByRole("img", { name: "Inteli Júnior" });
    expect(logo.getAttribute("src")).toContain("simbolo-ij");
    expect(logo.closest("a")).toHaveAttribute("href", "/");
    // O "IJ" em texto (wordmark provisório) saiu.
    expect(desktop.textContent).not.toMatch(/^IJ/);
  });
});

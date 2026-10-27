import { existsSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import NaoEncontradaApp from "./not-found";

describe("not-found dentro da app", () => {
  it("existe em (app)/ para notFound() manter rail e topbar (o layout do grupo envolve a página)", () => {
    expect(existsSync(join(process.cwd(), "src/app/(app)/not-found.tsx"))).toBe(true);
    expect(existsSync(join(process.cwd(), "src/app/not-found.tsx"))).toBe(true);
  });

  it("mostra o mascote com a placa, o título e o link de volta", () => {
    render(<NaoEncontradaApp />);
    expect(screen.getByRole("heading", { name: "Não encontramos isso" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Mascote da Inteli Júnior segurando uma placa" })).toBeInTheDocument();
    expect(screen.getByText("Voltar ao início").closest("a")).toHaveAttribute("href", "/");
  });
});

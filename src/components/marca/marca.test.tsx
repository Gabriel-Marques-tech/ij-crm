// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";
import AuthLayout from "@/app/(auth)/layout";
import { MARCA } from "./assets";
import { SimboloIJ } from "./marca";

describe("marca: entrega sem otimizador", () => {
  it("next.config desliga o otimizador (a imagem de produção não leva sharp)", () => {
    expect(nextConfig.images?.unoptimized).toBe(true);
  });

  it("todo asset da marca existe em public/ e as dimensões batem com o arquivo WebP", () => {
    for (const a of Object.values(MARCA)) {
      const buf = readFileSync(join(process.cwd(), "public", a.src));
      // WebP: RIFF....WEBP; VP8X traz largura/altura (24 bits, -1) nos bytes 24..29.
      expect(buf.subarray(0, 4).toString()).toBe("RIFF");
      expect(buf.subarray(12, 16).toString()).toBe("VP8X");
      const largura = buf.readUIntLE(24, 3) + 1;
      const altura = buf.readUIntLE(27, 3) + 1;
      expect({ src: a.src, largura, altura }).toEqual({ src: a.src, largura: a.largura, altura: a.altura });
      expect(buf.length).toBeLessThan(60_000);
    }
  });
});

describe("marca: prioridade de carregamento", () => {
  // next/image: priority = carrega já (sem loading="lazy"); sem priority = lazy.
  it("símbolo (rail/topbar) não é priority: carrega lazy", () => {
    render(<SimboloIJ tamanho={48} />);
    expect(screen.getByRole("img", { name: "Inteli Júnior" })).toHaveAttribute("loading", "lazy");
  });

  it("auth: logo é o único priority; mascote em pé é decorativo (alt vazio) e lazy", () => {
    const { container } = render(
      <AuthLayout>
        <p>form</p>
      </AuthLayout>,
    );
    const logo = screen.getByRole("img", { name: "Inteli Júnior" });
    expect(logo).not.toHaveAttribute("loading", "lazy");
    const mascote = [...container.querySelectorAll("img")].find((i) => i.getAttribute("src")?.includes("mascote-em-pe"));
    expect(mascote).toBeDefined();
    expect(mascote).toHaveAttribute("alt", "");
    expect(mascote).toHaveAttribute("loading", "lazy");
  });
});

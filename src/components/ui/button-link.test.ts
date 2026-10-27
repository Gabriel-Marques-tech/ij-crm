// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * O Button do Base UI assume `<button>` nativo. Renderizado como link
 * (`render={<a …/>}` ou `render={<Link …/>}`) ele precisa de
 * `nativeButton={false}`, senão o Base UI acusa erro no console e a
 * semântica de botão vai para um elemento que não é botão.
 */
function arquivosTsx(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivosTsx(caminho);
    return caminho.endsWith(".tsx") ? [caminho] : [];
  });
}

describe("Button renderizado como link", () => {
  it("sempre declara nativeButton={false}", () => {
    const sem = arquivosTsx(join(process.cwd(), "src")).flatMap((arquivo) =>
      readFileSync(arquivo, "utf8")
        .split("\n")
        .map((linha, i) => ({ linha, n: i + 1 }))
        .filter(
          ({ linha }) =>
            /<Button\b/.test(linha) &&
            /render=\{<(a|Link)[\s>]/.test(linha) &&
            !linha.includes("nativeButton={false}"),
        )
        .map(({ n }) => `${arquivo}:${n}`),
    );
    expect(sem).toEqual([]);
  });
});

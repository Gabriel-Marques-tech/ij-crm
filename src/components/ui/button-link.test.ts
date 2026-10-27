// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Componentes do Base UI que agem como botão (Button, *Trigger, *Close…)
 * assumem `<button>` nativo. Renderizados como link (`render={<a …/>}` ou
 * `render={<Link …/>}`) precisam de `nativeButton={false}`, senão o Base UI
 * acusa erro no console e a semântica de botão vai para um elemento que não
 * é botão. A varredura olha a tag de abertura inteira (JSX em várias linhas
 * inclusive), qualquer que seja o componente.
 */
const RENDER_LINK = /render=\{\s*<(a|Link)(?=[\s/>])/g;

function arquivosTsx(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivosTsx(caminho);
    return caminho.endsWith(".tsx") ? [caminho] : [];
  });
}

/** Fim da tag de abertura que contém `pos`: primeiro `>` fora de `{…}`. */
function fimDaTag(fonte: string, pos: number): number {
  let chaves = 0;
  for (let i = pos; i < fonte.length; i++) {
    const c = fonte[i];
    if (c === "{") chaves++;
    else if (c === "}") chaves--;
    else if (c === ">" && chaves === 0) return i;
  }
  return fonte.length;
}

/** Tags de abertura com render de link e sem `nativeButton={false}`. */
export function semNativeButton(fonte: string): number[] {
  const linhas: number[] = [];
  for (const m of fonte.matchAll(RENDER_LINK)) {
    const inicio = fonte.lastIndexOf("<", m.index - 1);
    const tag = fonte.slice(inicio, fimDaTag(fonte, m.index) + 1);
    if (!/\bnativeButton=\{false\}/.test(tag)) {
      linhas.push(fonte.slice(0, m.index).split("\n").length);
    }
  }
  return linhas;
}

describe("componente de botão renderizado como link", () => {
  it("a varredura pega os casos difíceis", () => {
    expect(semNativeButton(`<Button render={<a href="/x" />}>x</Button>`)).toEqual([1]);
    expect(semNativeButton(`<Button\n  variant="outline"\n  render={ <Link href="/" /> }\n>x</Button>`)).toEqual([3]);
    expect(semNativeButton(`<DialogClose render={<a/>} />`)).toEqual([1]);
    expect(semNativeButton(`<Button nativeButton={true} render={<Link href="/" />} />`)).toEqual([1]);
    expect(semNativeButton(`<Button\n  render={<Link href={f({ a: 1 })} />}\n  nativeButton={false}\n/>`)).toEqual([]);
    expect(semNativeButton(`<SheetTrigger render={<Button variant="outline" />} />`)).toEqual([]);
    expect(semNativeButton(`<Button render={<abbr />} />`)).toEqual([]);
  });

  it("todo o src/ declara nativeButton={false}", () => {
    const sem = arquivosTsx(join(process.cwd(), "src")).flatMap((arquivo) =>
      semNativeButton(readFileSync(arquivo, "utf8")).map((n) => `${arquivo}:${n}`),
    );
    expect(sem).toEqual([]);
  });
});

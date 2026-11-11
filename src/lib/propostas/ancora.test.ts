import { describe, expect, it } from "vitest";
import { normalizarDocumento, type Documento } from "./documento";
import { markdownParaDocumento } from "./markdown";
import { TOKEN_BLOCO, trechoLegivel, ancoraDoBloco, CONTEXTO_ANCORA, criarAncora, localizarAncora, normalizarBloco, normalizarContexto, normalizarTrecho, OCORRENCIAS_MAX, segmentosDeDestaque, textoPlano, TRECHO_MAX } from "./ancora";

const doc: Documento = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Escopo" }] },
    { type: "paragraph", content: [{ type: "text", text: "Site " }, { type: "text", text: "com loja", marks: [{ type: "bold" }] }] },
    { type: "paragraph" },
    { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "item" }] }] }] },
    { type: "horizontalRule" },
  ],
};

describe("textoPlano: o texto corrido em que a âncora vive", () => {
  it("blocos de texto não vazios, na ordem do documento, separados por \\n", () => {
    const p = textoPlano(doc);
    // Os blocos móveis entram por um caractere reservado; sem bloco posicionado, os dois ficam no fim (GAB-100).
    expect(p.texto).toBe("Escopo\nSite com loja\nitem\n\uE001\n\uE002");
    expect(p.inicios.get(doc.content[0])).toBe(0);
    expect(p.inicios.get(doc.content[1])).toBe(7);
    expect(p.inicios.has(doc.content[2])).toBe(false); // parágrafo vazio não conta
  });
});

describe("criarAncora: trecho + contexto curto em volta", () => {
  const t = "Escopo\nSite com loja\nitem";
  it("guarda o trecho e até CONTEXTO_ANCORA caracteres de cada lado", () => {
    expect(criarAncora(t, 7, 11)).toEqual({ trecho: "Site", antes: "Escopo\n", depois: " com loja\nitem" });
    const longo = "a".repeat(100) + "X" + "b".repeat(100);
    const a = criarAncora(longo, 100, 101)!;
    expect(a.antes).toHaveLength(CONTEXTO_ANCORA);
    expect(a.depois).toHaveLength(CONTEXTO_ANCORA);
  });

  it("apara espaços da seleção; seleção vazia ou só espaço → null", () => {
    expect(criarAncora(t, 6, 12)).toEqual({ trecho: "Site", antes: "Escopo\n", depois: " com loja\nitem" });
    expect(criarAncora(t, 3, 3)).toBeNull();
    expect(criarAncora("a   b", 1, 4)).toBeNull();
  });

  it("trecho maior que TRECHO_MAX → null (a tela pede um trecho menor)", () => {
    const grande = "x".repeat(TRECHO_MAX + 1);
    expect(criarAncora(grande, 0, grande.length)).toBeNull();
    expect(criarAncora(grande, 0, TRECHO_MAX)).not.toBeNull();
  });
});

describe("localizarAncora: reencontra o trecho no documento atual", () => {
  it("achado uma vez: a posição", () => {
    const t = "Escopo\nSite com loja\nitem";
    expect(localizarAncora(t, { trecho: "com loja", antes: "Site ", depois: "\nitem" })).toEqual({ inicio: 12, fim: 20 });
  });

  it("texto mudou em volta: o trecho intacto continua achado", () => {
    expect(localizarAncora("Novo começo. Site com loja e blog", { trecho: "com loja", antes: "Site ", depois: "\nitem" })).toEqual({ inicio: 18, fim: 26 });
  });

  it("várias ocorrências: escolhe a de contexto mais parecido", () => {
    const t = "prazo de 30 dias para o site; prazo de 30 dias para o app";
    const a = criarAncora(t, t.lastIndexOf("30 dias"), t.lastIndexOf("30 dias") + 7)!;
    expect(localizarAncora(t, a)).toEqual({ inicio: t.lastIndexOf("30 dias"), fim: t.lastIndexOf("30 dias") + 7 });
    const b = criarAncora(t, t.indexOf("30 dias"), t.indexOf("30 dias") + 7)!;
    expect(localizarAncora(t, b)).toEqual({ inicio: t.indexOf("30 dias"), fim: t.indexOf("30 dias") + 7 });
  });

  it("trecho editado ou apagado → null (\"trecho alterado\")", () => {
    expect(localizarAncora("Site com loja virtual", { trecho: "com blog", antes: "", depois: "" })).toBeNull();
    expect(localizarAncora("", { trecho: "x", antes: "", depois: "" })).toBeNull();
  });
});

describe("segmentosDeDestaque: um bloco de texto cortado nas bordas dos destaques", () => {
  it("corta nas bordas e diz quais comentários cobrem cada pedaço", () => {
    const s = segmentosDeDestaque(10, 10, [
      { id: "a", inicio: 12, fim: 15 },
      { id: "b", inicio: 14, fim: 30 },
      { id: "c", inicio: 0, fim: 5 }, // fora do bloco
    ]);
    expect(s).toEqual([
      { inicio: 10, fim: 12, ids: [] },
      { inicio: 12, fim: 14, ids: ["a"] },
      { inicio: 14, fim: 15, ids: ["a", "b"] },
      { inicio: 15, fim: 20, ids: ["b"] },
    ]);
  });

  it("sem destaques: um pedaço só", () => {
    expect(segmentosDeDestaque(0, 4, [])).toEqual([{ inicio: 0, fim: 4, ids: [] }]);
  });
});

describe("normalização igual à do Markdown canônico", () => {
  it("normalizarBloco: pontas, espaços repetidos, tab, quebra, CRLF e controle; mapa para o índice cru", () => {
    expect(normalizarBloco("  a  b\tc\r\nd\u0001e  ")).toEqual({ texto: "a b c de", mapa: [2, 3, 5, 6, 7, 9, 10, 12] });
    expect(normalizarBloco("   ").texto).toBe("");
  });

  it("normalizarTrecho mantém o \\n entre blocos; normalizarContexto não apara as bordas", () => {
    expect(normalizarTrecho("  fim  do bloco \n  outro  ")).toBe("fim do bloco\noutro");
    expect(normalizarContexto("Prazo:  ")).toBe("Prazo: ");
  });

  it("localizarAncora examina no máximo OCORRENCIAS_MAX ocorrências", () => {
    const t = "ab ".repeat(OCORRENCIAS_MAX + 50) + "ab FIM";
    // A ocorrência certa (antes de FIM) passa do teto: fica a melhor entre as examinadas, sem travar.
    expect(localizarAncora(t, { trecho: "ab", antes: "", depois: " FIM" })).not.toBeNull();
  });
});

describe("âncora e blocos móveis (GAB-100)", () => {
  const p = (text: string) => ({ type: "paragraph" as const, content: [{ type: "text" as const, text }] });
  const b = (tipo: "cronograma" | "investimento") => ({ type: "blocoDados" as const, attrs: { tipo } });

  it("o bloco entra pelo caractere reservado, na posição dele; proposta antiga tem os dois no fim", () => {
    expect(textoPlano({ type: "doc", content: [p("A"), b("cronograma"), p("B")] }).texto).toBe("A\n\uE001\nB");
    expect(textoPlano({ type: "doc", content: [p("A")] }).texto).toBe("A\n\uE001\n\uE002");
    expect(textoPlano({ type: "doc", content: [p("A"), { type: "semBlocos" }] }).texto).toBe("A");
  });

  it("mesmo texto plano para o servidor (normalizado, sem os blocos do fim) e o editor (com os blocos explícitos)", () => {
    const editor: Documento = { type: "doc", content: [p("A"), b("cronograma"), b("investimento"), { type: "paragraph" }] };
    const servidor = normalizarDocumento(editor);
    expect(servidor.content).toEqual([p("A")]);
    expect(textoPlano(servidor).texto).toBe(textoPlano(normalizarDocumento(editor)).texto);
    expect(textoPlano(servidor).texto).toBe("A\n\uE001\n\uE002");
  });

  it("ancoraDoBloco: acha o bloco, nunca um título igual no texto; bloco fora da folha fica alterado; o texto nunca cai no bloco", () => {
    const d: Documento = { type: "doc", content: [p("Cronograma"), p("meio"), b("cronograma"), p("fim")] };
    const a = ancoraDoBloco(d, "cronograma")!;
    expect(trechoLegivel(a.trecho)).toBe("Cronograma");
    const plano = textoPlano(d).texto;
    expect(localizarAncora(plano, a)?.inicio).toBe(plano.indexOf(a.trecho));
    expect(ancoraDoBloco(d, "investimento")).toBeNull();
    const semBloco = textoPlano({ type: "doc", content: [p("Cronograma"), p("meio"), { type: "semBlocos" }] }).texto;
    expect(localizarAncora(semBloco, a)).toBeNull();
    // Citar a palavra no texto, com o título apagado e o bloco na folha: alterado, não migra para o bloco.
    const citado = { trecho: "Cronograma", antes: "", depois: "" };
    expect(localizarAncora(textoPlano({ type: "doc", content: [p("meio"), b("cronograma")] }).texto, citado)).toBeNull();
  });

  it("trecho que atravessa um bloco continua achado se o bloco sair ou mudar de lugar; o do próprio bloco, não", () => {
    const com = textoPlano({ type: "doc", content: [p("Um."), b("cronograma"), p("Dois."), { type: "semBlocos" }] }).texto;
    const a = criarAncora(com, 0, com.length)!;
    expect(a.trecho).toContain(TOKEN_BLOCO.cronograma);
    const sem = textoPlano({ type: "doc", content: [p("Um."), p("Dois."), { type: "semBlocos" }] }).texto;
    expect(localizarAncora(sem, a)).toEqual({ inicio: 0, fim: sem.length });
    const trecho = { trecho: "Um.\nDois.", antes: "", depois: "" };
    const f = localizarAncora(com, trecho)!;
    expect(com.slice(f.inicio, f.fim)).toBe(com);
    expect(localizarAncora(sem, { trecho: TOKEN_BLOCO.cronograma, antes: "", depois: "" })).toBeNull();
  });

  it("caractere reservado colado no texto é retirado na normalização", () => {
    expect(normalizarDocumento({ type: "doc", content: [p("a\uE001b\uE002c")] }).content).toEqual([p("abc")]);
  });

  it("mover o bloco não deixa alterado o comentário de quem cita o texto em volta", () => {
    const antes: Documento = { type: "doc", content: [p("Trecho comentado."), p("Outro.")] };
    const texto = textoPlano(antes).texto;
    const a = criarAncora(texto, 0, 17)!;
    const depois = textoPlano({ type: "doc", content: [p("Trecho comentado."), b("cronograma"), p("Outro.")] }).texto;
    expect(localizarAncora(depois, a)).not.toBeNull();
  });

  it("segunda busca (trecho atravessa bloco que saiu): o `\\n` final de `antes` conta, e o destaque fica na segunda ocorrência", () => {
    const original = "x\nB\n\uE001\nC\ny\nB\n\uE002\nC";
    const inicio = original.lastIndexOf("B");
    const a = criarAncora(original, inicio, original.length)!;
    expect(a.antes.endsWith("y\n")).toBe(true);
    const semOsBlocos = "x\nB\nC\ny\nB\nC";
    expect(localizarAncora(semOsBlocos, a)).toEqual({ inicio: semOsBlocos.lastIndexOf("B"), fim: semOsBlocos.length });
  });
});

describe("tabela (GAB-102)", () => {
  const md = "Antes da tabela.\n\n| Item | Valor |\n| --- | --- |\n| Site a\\|b | |\n| <!-- total --> **Total** | R$ 10 |\n\nDepois.";
  const d = markdownParaDocumento(md);

  it("cada célula não vazia é um bloco do texto plano, sem nada do Markdown", () => {
    expect(textoPlano(d).texto.split(TOKEN_BLOCO.cronograma)[0]).toBe("Antes da tabela.\nItem\nValor\nSite a|b\nTotal\nR$ 10\nDepois.\n");
  });

  it("documento sem tabela tem o mesmo texto plano de antes, e a âncora antiga continua achada", () => {
    const antigo = markdownParaDocumento("a | b\n\n- item | x");
    const { texto } = textoPlano(antigo);
    expect(texto.startsWith("a | b\nitem | x")).toBe(true);
    expect(localizarAncora(texto, { trecho: "a | b", antes: "", depois: "\nitem" })).toEqual({ inicio: 0, fim: 5 });
  });

  it("trecho em célula: criado, achado e com o pipe de verdade", () => {
    const { texto } = textoPlano(d);
    const i = texto.indexOf("a|b");
    const a = criarAncora(texto, i, i + 3)!;
    expect(a.trecho).toBe("a|b");
    expect(localizarAncora(texto, a)).toEqual({ inicio: i, fim: i + 3 });
  });

  it("trecho que atravessa células guarda a quebra entre elas", () => {
    const { texto } = textoPlano(d);
    const i = texto.indexOf("Total");
    const a = criarAncora(texto, i, i + "Total\nR$ 10".length)!;
    expect(a.trecho).toBe("Total\nR$ 10");
    expect(localizarAncora(texto, a)?.inicio).toBe(i);
  });

  it("mudar a célula deixa o comentário como trecho alterado; mudar outra célula não", () => {
    const { texto } = textoPlano(d);
    const i = texto.indexOf("R$ 10");
    const a = criarAncora(texto, i, i + 5)!;
    expect(localizarAncora(textoPlano(markdownParaDocumento(md.replace("R$ 10", "R$ 20"))).texto, a)).toBeNull();
    expect(localizarAncora(textoPlano(markdownParaDocumento(md.replace("Antes", "Bem antes"))).texto, a)).not.toBeNull();
  });

  it("inserir tabela não invalida âncora de parágrafo", () => {
    const antes = markdownParaDocumento("Um.\n\nDois.");
    const { texto } = textoPlano(antes);
    const a = criarAncora(texto, 4, 9)!;
    const depois = textoPlano(markdownParaDocumento("Um.\n\n| x |\n| --- |\n\nDois.")).texto;
    expect(depois.slice(localizarAncora(depois, a)!.inicio).startsWith("Dois.")).toBe(true);
  });
});

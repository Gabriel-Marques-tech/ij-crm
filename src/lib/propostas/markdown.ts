/**
 * Conversão Markdown ↔ documento da proposta (GAB-86). Fonte da verdade
 * gravada: o Markdown CANÔNICO que `documentoParaMarkdown` produz.
 *
 * - `documentoParaMarkdown`: serializador próprio (o subconjunto é pequeno);
 *   escapa todo caractere de texto que o Markdown leria como formatação.
 * - `markdownParaDocumento`: o lexer do `marked` (sem dependências, só no
 *   servidor) quebra o Markdown em tokens; cada token fora do subconjunto
 *   (link, imagem, HTML, código…) vira TEXTO literal. Nada aqui gera
 *   HTML: a tela desenha o documento como elementos React (texto escapado), e
 *   o editor recebe JSON — Markdown/HTML vindo do MCP nunca injeta marcação.
 *
 * Blocos móveis (GAB-100): comentário HTML sozinho na linha, no nível de cima:
 * `<!-- bloco:cronograma -->`, `<!-- bloco:investimento -->`, e `<!-- bloco:nenhum -->`
 * quando os dois foram tirados da folha. Texto que só parece um marcador sai
 * escapado (`\\<!-- ...`), então Markdown canônico antigo nunca vira bloco, e
 * qualquer outro comentário continua literal. Só esses três viram nó, e o nó não
 * guarda dado nenhum: só o lugar.
 *
 * Tabela (GAB-102): tabela GFM padrão, no nível de cima, com `| --- |` em todas as colunas.
 * A linha de total leva `<!-- total -->` no começo da primeira célula: acompanha a linha se
 * alguém a mover, e outro leitor de Markdown não mostra. `a | b` em parágrafo continua texto, sem
 * escape novo, e Markdown canônico antigo nunca vira tabela: lá não existem duas linhas de
 * texto coladas, e a régua precisa vir colada no cabeçalho. Pipe na
 * célula sai `\|`; `<br>` vira espaço; linha com células a mais alarga a tabela, e com células a
 * menos completa com vazias. Colunas alinhadas (`:---:`) perdem o alinhamento: o modelo da IJ é
 * um só. Tabela além dos limites (ou dentro de lista) vira parágrafos `a | b`, sem perder texto.
 *
 * Garantias (testadas em `markdown.test.ts`, inclusive com documentos
 * aleatórios): para todo documento normalizado `d`,
 * `markdownParaDocumento(documentoParaMarkdown(d))` é `d`; e o Markdown
 * canônico é ponto fixo de `normalizarMarkdown`.
 */
import { Lexer, type Token, type Tokens } from "marked";
import { MARCAS, normalizarDocumento, normalizarTabela, tabelaComoParagrafos, type Bloco, type Documento, type ItemLista, type LinhaTabela, type Marca, type NoTexto, type Tabela, type TipoBlocoDados } from "./documento";
import { medirTabela, motivoForaDoLimite } from "./tabela";

// ---------------------------------------------------------------- doc → Markdown

const DELIM: Record<Marca, string> = { bold: "**", italic: "*" };

const marcadorDe = (tipo: TipoBlocoDados | "nenhum") => `<!-- bloco:${tipo} -->`;
const MARCADOR = /^<!--\s*bloco:(cronograma|investimento|nenhum)\s*-->$/;
const MARCA_TOTAL = "<!-- total -->";
const MARCA_TOTAL_NA_CELULA = /^<!--\s*total\s*-->\s*/;

/** Caracteres que o Markdown pode ler como formatação em qualquer ponto da linha. */
const ESCAPAR_SEMPRE = /[\\*_`[\]<~]/g;

/** Onde o texto vai: o que precisa de escape além do que vale em todo lugar. */
type Lugar = "bloco" | "titulo" | "celula";

function escaparTexto(texto: string, inicioDeLinha: boolean, lugar: Lugar): string {
  // `&` só antes de algo com cara de entidade (`&#42;`, `&amp;`): o `marked` decodifica algumas.
  let s = texto.replace(ESCAPAR_SEMPRE, (c) => `\\${c}`).replace(/&(?=#?[0-9A-Za-z]+;)/g, "\\&");
  if (lugar === "titulo") s = s.replace(/#/g, "\\#");
  // Na célula só o pipe é especial: ela nunca é lida como início de bloco.
  if (lugar === "celula") return s.replace(/\|/g, "\\|");
  if (inicioDeLinha) {
    if (/^[#>+\-=|]/.test(s)) s = `\\${s}`;
    else s = s.replace(/^(\d{1,9})([.)])/, "$1\\$2");
  }
  return s;
}

/**
 * Texto inline com as marcas como pilha de delimitadores. A marca que vai mais
 * longe abre primeiro (fica por fora): assim "itálico que contém um negrito"
 * sai `*a **b** c*` e não fecha/reabre delimitadores colados.
 */
function serializarInline(content: NoTexto[] | undefined, lugar: Lugar = "bloco"): string {
  const nos = content ?? [];
  const marcasDe = (n: NoTexto) => MARCAS.filter((m) => (n.marks ?? []).some((x) => x.type === m));
  const marcas = nos.map(marcasDe);
  // alcance[m][i]: quantos nós seguidos, a partir de i, têm a marca m (linear, de trás para frente)
  const alcances = Object.fromEntries(
    MARCAS.map((m) => {
      const a = new Array<number>(nos.length + 1).fill(0);
      for (let i = nos.length - 1; i >= 0; i--) a[i] = marcas[i].includes(m) ? a[i + 1] + 1 : 0;
      return [m, a];
    }),
  ) as Record<Marca, number[]>;
  const alcance = (m: Marca, de: number) => alcances[m][de];
  let saida = "";
  const abertas: Marca[] = [];
  nos.forEach((n, i) => {
    const quer = marcas[i];
    // fecha da primeira marca aberta que não continua até o topo da pilha
    const corte = abertas.findIndex((m) => !quer.includes(m));
    if (corte >= 0) {
      for (let k = abertas.length - 1; k >= corte; k--) saida += DELIM[abertas[k]];
      abertas.length = corte;
    }
    const novas = quer.filter((m) => !abertas.includes(m)).sort((a, b) => alcance(b, i) - alcance(a, i) || MARCAS.indexOf(a) - MARCAS.indexOf(b));
    for (const m of novas) {
      saida += DELIM[m];
      abertas.push(m);
    }
    saida += escaparTexto(n.text, saida.length === 0, lugar);
  });
  for (let k = abertas.length - 1; k >= 0; k--) saida += DELIM[abertas[k]];
  return saida;
}

function indentar(linhas: string[], recuo: string): string[] {
  return linhas.map((l) => (l === "" ? "" : recuo + l));
}

function serializarItem(item: ItemLista, marcador: string): string[] {
  const linhas: string[] = [];
  item.content.forEach((b, i) => {
    const sub = serializarBloco(b);
    if (i > 0) {
      // sublista cola no parágrafo; outro bloco precisa de linha em branco
      if (b.type !== "bulletList" && b.type !== "orderedList") linhas.push("");
    }
    linhas.push(...sub);
  });
  const recuo = " ".repeat(marcador.length + 1);
  const [primeira = "", ...resto] = linhas;
  return [primeira === "" ? marcador : `${marcador} ${primeira}`, ...indentar(resto, recuo)];
}

function serializarLinhaDaTabela(l: LinhaTabela): string {
  const celulas = l.content.map((c) => serializarInline(c.content[0]?.content, "celula"));
  if (l.attrs?.total) celulas[0] = celulas[0] ? `${MARCA_TOTAL} ${celulas[0]}` : MARCA_TOTAL;
  return `| ${celulas.join(" | ")} |`;
}

function serializarTabela(t: Tabela): string[] {
  const [cabecalho, ...corpo] = t.content;
  return [serializarLinhaDaTabela(cabecalho), `| ${cabecalho.content.map(() => "---").join(" | ")} |`, ...corpo.map(serializarLinhaDaTabela)];
}

function serializarBloco(b: Bloco): string[] {
  switch (b.type) {
    case "paragraph":
      return [serializarInline(b.content)];
    case "heading":
      return [`${"#".repeat(b.attrs.level)} ${serializarInline(b.content, "titulo")}`];
    case "horizontalRule":
      return ["---"];
    case "blocoDados":
      return [marcadorDe(b.attrs.tipo)];
    case "semBlocos":
      return [marcadorDe("nenhum")];
    case "table":
      return serializarTabela(b);
    case "bulletList":
      return b.content.flatMap((it) => serializarItem(it, "-"));
    case "orderedList":
      return b.content.flatMap((it, i) => serializarItem(it, `${b.attrs.start + i}.`));
  }
}

export function documentoParaMarkdown(doc: Documento): string {
  return normalizarDocumento(doc)
    .content.map((b) => serializarBloco(b).join("\n"))
    .join("\n\n");
}

// ---------------------------------------------------------------- Markdown → doc

type Contexto = Set<Marca>;

function texto(text: string, marcas: Contexto): NoTexto {
  const ms = MARCAS.filter((m) => marcas.has(m));
  return ms.length ? { type: "text", text, marks: ms.map((type) => ({ type })) } : { type: "text", text };
}

function inline(tokens: Token[] | undefined, marcas: Contexto = new Set()): NoTexto[] {
  const saida: NoTexto[] = [];
  for (const tk of tokens ?? []) {
    switch (tk.type) {
      case "text": {
        const t = tk as Tokens.Text;
        if (t.tokens?.length) saida.push(...inline(t.tokens, marcas));
        else saida.push(texto(t.text, marcas));
        break;
      }
      case "escape":
        saida.push(texto(tk.raw.slice(1), marcas));
        break;
      case "strong":
        saida.push(...inline((tk as Tokens.Strong).tokens, new Set([...marcas, "bold"])));
        break;
      case "em":
        saida.push(...inline((tk as Tokens.Em).tokens, new Set([...marcas, "italic"])));
        break;
      case "br":
        saida.push(texto(" ", marcas));
        break;
      case "checkbox":
        saida.push(texto((tk as Tokens.Checkbox).checked ? "[x] " : "[ ] ", marcas));
        break;
      default:
        // link, imagem, código, riscado, HTML…: o texto original, literal
        saida.push(texto(tk.raw, marcas));
    }
  }
  return saida;
}

/** Linhas não vazias de um trecho cru → parágrafos de texto literal. */
function paragrafosLiterais(cru: string): Bloco[] {
  return cru
    .split(/\r\n?|\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => ({ type: "paragraph", content: [{ type: "text", text: l }] }));
}

/**
 * Células da linha crua, como o GFM divide: `|` com número ímpar de barras antes não divide, e
 * `\\|` vira `|`. O `marked` corta o que passa da largura do cabeçalho, e isso seria perder texto.
 */
function dividirCelulas(linha: string): string[] {
  const celulas: string[] = [];
  let atual = "";
  let barras = 0;
  for (const c of linha.trim()) {
    if (c === "|" && barras % 2 === 0) {
      celulas.push(atual);
      atual = "";
    } else {
      atual = c === "|" ? `${atual.slice(0, -1)}|` : atual + c;
    }
    barras = c === "\\" ? barras + 1 : 0;
  }
  celulas.push(atual);
  if (celulas.length > 1 && !celulas[0].trim()) celulas.shift();
  if (celulas.length > 1 && !celulas[celulas.length - 1].trim()) celulas.pop();
  return celulas.map((c) => c.trim());
}

/** Quebra de linha em célula só existe como `<br>`: vira espaço (`\<br>`, texto literal, fica). */
const BR_NA_CELULA = /(?<!\\)<br\s*\/?>/gi;

function celulaDoMarkdown(cru: string): { type: "tableCell"; content: [{ type: "paragraph"; content: NoTexto[] }] } {
  const tokens = Lexer.lexInline(cru.replace(BR_NA_CELULA, " ").trim(), { gfm: true, breaks: false });
  return { type: "tableCell", content: [{ type: "paragraph", content: inline(tokens) }] };
}

/** Do token do `marked`, pelas linhas cruas (as células que ele cortaria continuam aqui). */
function tabelaDoToken(tk: Tokens.Table): Tabela | null {
  const [cabecalho, , ...corpo] = tk.raw.split("\n").filter((l) => l.trim());
  const linhas = [cabecalho, ...corpo].map((linha, i): LinhaTabela => {
    const cruas = dividirCelulas(linha);
    const total = i > 0 && MARCA_TOTAL_NA_CELULA.test(cruas[0]);
    if (total) cruas[0] = cruas[0].replace(MARCA_TOTAL_NA_CELULA, "");
    const content = cruas.map(celulaDoMarkdown);
    return total ? { type: "tableRow", attrs: { total: true }, content } : { type: "tableRow", content };
  });
  return normalizarTabela({ type: "table", content: linhas });
}

type LeituraMarkdown = {
  /** Nível de cima do documento, o único lugar onde um marcador vira bloco móvel. */
  topo?: boolean;
  /** Onde a tabela vira nó: o nível de cima e a citação solta nele. Em lista, vira parágrafos. */
  tabela?: boolean;
  /** Motivos das tabelas que passaram dos limites e entraram como parágrafos. */
  foraDoLimite?: string[];
};

function blocos(tokens: Token[] | undefined, leitura: LeituraMarkdown = {}): Bloco[] {
  const { topo = false, tabela = false, foraDoLimite } = leitura;
  const saida: Bloco[] = [];
  for (const tk of tokens ?? []) {
    switch (tk.type) {
      case "space":
        break;
      case "paragraph":
        saida.push({ type: "paragraph", content: inline((tk as Tokens.Paragraph).tokens) });
        break;
      case "text": {
        const t = tk as Tokens.Text;
        saida.push({ type: "paragraph", content: t.tokens?.length ? inline(t.tokens) : [{ type: "text", text: t.text }] });
        break;
      }
      case "heading": {
        const h = tk as Tokens.Heading;
        saida.push({ type: "heading", attrs: { level: Math.min(3, h.depth) as 1 | 2 | 3 }, content: inline(h.tokens) });
        break;
      }
      case "hr":
        saida.push({ type: "horizontalRule" });
        break;
      case "list": {
        const l = tk as Tokens.List;
        const content: ItemLista[] = l.items.map((it) => ({ type: "listItem", content: blocos(it.tokens, { foraDoLimite }) }));
        const inicio = typeof l.start === "number" ? l.start : 1;
        saida.push(l.ordered ? { type: "orderedList", attrs: { start: inicio }, content } : { type: "bulletList", content });
        break;
      }
      case "blockquote":
        saida.push(...blocos((tk as Tokens.Blockquote).tokens, { tabela, foraDoLimite }));
        break;
      case "table": {
        const t = tabelaDoToken(tk as Tokens.Table);
        if (!t) break;
        const motivo = motivoForaDoLimite(medirTabela(t));
        if (motivo) foraDoLimite?.push(motivo);
        if (tabela && !motivo) saida.push(t);
        else saida.push(...tabelaComoParagrafos(t));
        break;
      }
      case "code":
        saida.push(...paragrafosLiterais((tk as Tokens.Code).text));
        break;
      case "html": {
        const m = topo ? MARCADOR.exec(tk.raw.trim()) : null;
        if (!m) saida.push(...paragrafosLiterais(tk.raw));
        else if (m[1] === "nenhum") saida.push({ type: "semBlocos" });
        else saida.push({ type: "blocoDados", attrs: { tipo: m[1] as TipoBlocoDados } });
        break;
      }
      default:
        // HTML de bloco, definição de link, qualquer outro: texto literal
        saida.push(...paragrafosLiterais(tk.raw));
    }
  }
  return saida;
}

export function markdownParaDocumento(md: string): Documento {
  const tokens = new Lexer({ gfm: true, breaks: false }).lex(md);
  return normalizarDocumento({ type: "doc", content: blocos(tokens, { topo: true, tabela: true }) });
}

/**
 * Por que alguma tabela deste Markdown não caberia (null = nenhuma). Quem escreve pelo MCP recebe o
 * erro em vez de ver a tabela virar parágrafos; a canonização em si nunca falha (o OCR passa por ela).
 */
export function motivoTabelaForaDoLimite(md: string): string | null {
  const foraDoLimite: string[] = [];
  blocos(new Lexer({ gfm: true, breaks: false }).lex(md), { topo: true, tabela: true, foraDoLimite });
  return foraDoLimite[0] ?? null;
}

/** Markdown qualquer (ex.: vindo do MCP) → Markdown canônico do subconjunto. */
export function normalizarMarkdown(md: string): string {
  return documentoParaMarkdown(markdownParaDocumento(md));
}

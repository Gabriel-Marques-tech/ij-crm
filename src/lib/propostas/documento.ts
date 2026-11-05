/**
 * Documento rich text da proposta (GAB-86, spec fase 2 §4.5) — o SUBCONJUNTO
 * de formatação que o editor permite e que o Markdown representa sem perda:
 *
 *   parágrafo · título (níveis 1–3) · negrito · itálico ·
 *   lista com marcadores · lista numerada (aninháveis) · linha horizontal ·
 *   blocos móveis "Cronograma" e "Investimento" (GAB-100, ver abaixo)
 *
 * Nada de link, imagem, HTML, tabela, código ou quebra de linha simples: o
 * editor (Tiptap) só carrega essas extensões e o Markdown que chega pelo MCP
 * vira esse subconjunto (o resto entra como TEXTO literal, ver `./markdown.ts`).
 *
 * A forma é a do JSON do ProseMirror/Tiptap (`editor.getJSON()`), para o editor
 * receber e devolver sem adaptação. A fonte da verdade gravada é o Markdown
 * canônico; este módulo define o documento NORMALIZADO, que é o ponto fixo da
 * conversão: `md → doc → md` e `doc → md → doc` dão o mesmo resultado.
 *
 * Puro e sem dependências de servidor: roda no editor (cliente) e no serviço.
 *
 * Blocos móveis (GAB-100, spec proposta-folha §5): `blocoDados` é só o LUGAR onde
 * a parte estruturada aparece na folha e no PDF; os dados continuam no `estruturado`.
 * Um de cada, só no nível de cima do documento. Há duas formas do mesmo documento:
 *
 * - NORMALIZADA (a gravada, ponto fixo do Markdown): os dois blocos no fim, nessa
 *   ordem, são a posição padrão e não se escrevem. Assim proposta antiga, que não
 *   tem bloco, continua com o mesmo Markdown e mostra os dois no fim; abrir ou salvar
 *   sem mover nada não vira mudança de versão. Sem nenhum bloco por decisão de
 *   alguém, sobra o marcador `semBlocos`, que é o que distingue "tirei os dois" de
 *   "proposta antiga".
 * - DE EXIBIÇÃO (`documentoComBlocos`): blocos explícitos e sem marcador. É o que a
 *   folha, o PDF, o editor e o texto plano da âncora usam.
 */
import { z } from "zod";

export type Marca = "bold" | "italic";
/** Ordem canônica das marcas (negrito por fora, itálico por dentro). */
export const MARCAS: readonly Marca[] = ["bold", "italic"];

export type NoTexto = { type: "text"; text: string; marks?: { type: Marca }[] };
export type Paragrafo = { type: "paragraph"; content?: NoTexto[] };
export type Titulo = { type: "heading"; attrs: { level: 1 | 2 | 3 }; content?: NoTexto[] };
export type LinhaHorizontal = { type: "horizontalRule" };
export type ItemLista = { type: "listItem"; content: Bloco[] };
export type ListaMarcadores = { type: "bulletList"; content: ItemLista[] };
export type ListaNumerada = { type: "orderedList"; attrs: { start: number }; content: ItemLista[] };
export const TIPOS_BLOCO_DADOS = ["cronograma", "investimento"] as const;
export type TipoBlocoDados = (typeof TIPOS_BLOCO_DADOS)[number];
export type BlocoDados = { type: "blocoDados"; attrs: { tipo: TipoBlocoDados } };
/** Os dois blocos foram tirados da folha de propósito (só existe na forma normalizada). */
export type SemBlocos = { type: "semBlocos" };
export type Bloco = Paragrafo | Titulo | LinhaHorizontal | ListaMarcadores | ListaNumerada | BlocoDados | SemBlocos;
export type Documento = { type: "doc"; content: Bloco[] };

export const DOCUMENTO_VAZIO: Documento = { type: "doc", content: [] };

/** Limites contra abuso (o conteúdo vem do editor e do MCP). */
export const MARKDOWN_MAX = 100_000;
const PROFUNDIDADE_MAX = 6;
export const NUMERO_INICIAL_MAX = 999_999_999;

// ---------------------------------------------------------------- entrada (leniente)

/**
 * O que o editor manda (`getJSON()`): aceita atributos extras do Tiptap e
 * ignora; qualquer tipo fora do subconjunto é recusado (o editor não gera).
 */
const marcaEntrada = z.object({ type: z.enum(["bold", "italic"]) }).passthrough();
const textoEntrada = z.object({ type: z.literal("text"), text: z.string(), marks: z.array(marcaEntrada).optional() }).passthrough();

type BlocoEntrada = { type: string; attrs?: Record<string, unknown>; content?: unknown[] };

const blocoEntrada: z.ZodType<BlocoEntrada> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("paragraph"), content: z.array(textoEntrada).optional() }).passthrough(),
    z
      .object({ type: z.literal("heading"), attrs: z.object({ level: z.number().int().min(1).max(6) }).passthrough(), content: z.array(textoEntrada).optional() })
      .passthrough(),
    z.object({ type: z.literal("horizontalRule") }).passthrough(),
    z.object({ type: z.literal("blocoDados"), attrs: z.object({ tipo: z.enum(TIPOS_BLOCO_DADOS) }).passthrough() }).passthrough(),
    z.object({ type: z.literal("semBlocos") }).passthrough(),
    z.object({ type: z.literal("bulletList"), content: z.array(itemEntrada).optional() }).passthrough(),
    z
      .object({
        type: z.literal("orderedList"),
        attrs: z.object({ start: z.number().int().min(0).max(NUMERO_INICIAL_MAX).nullish() }).passthrough().optional(),
        content: z.array(itemEntrada).optional(),
      })
      .passthrough(),
  ]),
) as z.ZodType<BlocoEntrada>;

const itemEntrada: z.ZodType<BlocoEntrada> = z.lazy(() =>
  z.object({ type: z.literal("listItem"), content: z.array(blocoEntrada).optional() }).passthrough(),
) as z.ZodType<BlocoEntrada>;

export const documentoEntradaSchema = z.object({ type: z.literal("doc"), content: z.array(blocoEntrada).optional() }).passthrough();

function profundidade(b: BlocoEntrada, nivel = 0): number {
  if (!Array.isArray(b.content)) return nivel;
  let max = nivel;
  for (const c of b.content) {
    if (c && typeof c === "object" && "content" in c) max = Math.max(max, profundidade(c as BlocoEntrada, nivel + 1));
  }
  return max;
}

/** Valida o JSON do editor e devolve o documento normalizado (ou null se não for do subconjunto). */
export function lerDocumento(bruto: unknown): Documento | null {
  const p = documentoEntradaSchema.safeParse(bruto);
  if (!p.success) return null;
  const doc = p.data as unknown as BlocoEntrada;
  // listas aninhadas: lista → item → lista … (2 níveis por lista)
  if (profundidade(doc) > PROFUNDIDADE_MAX * 2 + 2) return null;
  return normalizarDocumento(doc as unknown as Documento);
}

// ---------------------------------------------------------------- normalização

type Letra = { c: string; bold: boolean; italic: boolean };

const ESPACO = /\s/u;
const PONTUACAO = /[\p{P}\p{S}]/u;

/**
 * Tipo do caractere para as regras de "flanco" do CommonMark. Fora do plano
 * básico (emoji…) é "ambíguo": o `marked` às vezes o trata como letra, às vezes
 * como pontuação — então a marca nunca fica colada nele do lado errado.
 */
type Classe = "borda" | "espaco" | "pontuacao" | "ambiguo" | "letra";
function classe(c: string | undefined): Classe {
  if (c === undefined) return "borda";
  if ((c.codePointAt(0) ?? 0) > 0xffff) return "ambiguo";
  if (ESPACO.test(c)) return "espaco";
  if (PONTUACAO.test(c)) return "pontuacao";
  return "letra";
}

/**
 * A ponta `dentro` do trecho marcado, vizinha de `fora`, impede o delimitador
 * de abrir/fechar? `aninhado`: a outra marca segue dos dois lados (trecho dentro
 * de outro) — aí nem no meio da palavra o `marked` casa ("*a **b**c*").
 */
function pontaRuim(dentro: Classe, fora: Classe, aninhado: boolean): boolean {
  if (dentro === "espaco") return true;
  const palavra = (c: Classe) => c === "letra" || c === "ambiguo";
  if (aninhado && palavra(dentro) && palavra(fora)) return true;
  // pontuação na ponta só é segura com espaço/borda do lado de fora (colada em letra o
  // delimitador não abre/fecha; colada em pontuação ele vira "abre-e-fecha" e casa errado)
  return (dentro === "pontuacao" || dentro === "ambiguo") && fora !== "espaco" && fora !== "borda";
}

/**
 * Ajusta as marcas nas pontas de cada trecho marcado para o Markdown conseguir
 * representá-las (regras de flanco do CommonMark):
 * - espaço na ponta sai da marca ("** a**" não é negrito);
 * - pontuação na ponta, sem espaço do lado de fora, sai da marca
 *   ("**a.**b" não fecha o negrito).
 * É invisível na prática (o espaço/a pontuação deixam de ser negrito/itálico)
 * e é o que garante `doc → md → doc` idêntico.
 */
/** Asterisco/sublinhado/barra (escapados no Markdown) colados num delimitador confundem o `marked`. */
const DELICADOS = new Set(["*", "_", "\\"]);

function ajustarPontas(letras: Letra[], marca: Marca): boolean {
  const outra: Marca = marca === "bold" ? "italic" : "bold";
  const aninhado = (a: number, b: number) => Boolean(letras[a]?.[outra] && letras[b]?.[outra]);
  const ruim = (dentro: number, fora: number) =>
    DELICADOS.has(letras[dentro].c) || DELICADOS.has(letras[fora]?.c ?? "") || pontaRuim(classe(letras[dentro].c), classe(letras[fora]?.c), aninhado(dentro, fora));
  let mudou = false;
  let i = 0;
  while (i < letras.length) {
    if (!letras[i][marca]) {
      i++;
      continue;
    }
    let fim = i;
    while (fim + 1 < letras.length && letras[fim + 1][marca]) fim++;
    let ini = i;
    while (ini <= fim && ruim(ini, ini - 1)) {
      letras[ini][marca] = false;
      mudou = true;
      ini++;
    }
    let f = fim;
    while (f >= ini && ruim(f, f + 1)) {
      letras[f][marca] = false;
      mudou = true;
      f--;
    }
    i = fim + 1;
  }
  return mudou;
}

/** Trechos maximais [início, fim] com a marca. */
function trechos(letras: Letra[], marca: Marca): [number, number][] {
  const r: [number, number][] = [];
  for (let i = 0; i < letras.length; i++) {
    if (!letras[i][marca]) continue;
    let f = i;
    while (f + 1 < letras.length && letras[f + 1][marca]) f++;
    r.push([i, f]);
    i = f;
  }
  return r;
}

/**
 * Negrito e itálico que se CRUZAM (um começa dentro do outro e termina fora)
 * não têm Markdown confiável ("**a*b***c*"). Resolve tirando o itálico da
 * parte cruzada: os trechos passam a ser aninhados ou vizinhos.
 */
function desfazerCruzamentos(letras: Letra[]): boolean {
  let mudou = false;
  const negritos = trechos(letras, "bold");
  let j = 0;
  // os dois são ordenados e disjuntos entre si: varredura linear (texto pode ser grande)
  for (const [ii, if_] of trechos(letras, "italic")) {
    while (j < negritos.length && negritos[j][1] < ii) j++;
    for (let k = j; k < negritos.length && negritos[k][0] <= if_; k++) {
      const [bi, bf] = negritos[k];
      const contido = (ii >= bi && if_ <= bf) || (bi >= ii && bf <= if_);
      if (contido) continue;
      for (let x = Math.max(bi, ii); x <= Math.min(bf, if_); x++) letras[x].italic = false;
      mudou = true;
    }
  }
  return mudou;
}

function paraLetras(content: NoTexto[] | undefined): Letra[] {
  const letras: Letra[] = [];
  for (const n of content ?? []) {
    if (n.type !== "text" || typeof n.text !== "string") continue;
    const marcas = new Set((n.marks ?? []).map((m) => m.type));
    // Sem quebra de linha nem caracteres de controle dentro do texto (o editor não tem "hard break").
    const texto = n.text.replace(/\r\n?|\n/g, " ").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uE001\uE002]/g, ""); // U+E001 e U+E002: reservados à âncora dos blocos
    for (const c of texto) letras.push({ c: c === "\t" ? " " : c, bold: marcas.has("bold"), italic: marcas.has("italic") });
  }
  return letras;
}

function deLetras(letras: Letra[]): NoTexto[] {
  const nos: NoTexto[] = [];
  for (const l of letras) {
    const marcas = MARCAS.filter((m) => l[m]);
    const ultimo = nos[nos.length - 1];
    const mesmas = ultimo && (ultimo.marks ?? []).map((m) => m.type).join() === marcas.join();
    if (ultimo && mesmas) ultimo.text += l.c;
    else nos.push(marcas.length ? { type: "text", text: l.c, marks: marcas.map((type) => ({ type })) } : { type: "text", text: l.c });
  }
  return nos;
}

/** Texto inline normalizado: sem espaço nas pontas (o Markdown descarta), marcas representáveis, nós vizinhos iguais unidos. */
export function normalizarInline(content: NoTexto[] | undefined): NoTexto[] {
  let letras = paraLetras(content);
  // espaço nas pontas do bloco some (Markdown não preserva)
  while (letras.length && ESPACO.test(letras[0].c)) letras.shift();
  while (letras.length && ESPACO.test(letras[letras.length - 1].c)) letras.pop();
  // espaços repetidos viram um (como no HTML exibido; o Markdown também não preserva de forma confiável)
  letras = letras.filter((l, i) => !(l.c === " " && letras[i - 1]?.c === " "));
  // itera até estabilizar: tirar a marca de uma ponta pode expor outra
  for (let n = 0; n < 16; n++) {
    let mudou = false;
    for (const m of MARCAS) mudou = ajustarPontas(letras, m) || mudou;
    mudou = desfazerCruzamentos(letras) || mudou;
    if (!mudou) break;
  }
  return deLetras(letras);
}

function normalizarItens(itens: unknown[] | undefined): ItemLista[] {
  const saida: ItemLista[] = [];
  for (const it of itens ?? []) {
    // Bloco de dados só existe no nível de cima: dentro de item de lista não é do subconjunto.
    const blocos = normalizarBlocos(((it as BlocoEntrada).content as Bloco[] | undefined)?.filter((b) => b.type !== "blocoDados" && b.type !== "semBlocos"));
    if (blocos.length === 0) continue;
    // Tiptap: item começa SEMPRE por parágrafo (mesmo vazio, quando só tem sublista).
    if (blocos[0].type !== "paragraph") blocos.unshift({ type: "paragraph" });
    saida.push({ type: "listItem", content: blocos });
  }
  return saida;
}

/**
 * Normaliza a lista de blocos: tira parágrafos/títulos vazios, une listas
 * vizinhas do mesmo tipo (o Markdown não distingue duas listas coladas),
 * limita títulos a 1–3 e o número inicial da lista numerada.
 */
function normalizarBlocos(blocos: Bloco[] | undefined): Bloco[] {
  const saida: Bloco[] = [];
  for (const b of blocos ?? []) {
    let novo: Bloco | null = null;
    switch (b.type) {
      case "paragraph": {
        const content = normalizarInline(b.content);
        novo = content.length ? { type: "paragraph", content } : null;
        break;
      }
      case "heading": {
        const content = normalizarInline(b.content);
        const nivel = Math.min(3, Math.max(1, Number((b as Titulo).attrs?.level) || 1)) as 1 | 2 | 3;
        novo = content.length ? { type: "heading", attrs: { level: nivel }, content } : null;
        break;
      }
      case "horizontalRule":
        novo = { type: "horizontalRule" };
        break;
      case "blocoDados":
        novo = { type: "blocoDados", attrs: { tipo: (b as BlocoDados).attrs.tipo } };
        break;
      case "semBlocos":
        novo = { type: "semBlocos" };
        break;
      case "bulletList": {
        const content = normalizarItens(b.content);
        novo = content.length ? { type: "bulletList", content } : null;
        break;
      }
      case "orderedList": {
        const content = normalizarItens(b.content);
        const bruto = Number((b as ListaNumerada).attrs?.start ?? 1);
        const start = Number.isInteger(bruto) ? Math.min(NUMERO_INICIAL_MAX, Math.max(0, bruto)) : 1;
        novo = content.length ? { type: "orderedList", attrs: { start }, content } : null;
        break;
      }
    }
    if (!novo) continue;
    const anterior = saida[saida.length - 1];
    if (anterior && (novo.type === "bulletList" || novo.type === "orderedList") && anterior.type === novo.type) {
      anterior.content.push(...novo.content);
      continue;
    }
    saida.push(novo);
  }
  return saida;
}

export function normalizarDocumento(doc: Documento): Documento {
  // Um de cada (vale o primeiro). Tirar duplicado e marcador ANTES: duas listas que ficam vizinhas se unem.
  const vistos = new Set<TipoBlocoDados>();
  const entrada = (doc.content ?? []).filter((b) => {
    if (b.type !== "blocoDados") return b.type !== "semBlocos";
    if (vistos.has(b.attrs.tipo)) return false;
    vistos.add(b.attrs.tipo);
    return true;
  });
  const content = normalizarBlocos(entrada);
  if (vistos.size === 0) {
    if ((doc.content ?? []).some((b) => b.type === "semBlocos")) content.push({ type: "semBlocos" });
  } else if (blocosNaPosicaoPadrao(content)) {
    content.length -= TIPOS_BLOCO_DADOS.length;
  }
  return { type: "doc", content };
}

/** Os dois blocos, um só de cada, são os últimos do documento e estão na ordem padrão. */
function blocosNaPosicaoPadrao(content: readonly Bloco[]): boolean {
  const fim = content.slice(-TIPOS_BLOCO_DADOS.length);
  return fim.length === TIPOS_BLOCO_DADOS.length && fim.every((b, i) => b.type === "blocoDados" && b.attrs.tipo === TIPOS_BLOCO_DADOS[i]);
}

/** Objetos fixos: a identidade serve de chave nos mapas do texto plano (`ancora.ts`). */
const BLOCOS_PADRAO: readonly BlocoDados[] = TIPOS_BLOCO_DADOS.map((tipo) => ({ type: "blocoDados", attrs: { tipo } }));

/**
 * Documento como aparece na folha e no PDF: os blocos em lugares explícitos e sem
 * marcador. Sem bloco nenhum e sem marcador (proposta antiga, posição padrão), os
 * dois vão para o fim. Os blocos que já existem mantêm a identidade dos objetos.
 */
export function documentoComBlocos(doc: Documento): Documento {
  const content = doc.content.filter((b) => b.type !== "semBlocos");
  const semMarcador = content.length === doc.content.length;
  if (!semMarcador || content.some((b) => b.type === "blocoDados")) return { type: "doc", content };
  return { type: "doc", content: [...content, ...BLOCOS_PADRAO] };
}

/** Documento para o editor: forma de exibição, sempre com onde pôr o cursor no começo. */
export function documentoParaEditor(doc: Documento): Documento {
  const d = documentoComBlocos(doc);
  return d.content[0]?.type === "blocoDados" ? { type: "doc", content: [{ type: "paragraph" }, ...d.content] } : d;
}

/** O editor só tem os blocos que estão na folha: nenhum bloco nele quer dizer que foram tirados. */
export function documentoDoEditor(doc: Documento): Documento {
  return doc.content.some((b) => b.type === "blocoDados") ? doc : { type: "doc", content: [...doc.content, { type: "semBlocos" }] };
}

/**
 * Texto novo inteiro (arquivo como base) sem mexer em quais blocos estão na folha: quem foi
 * tirado continua fora, e os que estão ficam no fim, na ordem atual. A posição no meio do
 * texto não sobrevive: o texto é outro.
 */
export function herdarBlocos(novo: Documento, atual: Documento): Documento {
  const presentes = documentoComBlocos(normalizarDocumento(atual)).content.filter((b) => b.type === "blocoDados");
  const texto = novo.content.filter((b) => b.type !== "blocoDados" && b.type !== "semBlocos");
  return normalizarDocumento({ type: "doc", content: presentes.length ? [...texto, ...presentes] : [...texto, { type: "semBlocos" }] });
}

/** Texto corrido do documento (prévia, busca). */
export function textoDoDocumento(doc: Documento): string {
  const partes: string[] = [];
  const visitar = (b: Bloco | ItemLista) => {
    if (b.type === "paragraph" || b.type === "heading") partes.push((b.content ?? []).map((t) => t.text).join(""));
    else if (b.type === "bulletList" || b.type === "orderedList" || b.type === "listItem") b.content.forEach(visitar);
  };
  doc.content.forEach(visitar);
  return partes.filter(Boolean).join("\n");
}

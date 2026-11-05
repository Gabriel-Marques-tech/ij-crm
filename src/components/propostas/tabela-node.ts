/**
 * Tabela livre no editor (GAB-102): extensões do Tiptap presas ao subconjunto de
 * `lib/propostas/documento.ts`. Só no nível de cima (grupo `blocoDoc`, como os blocos móveis),
 * com um parágrafo por célula, sem mesclar e sem largura guardada: o Markdown não representa
 * nada disso. Colar tabela de fora passa pelo mesmo esquema, então colspan vira célula simples e
 * o `tableEditing` completa o que faltar.
 *
 * Três garantias que o esquema sozinho não dá, num plugin só (`garantias`):
 * - a primeira linha é sempre o cabeçalho, e só ela (remover a primeira promove a segunda);
 * - a transação que passaria dos limites é recusada, com aviso (`aoRecusar`), senão o servidor
 *   recusaria o documento inteiro e o autosave travaria;
 * - colar vários parágrafos na célula junta o texto, em vez de perder o que não coube.
 *
 * Atributos do ProseMirror têm protótipo nulo: quem manda para a server action é `jsonDoEditor`.
 */
import { Extension, InputRule, type Editor } from "@tiptap/core";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import { Table, TableCell, TableHeader, TableRow, createTable } from "@tiptap/extension-table";
import { Fragment, Slice, type Node as NoPM } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { CellSelection, isInTable, selectionCell, TableMap } from "@tiptap/pm/tables";
import type { EditorView, NodeView } from "@tiptap/pm/view";
import type { Tabela } from "@/lib/propostas/documento";
import { largurasDaTabela, motivoForaDoLimite, TABELA_COLUNAS_MAX, TABELA_LINHAS_MAX, type MedidasTabela } from "@/lib/propostas/tabela";

/** Tabela nova: cabeçalho e duas linhas, três colunas. */
const LINHAS_NOVA = 3;
const COLUNAS_NOVA = 3;

/** Só o texto: o que vale na largura e nos limites. A forma é a do documento, sem precisar normalizar. */
function tabelaDoNo(no: NoPM): Tabela {
  return no.toJSON() as Tabela;
}

function aplicarColunas(no: NoPM, tabela: HTMLTableElement, colgroup: HTMLTableColElement) {
  const larguras = largurasDaTabela(tabelaDoNo(no));
  tabela.style.setProperty("--colunas", String(larguras.length));
  while (colgroup.children.length > larguras.length) colgroup.lastChild?.remove();
  while (colgroup.children.length < larguras.length) colgroup.append(document.createElement("col"));
  larguras.forEach((l, i) => ((colgroup.children[i] as HTMLElement).style.width = `${l * 100}%`));
}

/** A mesma tabela da leitura (`DocumentoView`): rolagem própria e colunas pela mesma conta do PDF. */
class TabelaView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private tabela: HTMLTableElement;
  private colgroup: HTMLTableColElement;

  constructor(
    private no: NoPM,
    _cellMinWidth: number,
    _view: EditorView,
    atributos: Record<string, string> = {},
  ) {
    this.dom = document.createElement("div");
    this.dom.className = "tabela-rolagem";
    this.tabela = this.dom.appendChild(document.createElement("table"));
    for (const [k, v] of Object.entries(atributos)) this.tabela.setAttribute(k, v);
    this.colgroup = this.tabela.appendChild(document.createElement("colgroup"));
    this.contentDOM = this.tabela.appendChild(document.createElement("tbody"));
    aplicarColunas(no, this.tabela, this.colgroup);
  }

  update(no: NoPM) {
    if (no.type !== this.no.type) return false;
    this.no = no;
    aplicarColunas(no, this.tabela, this.colgroup);
    return true;
  }

  ignoreMutation(m: Parameters<NonNullable<NodeView["ignoreMutation"]>>[0]) {
    return m.type !== "selection" && !this.contentDOM.contains(m.target);
  }
}

/** Nada de `colspan`/`rowspan`/alinhamento vindos de colagem: a célula só tem texto. */
const atributosDaCelula = () => ({
  colspan: { default: 1, parseHTML: () => 1, renderHTML: () => ({}) },
  rowspan: { default: 1, parseHTML: () => 1, renderHTML: () => ({}) },
  colwidth: { default: null, parseHTML: () => null, renderHTML: () => ({}) },
});

const Celula = TableCell.extend({ content: "paragraph", addAttributes: atributosDaCelula });
const Cabecalho = TableHeader.extend({
  content: "paragraph",
  addAttributes: atributosDaCelula,
  renderHTML({ HTMLAttributes }) {
    return ["th", { ...HTMLAttributes, scope: "col" }, 0];
  },
});

const Linha = TableRow.extend({
  addAttributes() {
    return {
      // Só a marca de quem escreve: nada soma nem confere.
      total: {
        default: false,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-total") === "true",
        renderHTML: (a: { total?: boolean }) => (a.total ? { "data-total": "true", class: "total" } : {}),
      },
    };
  },
});

/** Medidas pelo nó, sem gerar JSON a cada tecla (a célula tem um parágrafo: 2 posições além do texto). */
function medidasDoNo(t: NoPM): MedidasTabela {
  let maiorCelula = 0;
  t.forEach((l) => l.forEach((c) => (maiorCelula = Math.max(maiorCelula, c.content.size - 2))));
  return { linhas: t.childCount, colunas: t.firstChild?.childCount ?? 0, maiorCelula };
}

export function motivoDoDocumentoForaDoLimite(doc: NoPM): string | null {
  let motivo: string | null = null;
  doc.forEach((b) => {
    if (b.type.name === "table") motivo ??= motivoForaDoLimite(medidasDoNo(b));
  });
  return motivo;
}

/** A primeira linha é o cabeçalho, sem marca de total; as outras têm células comuns. null = nada a acertar. */
function acertarCabecalhos(estado: EditorState): Transaction | null {
  const { tableHeader, tableCell } = estado.schema.nodes;
  let tr: Transaction | null = null;
  estado.doc.forEach((tabela, posTabela) => {
    if (tabela.type.name !== "table") return;
    let posLinha = posTabela + 1;
    tabela.forEach((linha, _o, i) => {
      if (i === 0 && linha.attrs.total) (tr ??= estado.tr).setNodeMarkup(posLinha, null, { ...linha.attrs, total: false });
      let posCelula = posLinha + 1;
      linha.forEach((celula) => {
        const tipo = i === 0 ? tableHeader : tableCell;
        if (celula.type !== tipo) (tr ??= estado.tr).setNodeMarkup(posCelula, tipo, celula.attrs);
        posCelula += celula.nodeSize;
      });
      posLinha += linha.nodeSize;
    });
  });
  return tr;
}

/** Colar na célula: o que não é tabela vira texto corrido, sem perder o que não caberia num parágrafo só. */
function colarNaCelula(view: EditorView, trecho: Slice): boolean {
  const { state } = view;
  if (!isInTable(state) || state.selection instanceof CellSelection) return false;
  let temTabela = false;
  let blocos = 0;
  trecho.content.descendants((n) => {
    if (n.type.name === "table") temTabela = true;
    if (n.isTextblock) blocos++;
    return !temTabela;
  });
  if (temTabela || blocos < 2) return false;
  const nos: NoPM[] = [];
  trecho.content.descendants((n) => {
    if (!n.isTextblock || n.content.size === 0) return true;
    if (nos.length) nos.push(state.schema.text(" "));
    n.forEach((filho) => nos.push(filho));
    return false;
  });
  view.dispatch(state.tr.replaceSelection(new Slice(Fragment.from(nos), 0, 0)).scrollIntoView());
  return true;
}

const chave = new PluginKey("tabelaGarantias");

/** Quem mostra o aviso quando uma edição passa do limite (a tela). */
export function definirAvisoDaTabela(editor: Editor, aoRecusar: ((motivo: string) => void) | null) {
  (editor.storage as unknown as { tabelaGarantias: { aoRecusar: ((m: string) => void) | null } }).tabelaGarantias.aoRecusar = aoRecusar;
}

const garantias = Extension.create<object, { aoRecusar: ((motivo: string) => void) | null }>({
  name: "tabelaGarantias",
  addStorage: () => ({ aoRecusar: null }),
  addProseMirrorPlugins() {
    const storage = this.storage;
    return [
      new Plugin({
        key: chave,
        props: { handlePaste: (view, _evento, trecho) => colarNaCelula(view, trecho) },
        filterTransaction(tr) {
          if (!tr.docChanged) return true;
          const motivo = motivoDoDocumentoForaDoLimite(tr.doc);
          if (motivo) storage.aoRecusar?.(motivo);
          return !motivo;
        },
        appendTransaction: (trs, _antes, estado) => (trs.some((t) => t.docChanged) ? acertarCabecalhos(estado) : null),
      }),
    ];
  },
});

/** A regra `---` e o comando saem do esquema pela tangente: em vez de recusar, partiriam a tabela em duas. */
export const LinhaHorizontalForaDaTabela = HorizontalRule.extend({
  addInputRules() {
    return (this.parent?.() ?? []).map((r) => new InputRule({ find: r.find, handler: (a) => (isInTable(a.state) ? null : r.handler(a)) }));
  },
  addCommands() {
    const comandos = this.parent?.() ?? {};
    return {
      ...comandos,
      setHorizontalRule: (...args: Parameters<NonNullable<typeof comandos.setHorizontalRule>>) => (ctx: Parameters<ReturnType<NonNullable<typeof comandos.setHorizontalRule>>>[0]) => (isInTable(ctx.state) ? false : comandos.setHorizontalRule!(...args)(ctx)),
    };
  },
});

/** Onde o cursor está na tabela (null = fora dela). */
export type PosicaoNaTabela = { linha: number; coluna: number; linhas: number; colunas: number; total: boolean };

export function posicaoNaTabela(state: EditorState): PosicaoNaTabela | null {
  if (!isInTable(state)) return null;
  const $celula = selectionCell(state);
  const tabela = $celula.node(-1);
  const mapa = TableMap.get(tabela);
  const rect = mapa.findCell($celula.pos - $celula.start(-1));
  return { linha: rect.top, coluna: rect.left, linhas: mapa.height, colunas: mapa.width, total: Boolean($celula.parent.attrs.total) };
}

/** Na linha do cursor, depois do bloco de cima em que ele está (parágrafo vazio dá lugar à tabela), com o cursor na 1ª célula. */
export function inserirTabela(editor: Pick<Editor, "state" | "view">) {
  const { state, view } = editor;
  const { $from } = state.selection;
  const de = $from.depth > 0 ? $from.before(1) : state.selection.from;
  const ate = $from.depth > 0 ? $from.after(1) : state.selection.from;
  const atual = $from.depth > 0 ? $from.node(1) : null;
  const tabela = createTable(state.schema, LINHAS_NOVA, COLUNAS_NOVA, true);
  const vazio = atual?.type.name === "paragraph" && atual.content.size === 0;
  const tr = vazio ? state.tr.replaceWith(de, ate, tabela) : state.tr.insert(ate, tabela);
  const inicio = vazio ? de : ate;
  view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(inicio + 3))).scrollIntoView());
  view.focus();
}

/** A marca da linha do cursor: só aparência, e o cabeçalho não tem. */
export function alternarTotal(editor: Pick<Editor, "state" | "view">) {
  const p = posicaoNaTabela(editor.state);
  if (!p || p.linha === 0) return false;
  const $celula = selectionCell(editor.state);
  const linha = $celula.parent;
  editor.view.dispatch(editor.state.tr.setNodeMarkup($celula.before(), null, { ...linha.attrs, total: !linha.attrs.total }));
  return true;
}

export const podeAdicionarLinha = (p: PosicaoNaTabela) => p.linhas < TABELA_LINHAS_MAX;
export const podeAdicionarColuna = (p: PosicaoNaTabela) => p.colunas < TABELA_COLUNAS_MAX;

export const ROTULO_BARRA_TABELA = "Tabela";

/** Atalhos: as mesmas ações da barra, sem depender do mouse. Alt+F10 leva o foco para a barra da tabela. */
const atalhos = Extension.create({
  name: "tabelaAtalhos",
  addKeyboardShortcuts() {
    const naTabela = (f: (p: PosicaoNaTabela) => boolean) => () => {
      const p = posicaoNaTabela(this.editor.state);
      return p ? f(p) : false;
    };
    return {
      "Alt-Shift-ArrowUp": naTabela((p) => p.linha > 0 && this.editor.commands.addRowBefore()),
      "Alt-Shift-ArrowDown": naTabela(() => this.editor.commands.addRowAfter()),
      "Alt-Shift-ArrowLeft": naTabela(() => this.editor.commands.addColumnBefore()),
      "Alt-Shift-ArrowRight": naTabela(() => this.editor.commands.addColumnAfter()),
      "Alt-Shift-Backspace": naTabela(() => this.editor.commands.deleteRow()),
      "Alt-Shift-Delete": naTabela(() => this.editor.commands.deleteColumn()),
      "Alt-Shift-t": naTabela(() => alternarTotal(this.editor)),
      "Alt-F10": naTabela(() => {
        const botao = this.editor.view.dom.ownerDocument.querySelector<HTMLButtonElement>(`[aria-label="${ROTULO_BARRA_TABELA}"] button:not(:disabled)`);
        botao?.focus();
        return Boolean(botao);
      }),
    };
  },
});

export const EXTENSOES_TABELA = [
  Table.extend({ group: "blocoDoc" }).configure({
    resizable: false,
    allowTableNodeSelection: false,
    HTMLAttributes: { class: "tabela-livre" },
    View: TabelaView as unknown as typeof Table.options.View,
  }),
  Linha,
  Cabecalho,
  Celula,
  garantias,
  atalhos,
];

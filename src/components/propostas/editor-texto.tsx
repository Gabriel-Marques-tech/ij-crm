"use client";

import { useEffect, useImperativeHandle, useState, type ReactNode, type Ref } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import Bold from "@tiptap/extension-bold";
import Document from "@tiptap/extension-document";
import Heading from "@tiptap/extension-heading";
import Italic from "@tiptap/extension-italic";
import { BulletList, ListItem, ListKeymap, OrderedList } from "@tiptap/extension-list";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { Dropcursor, Gapcursor, Placeholder, TrailingNode, UndoRedo } from "@tiptap/extensions";
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Bold as IconeNegrito,
  CalendarRange,
  CircleDollarSign,
  Heading1,
  Heading2,
  Heading3,
  Italic as IconeItalico,
  List,
  ListOrdered,
  Minus,
  Redo2,
  Rows2,
  Columns2,
  Sigma,
  Table as IconeTabela,
  Trash2,
  Undo2,
} from "lucide-react";
import { cn } from "cn";
import type { Ancora } from "@/lib/propostas/ancora";
import { documentoDoEditor, documentoParaEditor, type Documento } from "@/lib/propostas/documento";
import { alternarBloco, BlocoDadosNode, blocosNoEditor } from "./bloco-dados-node";
import { ancoraDaSelecao, chaveDestaques, DestaquesComentarios, type EntradaDestaques } from "./destaques-editor";
import { Folha, type DadosCapa } from "./folha";
import { alternarTotal, definirAvisoDaTabela, EXTENSOES_TABELA, inserirTabela, LinhaHorizontalForaDaTabela, podeAdicionarColuna, podeAdicionarLinha, posicaoNaTabela, ROTULO_BARRA_TABELA } from "./tabela-node";

/**
 * Editor rich text da proposta (Tiptap). Carrega SÓ as extensões do
 * subconjunto que o Markdown representa (`lib/propostas/documento.ts`): sem
 * link, imagem, código nem quebra de linha simples. Colar HTML de fora
 * passa pelo esquema do ProseMirror: o que não é do subconjunto vira texto.
 * Os blocos móveis (GAB-100) e a tabela (GAB-102) têm grupo próprio: o documento os
 * aceita, a lista não.
 */
export const EXTENSOES = [
  Document.extend({ content: "(block | blocoDoc)+" }),
  BlocoDadosNode,
  ...EXTENSOES_TABELA,
  Gapcursor,
  Dropcursor.configure({ color: "var(--warn)", width: 2 }),
  // Sempre dá para escrever depois de um bloco no fim do texto. Parágrafo vazio não vai para o Markdown.
  TrailingNode.configure({ node: "paragraph", notAfter: ["paragraph"] }),
  Paragraph,
  Text,
  Heading.configure({ levels: [1, 2, 3] }),
  Bold,
  Italic,
  BulletList,
  OrderedList,
  ListItem,
  ListKeymap,
  LinhaHorizontalForaDaTabela,
  UndoRedo,
  Placeholder.configure({ placeholder: "Escreva a proposta…" }),
];

/**
 * JSON do editor como objetos simples. O ProseMirror cria `attrs` com
 * `Object.create(null)`, e a serialização das server actions do React descarta
 * objetos sem protótipo: o título chegava sem `level` e o servidor recusava o
 * documento ("Conteúdo inválido"). O round-trip por JSON recria tudo como
 * objeto comum, inclusive o `tipo` dos blocos móveis e o `total` da linha da tabela.
 * `documentoDoEditor` registra que os dois blocos saíram da folha, se for o caso.
 */
export function jsonDoEditor(e: Pick<Editor, "getJSON">): Documento {
  return documentoDoEditor(JSON.parse(JSON.stringify(e.getJSON())) as Documento);
}

export type ControleEditor = {
  documento: () => Documento;
  substituir: (d: Documento) => void;
  /** GAB-91: âncora do trecho selecionado, para comentar (null = nada selecionado). */
  selecao?: () => Ancora | null;
};

function Botao({ ativo, rotulo, dica, onClick, children, desativado, largo, grande }: { ativo?: boolean; rotulo: string; dica?: string; onClick: () => void; children: React.ReactNode; desativado?: boolean; largo?: boolean; grande?: boolean }) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      title={dica ?? rotulo}
      aria-pressed={ativo}
      disabled={desativado}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center justify-center gap-1 rounded-md text-fg-mute transition-colors hover:bg-surface-hover hover:text-foreground disabled:opacity-40",
        largo ? "min-w-7 px-1.5 text-xs" : "w-7",
        // Controles da tabela: no toque, cada um com área de dedo.
        grande && "max-lg:h-10 max-lg:min-w-10",
        ativo && "bg-surface-hover text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Aparece com o cursor na tabela, na barra fixa: visível no celular (sem hover) e alcançável pelo
 * teclado (Alt+F10 entra, Esc volta para a célula). As mesmas ações têm atalho (`tabela-node.ts`).
 */
function BarraTabela({ editor, aviso }: { editor: Editor; aviso: string | null }) {
  const p = useEditorState({ editor, selector: ({ editor: e }) => posicaoNaTabela(e.state), equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b) });
  if (!p) return aviso ? <p role="status" className="basis-full px-1 pt-1 text-xs text-warn">{aviso}</p> : null;
  const c = () => editor.chain().focus();
  const cabecalho = p.linha === 0;
  return (
    <div
      role="group"
      aria-label={ROTULO_BARRA_TABELA}
      className="mt-1 flex basis-full flex-wrap items-center gap-0.5 border-t border-border pt-1"
      onKeyDown={(e) => {
        if (e.key === "Escape") editor.commands.focus();
      }}
    >
      <span className="eyebrow px-1">Tabela</span>
      <Botao grande rotulo="Linha acima" dica={cabecalho ? "O cabeçalho é sempre a primeira linha" : "Linha acima (Alt+Shift+↑)"} desativado={cabecalho || !podeAdicionarLinha(p)} onClick={() => c().addRowBefore().run()}>
        <ArrowUpToLine className="size-4" />
      </Botao>
      <Botao grande rotulo="Linha abaixo" dica="Linha abaixo (Alt+Shift+↓)" desativado={!podeAdicionarLinha(p)} onClick={() => c().addRowAfter().run()}>
        <ArrowDownToLine className="size-4" />
      </Botao>
      <Botao grande rotulo="Remover linha" dica="Remover linha (Alt+Shift+Backspace)" desativado={p.linhas <= 1} onClick={() => c().deleteRow().run()}>
        <Rows2 className="size-4" />
      </Botao>
      <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
      <Botao grande rotulo="Coluna à esquerda" dica="Coluna à esquerda (Alt+Shift+←)" desativado={!podeAdicionarColuna(p)} onClick={() => c().addColumnBefore().run()}>
        <ArrowLeftToLine className="size-4" />
      </Botao>
      <Botao grande rotulo="Coluna à direita" dica="Coluna à direita (Alt+Shift+→)" desativado={!podeAdicionarColuna(p)} onClick={() => c().addColumnAfter().run()}>
        <ArrowRightToLine className="size-4" />
      </Botao>
      <Botao grande rotulo="Remover coluna" dica="Remover coluna (Alt+Shift+Delete)" desativado={p.colunas <= 1} onClick={() => c().deleteColumn().run()}>
        <Columns2 className="size-4" />
      </Botao>
      <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
      <Botao
        grande
        largo
        rotulo="Linha de total"
        dica={cabecalho ? "O cabeçalho não pode ser total" : "Destaca a linha (Alt+Shift+T). Só marca: o valor é o que você escrever, nada é somado."}
        ativo={p.total}
        desativado={cabecalho}
        onClick={() => {
          alternarTotal(editor);
          editor.view.focus();
        }}
      >
        <Sigma className="size-4" /> <span>Total</span>
      </Botao>
      <Botao grande rotulo="Remover tabela" onClick={() => c().deleteTable().run()}>
        <Trash2 className="size-4" />
      </Botao>
      {aviso ? (
        <span role="status" className="basis-full px-1 text-xs text-warn">
          {aviso}
        </span>
      ) : null}
    </div>
  );
}

function Barra({ editor, fim, aviso }: { editor: Editor; fim?: ReactNode; aviso: string | null }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      negrito: e.isActive("bold"),
      italico: e.isActive("italic"),
      marcadores: e.isActive("bulletList"),
      numerada: e.isActive("orderedList"),
      ...blocosNoEditor(e),
      // Na célula só cabe texto: título, lista, linha e outra tabela ficam para fora dela.
      naTabela: posicaoNaTabela(e.state) !== null,
      desfazer: e.can().undo(),
      refazer: e.can().redo(),
    }),
  });
  const c = () => editor.chain().focus();
  return (
    <div role="toolbar" aria-label="Formatação" className="sticky top-14 z-[5] flex flex-wrap items-center gap-0.5 rounded-[10px] border border-border bg-surface p-1">
      <Botao rotulo="Título 1" ativo={s.h1} desativado={s.naTabela} onClick={() => c().toggleHeading({ level: 1 }).run()}>
        <Heading1 className="size-4" />
      </Botao>
      <Botao rotulo="Título 2" ativo={s.h2} desativado={s.naTabela} onClick={() => c().toggleHeading({ level: 2 }).run()}>
        <Heading2 className="size-4" />
      </Botao>
      <Botao rotulo="Título 3" ativo={s.h3} desativado={s.naTabela} onClick={() => c().toggleHeading({ level: 3 }).run()}>
        <Heading3 className="size-4" />
      </Botao>
      <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
      <Botao rotulo="Negrito (Ctrl+B)" ativo={s.negrito} onClick={() => c().toggleBold().run()}>
        <IconeNegrito className="size-4" />
      </Botao>
      <Botao rotulo="Itálico (Ctrl+I)" ativo={s.italico} onClick={() => c().toggleItalic().run()}>
        <IconeItalico className="size-4" />
      </Botao>
      <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
      <Botao rotulo="Lista com marcadores" ativo={s.marcadores} desativado={s.naTabela} onClick={() => c().toggleBulletList().run()}>
        <List className="size-4" />
      </Botao>
      <Botao rotulo="Lista numerada" ativo={s.numerada} desativado={s.naTabela} onClick={() => c().toggleOrderedList().run()}>
        <ListOrdered className="size-4" />
      </Botao>
      <Botao rotulo="Linha horizontal" desativado={s.naTabela} onClick={() => c().setHorizontalRule().run()}>
        <Minus className="size-4" />
      </Botao>
      <Botao largo rotulo="Inserir tabela" desativado={s.naTabela} onClick={() => inserirTabela(editor)}>
        <IconeTabela className="size-4" /> <span className="hidden max-lg:inline min-[1400px]:inline">Tabela</span>
      </Botao>
      <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
      <Botao largo rotulo="Bloco Cronograma: põe no cursor ou tira da folha" ativo={s.cronograma} onClick={() => alternarBloco(editor, "cronograma")}>
        <CalendarRange className="size-4" /> <span className="hidden max-lg:inline min-[1400px]:inline">Cronograma</span>
      </Botao>
      <Botao largo rotulo="Bloco Investimento: põe no cursor ou tira da folha" ativo={s.investimento} onClick={() => alternarBloco(editor, "investimento")}>
        <CircleDollarSign className="size-4" /> <span className="hidden max-lg:inline min-[1400px]:inline">Investimento</span>
      </Botao>
      <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
      <Botao rotulo="Desfazer (Ctrl+Z)" desativado={!s.desfazer} onClick={() => c().undo().run()}>
        <Undo2 className="size-4" />
      </Botao>
      <Botao rotulo="Refazer (Ctrl+Shift+Z)" desativado={!s.refazer} onClick={() => c().redo().run()}>
        <Redo2 className="size-4" />
      </Botao>
      {fim ? <span className="ml-auto flex flex-wrap items-center justify-end gap-2 pr-1">{fim}</span> : null}
      <BarraTabela editor={editor} aviso={aviso} />
    </div>
  );
}

export default function EditorTexto({
  inicial,
  aoMudar,
  controle,
  destaques,
  capa,
  barraFim,
}: {
  inicial: Documento;
  aoMudar: (d: Documento) => void;
  controle?: Ref<ControleEditor>;
  /** GAB-91: trechos comentados, destacados só por decoração (não entram no documento). */
  destaques?: EntradaDestaques;
  /** GAB-100: com isto, o texto fica na folha do modelo da IJ. */
  capa?: DadosCapa;
  /** À direita da barra de formatação ("Salvo há N s", comentar). */
  barraFim?: ReactNode;
}) {
  const [avisoTabela, setAvisoTabela] = useState<string | null>(null);
  const editor = useEditor({
    // A decoração dos comentários não é nó nem marca: o esquema continua o do subconjunto.
    extensions: [...EXTENSOES, DestaquesComentarios],
    // Blocos móveis em lugares explícitos: proposta antiga já abre com os dois no fim.
    content: documentoParaEditor(inicial),
    // Renderiza só no cliente (Next SSR): evita divergência de hidratação.
    immediatelyRender: false,
    editorProps: { attributes: { class: capa ? "proposta-texto" : "proposta-texto px-4 py-3", "aria-label": "Texto da proposta", "aria-multiline": "true", role: "textbox" } },
    onUpdate: ({ editor: e }) => aoMudar(jsonDoEditor(e)),
  });

  useImperativeHandle(
    controle,
    () => ({
      documento: () => (editor ? jsonDoEditor(editor) : inicial),
      // emitUpdate: false — carregar o do servidor não é edição (não dispara autosave).
      substituir: (d) => editor?.commands.setContent(documentoParaEditor(d), { emitUpdate: false }),
      selecao: () => (editor ? ancoraDaSelecao(editor.state) : null),
    }),
    [editor, inicial],
  );

  useEffect(() => {
    if (editor && !editor.isDestroyed && destaques) editor.view.dispatch(editor.state.tr.setMeta(chaveDestaques, destaques).setMeta("addToHistory", false));
  }, [editor, destaques]);

  // Aviso do limite da tabela: a edição foi recusada, e sem isto pareceria que o editor travou.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    definirAvisoDaTabela(editor, setAvisoTabela);
    return () => definirAvisoDaTabela(editor, null);
  }, [editor]);
  useEffect(() => {
    if (!avisoTabela) return;
    const t = setTimeout(() => setAvisoTabela(null), 6000);
    return () => clearTimeout(t);
  }, [avisoTabela]);

  if (!editor) return <div className="proposta-texto min-h-72 px-4 py-3 text-fg-faint">Carregando editor…</div>;
  if (capa) {
    return (
      <div className="space-y-2.5">
        <Barra editor={editor} fim={barraFim} aviso={avisoTabela} />
        <Folha capa={capa} recolhivel>
          <EditorContent editor={editor} />
        </Folha>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Barra editor={editor} fim={barraFim} aviso={avisoTabela} />
      <div className="rounded-lg border border-input bg-input/20 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

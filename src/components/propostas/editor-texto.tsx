"use client";

import { useEffect, useImperativeHandle, type ReactNode, type Ref } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import Bold from "@tiptap/extension-bold";
import Document from "@tiptap/extension-document";
import Heading from "@tiptap/extension-heading";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import Italic from "@tiptap/extension-italic";
import { BulletList, ListItem, ListKeymap, OrderedList } from "@tiptap/extension-list";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { Dropcursor, Gapcursor, Placeholder, TrailingNode, UndoRedo } from "@tiptap/extensions";
import { Bold as IconeNegrito, CalendarRange, CircleDollarSign, Heading1, Heading2, Heading3, Italic as IconeItalico, List, ListOrdered, Minus, Redo2, Undo2 } from "lucide-react";
import { cn } from "cn";
import type { Ancora } from "@/lib/propostas/ancora";
import { documentoDoEditor, documentoParaEditor, type Documento } from "@/lib/propostas/documento";
import { alternarBloco, BlocoDadosNode, blocosNoEditor } from "./bloco-dados-node";
import { ancoraDaSelecao, chaveDestaques, DestaquesComentarios, type EntradaDestaques } from "./destaques-editor";
import { Folha, type DadosCapa } from "./folha";

/**
 * Editor rich text da proposta (Tiptap). Carrega SÓ as extensões do
 * subconjunto que o Markdown representa (`lib/propostas/documento.ts`): sem
 * link, imagem, código, tabela nem quebra de linha simples. Colar HTML de fora
 * passa pelo esquema do ProseMirror: o que não é do subconjunto vira texto.
 * Os blocos móveis (GAB-100) têm grupo próprio: o documento os aceita, a lista não.
 */
export const EXTENSOES = [
  Document.extend({ content: "(block | blocoDoc)+" }),
  BlocoDadosNode,
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
  HorizontalRule,
  UndoRedo,
  Placeholder.configure({ placeholder: "Escreva a proposta…" }),
];

/**
 * JSON do editor como objetos simples. O ProseMirror cria `attrs` com
 * `Object.create(null)`, e a serialização das server actions do React descarta
 * objetos sem protótipo: o título chegava sem `level` e o servidor recusava o
 * documento ("Conteúdo inválido"). O round-trip por JSON recria tudo como
 * objeto comum, inclusive o `tipo` dos blocos móveis. `documentoDoEditor` registra
 * que os dois blocos saíram da folha, se for o caso.
 */
export function jsonDoEditor(e: Pick<Editor, "getJSON">): Documento {
  return documentoDoEditor(JSON.parse(JSON.stringify(e.getJSON())) as Documento);
}

export type ControleEditor = {
  documento: () => Documento;
  substituir: (d: Documento) => void;
  /** GAB-91: âncora do trecho selecionado, para comentar (null = nada selecionado). */
  selecao?: () => Ancora | null;
  /** GAB-101: comentários de revisão (o "+", a sugestão aplicada) trabalham no próprio editor. */
  editor?: () => Editor | null;
};

function Botao({ ativo, rotulo, onClick, children, desativado, largo }: { ativo?: boolean; rotulo: string; onClick: () => void; children: React.ReactNode; desativado?: boolean; largo?: boolean }) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      title={rotulo}
      aria-pressed={ativo}
      disabled={desativado}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center justify-center gap-1 rounded-md text-fg-mute transition-colors hover:bg-surface-hover hover:text-foreground disabled:opacity-40",
        largo ? "min-w-7 px-1.5 text-xs" : "w-7",
        ativo && "bg-surface-hover text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Barra({ editor, fim }: { editor: Editor; fim?: ReactNode }) {
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
      desfazer: e.can().undo(),
      refazer: e.can().redo(),
    }),
  });
  const c = () => editor.chain().focus();
  return (
    <div role="toolbar" aria-label="Formatação" className="sticky top-14 z-[5] flex flex-wrap items-center gap-0.5 rounded-[10px] border border-border bg-surface p-1">
      <Botao rotulo="Título 1" ativo={s.h1} onClick={() => c().toggleHeading({ level: 1 }).run()}>
        <Heading1 className="size-4" />
      </Botao>
      <Botao rotulo="Título 2" ativo={s.h2} onClick={() => c().toggleHeading({ level: 2 }).run()}>
        <Heading2 className="size-4" />
      </Botao>
      <Botao rotulo="Título 3" ativo={s.h3} onClick={() => c().toggleHeading({ level: 3 }).run()}>
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
      <Botao rotulo="Lista com marcadores" ativo={s.marcadores} onClick={() => c().toggleBulletList().run()}>
        <List className="size-4" />
      </Botao>
      <Botao rotulo="Lista numerada" ativo={s.numerada} onClick={() => c().toggleOrderedList().run()}>
        <ListOrdered className="size-4" />
      </Botao>
      <Botao rotulo="Linha horizontal" onClick={() => c().setHorizontalRule().run()}>
        <Minus className="size-4" />
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
      editor: () => editor,
    }),
    [editor, inicial],
  );

  useEffect(() => {
    if (editor && !editor.isDestroyed && destaques) editor.view.dispatch(editor.state.tr.setMeta(chaveDestaques, destaques).setMeta("addToHistory", false));
  }, [editor, destaques]);

  if (!editor) return <div className="proposta-texto min-h-72 px-4 py-3 text-fg-faint">Carregando editor…</div>;
  if (capa) {
    return (
      <div className="space-y-2.5">
        <Barra editor={editor} fim={barraFim} />
        <Folha capa={capa} recolhivel>
          <EditorContent editor={editor} />
        </Folha>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Barra editor={editor} fim={barraFim} />
      <div className="rounded-lg border border-input bg-input/20 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

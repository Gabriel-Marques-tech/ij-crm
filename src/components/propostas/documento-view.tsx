import { Fragment, type CSSProperties, type ReactNode } from "react";
import { cn } from "cn";
import { segmentosDeDestaque, textoPlano, type Destaque } from "@/lib/propostas/ancora";
import { TITULO_BLOCO_DADOS } from "@/lib/propostas/blocos-dados";
import { documentoComBlocos, type Bloco, type BlocoDados, type CelulaTabela, type Documento, type ItemLista, type NoTexto, type Tabela, type TipoBlocoDados } from "@/lib/propostas/documento";
import type { Estruturado } from "@/lib/propostas/estruturado";
import { largurasDaTabela } from "@/lib/propostas/tabela";
import { BlocoDadosView } from "./bloco-dados-view";

/**
 * Desenha o documento da proposta como elementos React (leitura: versões,
 * quem não edita). Nunca usa HTML cru: todo texto passa pelo escape do React,
 * então Markdown/HTML vindo do MCP aparece como texto, sem injetar nada.
 * As classes são as mesmas do editor (`.proposta-texto`), para ler igual.
 *
 * GAB-91 (`destaques`): cada pedaço de texto sai num `<span data-o>` com o seu
 * offset no texto plano (`lib/propostas/ancora.ts`) — é assim que a seleção do
 * leitor vira âncora — e os trechos comentados num `<mark data-comentario>`.
 * Realce só visual: o documento não muda.
 *
 * GAB-100 (`dados`): a folha mostra os blocos móveis com esses dados, no lugar em que
 * estão. Sem `dados` (leitura dentro de outro painel) os blocos não aparecem.
 */
type Anotacao = { inicios: Map<object, number>; destaques: readonly Destaque[]; ativo: string | null };
type Folha = { dados: Estruturado; controles?: (tipo: TipoBlocoDados) => ReactNode };

function comMarcas(n: NoTexto, texto: string): ReactNode {
  let el: ReactNode = texto;
  const marcas = new Set((n.marks ?? []).map((m) => m.type));
  if (marcas.has("italic")) el = <em>{el}</em>;
  if (marcas.has("bold")) el = <strong>{el}</strong>;
  return el;
}

function Inline({ nos, bloco, anot }: { nos: NoTexto[] | undefined; bloco: Bloco; anot: Anotacao | null }) {
  const inicio = anot?.inicios.get(bloco);
  if (!anot || inicio === undefined) return <>{(nos ?? []).map((n, i) => <Fragment key={i}>{comMarcas(n, n.text)}</Fragment>)}</>;
  let off = inicio;
  const partes: ReactNode[] = [];
  for (const n of nos ?? []) {
    for (const s of segmentosDeDestaque(off, n.text.length, anot.destaques)) {
      const el = comMarcas(n, n.text.slice(s.inicio - off, s.fim - off));
      partes.push(
        s.ids.length ? (
          <mark
            key={s.inicio}
            data-o={s.inicio}
            data-comentario={s.ids.includes(anot.ativo ?? "") ? anot.ativo! : s.ids[0]}
            className={cn("comentario-destaque", anot.ativo && s.ids.includes(anot.ativo) && "comentario-destaque-ativo")}
          >
            {el}
          </mark>
        ) : (
          <span key={s.inicio} data-o={s.inicio}>
            {el}
          </span>
        ),
      );
    }
    off += n.text.length;
  }
  return <>{partes}</>;
}

/** O bloco inteiro é um caractere no texto plano: comentado, o título ganha o realce. Sem `data-o`: não é texto selecionável para âncora. */
function TituloDoBloco({ bloco, anot }: { bloco: BlocoDados; anot: Anotacao | null }) {
  const titulo = TITULO_BLOCO_DADOS[bloco.attrs.tipo];
  const inicio = anot?.inicios.get(bloco);
  if (!anot || inicio === undefined) return <>{titulo}</>;
  const ids = anot.destaques.filter((d) => d.inicio <= inicio && d.fim > inicio).map((d) => d.id);
  if (ids.length === 0) return <>{titulo}</>;
  const ativo = anot.ativo !== null && ids.includes(anot.ativo);
  return (
    <mark data-comentario={ativo ? anot.ativo! : ids[0]} className={cn("comentario-destaque", ativo && "comentario-destaque-ativo")}>
      {titulo}
    </mark>
  );
}

function TextoDaCelula({ celula, anot }: { celula: CelulaTabela; anot: Anotacao | null }) {
  const paragrafo = celula.content[0];
  return (
    <p>
      <Inline nos={paragrafo?.content} bloco={paragrafo} anot={anot} />
    </p>
  );
}

/** A mesma tabela do editor (`tabela-node.ts`) e as mesmas colunas do PDF. A rolagem é da tabela, nunca da página. */
function TabelaLivre({ tabela, anot }: { tabela: Tabela; anot: Anotacao | null }) {
  const [cabecalho, ...corpo] = tabela.content;
  const larguras = largurasDaTabela(tabela);
  return (
    <div className="tabela-rolagem">
      <table className="tabela-livre" style={{ "--colunas": larguras.length } as CSSProperties}>
        <colgroup>
          {larguras.map((l, j) => (
            <col key={j} style={{ width: `${l * 100}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {cabecalho.content.map((c, j) => (
              <th key={j} scope="col">
                <TextoDaCelula celula={c} anot={anot} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {corpo.map((l, i) => (
            <tr key={i} className={l.attrs?.total ? "total" : undefined}>
              {l.content.map((c, j) => (
                <td key={j}>
                  <TextoDaCelula celula={c} anot={anot} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Itens({ itens, anot, folha }: { itens: ItemLista[]; anot: Anotacao | null; folha?: Folha }) {
  return (
    <>
      {itens.map((it, i) => (
        <li key={i}>
          <Blocos blocos={it.content} anot={anot} folha={folha} />
        </li>
      ))}
    </>
  );
}

function Blocos({ blocos, anot, folha }: { blocos: Bloco[]; anot: Anotacao | null; folha?: Folha }) {
  return (
    <>
      {blocos.map((b, i) => {
        switch (b.type) {
          case "paragraph":
            return (
              <p key={i}>
                <Inline nos={b.content} bloco={b} anot={anot} />
              </p>
            );
          case "heading": {
            const H = (`h${b.attrs.level}` as "h1" | "h2" | "h3");
            return (
              <H key={i}>
                <Inline nos={b.content} bloco={b} anot={anot} />
              </H>
            );
          }
          case "horizontalRule":
            return <hr key={i} />;
          case "blocoDados":
            return folha ? (
              <BlocoDadosView
                key={b.attrs.tipo}
                tipo={b.attrs.tipo}
                dados={folha.dados}
                titulo={<TituloDoBloco bloco={b} anot={anot} />}
                controles={folha.controles?.(b.attrs.tipo)}
              />
            ) : null;
          case "semBlocos":
            return null;
          case "table":
            return <TabelaLivre key={i} tabela={b} anot={anot} />;
          case "bulletList":
            return (
              <ul key={i}>
                <Itens itens={b.content} anot={anot} folha={folha} />
              </ul>
            );
          case "orderedList":
            return (
              <ol key={i} start={b.attrs.start}>
                <Itens itens={b.content} anot={anot} folha={folha} />
              </ol>
            );
        }
      })}
    </>
  );
}

export function DocumentoView({
  documento,
  className,
  destaques,
  ativo = null,
  dados,
  controlesBloco,
}: {
  documento: Documento;
  className?: string;
  /** GAB-91: com isto, o texto sai anotado (offsets + trechos comentados). */
  destaques?: readonly Destaque[];
  ativo?: string | null;
  /** GAB-100: os dados dos blocos móveis (a folha); sem isto, os blocos não aparecem. */
  dados?: Estruturado;
  controlesBloco?: (tipo: TipoBlocoDados) => ReactNode;
}) {
  const exibido = dados ? documentoComBlocos(documento) : documento;
  if (exibido.content.length === 0) return <p className={cn("text-sm text-fg-faint", className)}>Sem texto.</p>;
  const anot = destaques ? { inicios: textoPlano(documento).inicios, destaques, ativo } : null;
  const folha = dados ? { dados, controles: controlesBloco } : undefined;
  return (
    <div data-testid="documento-proposta" className={cn("proposta-texto", className)}>
      <Blocos blocos={exibido.content} anot={anot} folha={folha} />
    </div>
  );
}

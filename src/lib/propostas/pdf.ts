/**
 * Conteúdo do PDF da proposta (GAB-89, modelo da IJ no GAB-100): capa, o documento
 * do editor (Markdown canônico) e os blocos móveis Cronograma e Investimento no
 * lugar em que estão na folha. Proposta antiga, sem bloco posicionado, sai com os
 * dois no fim. Só CONTEÚDO: a cara é do template (`@/lib/pdf/templates`).
 * Puro (sem banco): o serviço lê a versão e chama `documentoPdfDaProposta`.
 */
import type { BlocoPdf, DocumentoPdf, Trecho } from "@/lib/pdf/tipos";
import { linhasInvestimento, tabelaCronograma, TITULO_BLOCO_DADOS } from "./blocos-dados";
import { documentoComBlocos, type Bloco, type ItemLista, type NoTexto, type Tabela, type TipoBlocoDados } from "./documento";
import type { Estruturado } from "./estruturado";
import { markdownParaDocumento } from "./markdown";
import { largurasDaTabela } from "./tabela";

export { formatarDia, formatarReais } from "./blocos-dados";

export type DadosPdfProposta = {
  projeto: string;
  empresa: string | null;
  /** Número da versão; null = prévia do rascunho ("Ver PDF" enquanto se escreve). */
  numero: number | null;
  /** Quando a versão foi salva (na prévia, quando o rascunho mudou). */
  data: Date;
  markdown: string;
  estruturado: Estruturado;
};

/** Endereço da IJ na capa. */
export const ENDERECO_IJ = "Avenida Prof. Almeida 520, Butantã - São Paulo/SP - 05508-070.";
export const TITULO_PROPOSTA = "Proposta Comercial de Projeto";

/** "São Paulo, 4 de novembro de 2026" no fuso da IJ. */
export function dataPorExtenso(d: Date): string {
  const data = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Sao_Paulo" }).format(d);
  return `São Paulo, ${data}`;
}

function trechos(nos: NoTexto[] | undefined): Trecho[] {
  return (nos ?? []).map((n) => ({
    texto: n.text,
    negrito: n.marks?.some((m) => m.type === "bold") || undefined,
    italico: n.marks?.some((m) => m.type === "italic") || undefined,
  }));
}

function blocosDeDados(tipo: TipoBlocoDados, e: Estruturado): BlocoPdf[] {
  const titulo: BlocoPdf = { tipo: "titulo", nivel: 2, trechos: [{ texto: TITULO_BLOCO_DADOS[tipo] }] };
  if (tipo === "cronograma") {
    const t = tabelaCronograma(e);
    return t ? [titulo, { tipo: "tabela", colunas: t.colunas, linhas: t.linhas, total: t.total ?? undefined }] : [];
  }
  const linhas = linhasInvestimento(e);
  return linhas.length ? [titulo, ...linhas.map((l): BlocoPdf => ({ tipo: "paragrafo", semRecuo: true, trechos: [{ texto: `${l.rotulo}: ${l.valor}`, negrito: l.forte || undefined }] }))] : [];
}

/** Modelo da IJ: primeira coluna à esquerda e as demais centralizadas. Total: só a marca de quem escreveu. */
function tabelaLivre(t: Tabela): BlocoPdf {
  const larguras = largurasDaTabela(t);
  const [cabecalho, ...corpo] = t.content;
  const celulas = (l: Tabela["content"][number]) => l.content.map((c) => trechos(c.content[0]?.content));
  const totais = corpo.flatMap((l, i) => (l.attrs?.total ? [i] : []));
  return {
    tipo: "tabela",
    colunas: celulas(cabecalho).map((titulo, j) => ({ titulo, largura: larguras[j], alinhar: j === 0 ? "esquerda" : "centro" })),
    linhas: corpo.map(celulas),
    ...(totais.length ? { totais } : {}),
  };
}

function blocosDoDocumento(blocos: Bloco[], e: Estruturado, nivel = 0): BlocoPdf[] {
  const saida: BlocoPdf[] = [];
  for (const b of blocos) {
    switch (b.type) {
      case "heading":
        // O título do documento é o único nível 1 do PDF: # e ## (o modelo usa ##) viram seção; ### subseção.
        saida.push({ tipo: "titulo", nivel: b.attrs.level === 3 ? 3 : 2, trechos: trechos(b.content) });
        break;
      case "paragraph":
        if (nivel === 0) saida.push({ tipo: "paragrafo", trechos: trechos(b.content) });
        else saida.push({ tipo: "item", marcador: null, nivel: nivel - 1, trechos: trechos(b.content) });
        break;
      case "horizontalRule":
        saida.push({ tipo: "linha" });
        break;
      case "blocoDados":
        saida.push(...blocosDeDados(b.attrs.tipo, e));
        break;
      case "semBlocos":
        break;
      case "table":
        saida.push(tabelaLivre(b));
        break;
      case "bulletList":
      case "orderedList":
        b.content.forEach((item: ItemLista, i) => {
          const marcador = b.type === "bulletList" ? (nivel % 2 === 0 ? "•" : "–") : `${(b.attrs.start ?? 1) + i}.`;
          saida.push(...itemDaLista(item, marcador, e, nivel));
        });
        break;
    }
  }
  return saida;
}

function itemDaLista(item: ItemLista, marcador: string, e: Estruturado, nivel: number): BlocoPdf[] {
  const [primeiro, ...resto] = item.content;
  const saida: BlocoPdf[] = [];
  if (primeiro?.type === "paragraph") saida.push({ tipo: "item", marcador, nivel, trechos: trechos(primeiro.content) });
  else {
    saida.push({ tipo: "item", marcador, nivel, trechos: [] });
    if (primeiro) resto.unshift(primeiro);
  }
  saida.push(...blocosDoDocumento(resto, e, nivel + 1));
  return saida;
}

/** Nome do arquivo: "Proposta - <projeto> - v3.pdf" (o download sanitiza para o header). */
export function nomeArquivoPdf(projeto: string, numero: number | null): string {
  const titulo = projeto.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "projeto";
  return `Proposta - ${titulo} - ${numero === null ? "rascunho" : `v${numero}`}.pdf`;
}

export function documentoPdfDaProposta(d: DadosPdfProposta): DocumentoPdf {
  return {
    titulo: TITULO_PROPOSTA,
    capa: { titulo: "PROPOSTA COMERCIAL", empresa: d.empresa ?? d.projeto, data: dataPorExtenso(d.data), endereco: ENDERECO_IJ },
    blocos: blocosDoDocumento(documentoComBlocos(markdownParaDocumento(d.markdown)).content, d.estruturado),
    ...(d.numero === null ? { marca: "RASCUNHO: prévia, não enviar ao cliente" } : {}),
    autor: "Inteli Júnior",
    assunto: d.numero === null ? `Proposta — ${d.projeto} (prévia do rascunho)` : `Proposta — ${d.projeto} (v${d.numero})`,
  };
}

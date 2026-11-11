/**
 * Sugestão aplicável (GAB-101, spec proposta-folha §6): o texto novo de um trecho. Puro: roda no
 * servidor (conferência e gravação) e na tela (diz se ainda se aplica, sem esperar o servidor).
 *
 * Não confundir com `./sugestao.ts`, que é a sugestão do preenchimento por arquivo.
 *
 * `localizarAncora` serve para DESTACAR: acha a ocorrência mais parecida, mesmo que seja outra.
 * Aplicar pede mais: se o trecho original mudou e o mesmo texto existe em outro lugar, a
 * sugestão não pode cair lá. Por isso a ocorrência precisa ter intacto ao menos um dos lados do
 * contexto — medido SÓ DENTRO DO BLOCO do trecho (o contexto da âncora atravessa a fronteira `\n`,
 * e no "+" da linha mora todo nos parágrafos vizinhos: editar os vizinhos não muda o trecho). O
 * contexto inteiro, com os vizinhos, só desempata entre ocorrências iguais; empate é ambíguo → null.
 */
import { CONTEXTO_ANCORA, criarAncora, OCORRENCIAS_MAX, textoPlano, TOKEN_BLOCO, TRECHO_MAX, type Ancora, type Faixa } from "./ancora";
import type { Bloco, Documento, ItemLista, NoTexto } from "./documento";

const TOKENS = Object.values(TOKEN_BLOCO);

/** Dá para sugerir só dentro de um bloco de texto: nunca atravessando blocos nem sobre Cronograma e Investimento. */
export function trechoSugerivel(trecho: string): boolean {
  return trecho !== "" && !trecho.includes("\n") && !TOKENS.some((t) => trecho.includes(t));
}

export function temCaractereReservado(texto: string): boolean {
  return TOKENS.some((t) => texto.includes(t));
}

/**
 * Um lado do contexto pronto para comparar. `ateABorda`: o contexto ia até a borda (do bloco ou do
 * texto), então não quer dizer "qualquer coisa": a ocorrência tem que estar colada à mesma borda.
 */
type Lado = { texto: string; ateABorda: boolean };
type Lados = { antes: Lado; depois: Lado };

/** Contexto inteiro (atravessa blocos, borda = o texto) e só o que fica no bloco do trecho (borda = `\n`). */
function ladosDaAncora(a: Ancora): { inteiro: Lados; noBloco: Lados } {
  // Menor que o máximo é porque o texto acabou ali.
  const curto = (c: string) => c.length < CONTEXTO_ANCORA;
  const nlAntes = a.antes.lastIndexOf("\n");
  const nlDepois = a.depois.indexOf("\n");
  return {
    inteiro: { antes: { texto: a.antes, ateABorda: curto(a.antes) }, depois: { texto: a.depois, ateABorda: curto(a.depois) } },
    noBloco: {
      antes: { texto: a.antes.slice(nlAntes + 1), ateABorda: nlAntes !== -1 || curto(a.antes) },
      depois: { texto: nlDepois === -1 ? a.depois : a.depois.slice(0, nlDepois), ateABorda: nlDepois !== -1 || curto(a.depois) },
    },
  };
}

/** Quantos lados (0–2) continuam iguais em volta de [inicio, fim), dadas as bordas de referência. */
function ladosIntactos(texto: string, l: Lados, inicio: number, fim: number, bordaAntes: number, bordaDepois: number): number {
  const antes = texto.slice(l.antes.ateABorda ? bordaAntes : Math.max(0, inicio - l.antes.texto.length), inicio) === l.antes.texto;
  const depois = texto.slice(fim, l.depois.ateABorda ? bordaDepois : fim + l.depois.texto.length) === l.depois.texto;
  return Number(antes) + Number(depois);
}

/**
 * Onde a sugestão se aplica no texto atual; null = desatualizada. Vale a ocorrência com ao menos um
 * lado do contexto intacto no próprio bloco; entre várias, a de mais lados intactos (contando também
 * o contexto inteiro, com os vizinhos). Empate no topo é ambíguo: ninguém aplica no lugar errado.
 */
export function localizarSugestao(texto: string, a: Ancora): Faixa | null {
  if (!trechoSugerivel(a.trecho)) return null;
  const { inteiro, noBloco } = ladosDaAncora(a);
  let melhor: Faixa | null = null;
  let pontos = 0;
  let empate = false;
  let n = 0;
  for (let i = texto.indexOf(a.trecho); i !== -1 && n < OCORRENCIAS_MAX; i = texto.indexOf(a.trecho, i + 1), n++) {
    const fim = i + a.trecho.length;
    const inicioBloco = i === 0 ? 0 : texto.lastIndexOf("\n", i - 1) + 1;
    const quebra = texto.indexOf("\n", fim);
    const fimBloco = quebra === -1 ? texto.length : quebra;
    const doBloco = ladosIntactos(texto, noBloco, i, fim, inicioBloco, fimBloco);
    if (doBloco === 0) continue;
    const p = doBloco + ladosIntactos(texto, inteiro, i, fim, 0, texto.length);
    if (p > pontos) {
      pontos = p;
      melhor = { inicio: i, fim };
      empate = false;
    } else if (p === pontos) empate = true;
  }
  return empate ? null : melhor;
}

/** Texto novo com a formatação do começo do trecho (a mesma regra no editor: `transacaoDeSugestao`). */
function trocarNoBloco(nos: NoTexto[], de: number, ate: number, novo: string): NoTexto[] {
  const saida: NoTexto[] = [];
  let off = 0;
  let inserido = false;
  const inserir = (marks: NoTexto["marks"]) => {
    if (inserido) return;
    inserido = true;
    if (novo) saida.push({ type: "text", text: novo, ...(marks?.length ? { marks } : {}) });
  };
  for (const n of nos) {
    const ini = off;
    const fim = off + n.text.length;
    off = fim;
    if (fim <= de || ini >= ate) {
      saida.push(n);
      continue;
    }
    if (ini < de) saida.push({ ...n, text: n.text.slice(0, de - ini) });
    inserir(n.marks);
    if (fim > ate) saida.push({ ...n, text: n.text.slice(ate - ini) });
  }
  return saida;
}

/** Documento com `novo` no lugar da faixa do texto plano; null = a faixa não cabe num bloco de texto. */
export function aplicarNoDocumento(doc: Documento, f: Faixa, novo: string): Documento | null {
  const { inicios } = textoPlano(doc);
  let aplicado = false;
  const visitar = <T extends Bloco | ItemLista>(b: T): T => {
    if (b.type === "paragraph" || b.type === "heading") {
      const ini = inicios.get(b);
      const nos = b.content ?? [];
      const tam = nos.reduce((s, n) => s + n.text.length, 0);
      if (ini === undefined || f.inicio < ini || f.fim > ini + tam) return b;
      aplicado = true;
      return { ...b, content: trocarNoBloco(nos, f.inicio - ini, f.fim - ini, novo) };
    }
    if (b.type === "bulletList" || b.type === "orderedList" || b.type === "listItem") return { ...b, content: (b.content as (Bloco | ItemLista)[]).map(visitar) } as T;
    return b;
  };
  const content = doc.content.map(visitar);
  return aplicado ? { ...doc, content } : null;
}

/** O "+" da linha: o bloco inteiro; bloco maior que o limite da âncora fica no começo, sem cortar palavra. */
export function ancoraDaLinha(texto: string, inicio: number, tamanho: number): Ancora | null {
  let fim = inicio + tamanho;
  if (tamanho > TRECHO_MAX) {
    const corte = texto.lastIndexOf(" ", inicio + TRECHO_MAX);
    fim = corte > inicio ? corte : inicio + TRECHO_MAX;
  }
  return criarAncora(texto, inicio, fim);
}


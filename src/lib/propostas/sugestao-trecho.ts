/**
 * Sugestão aplicável (GAB-101, spec proposta-folha §6): o texto novo de um trecho. Puro: roda no
 * servidor (conferência e gravação) e na tela (diz se ainda se aplica, sem esperar o servidor).
 *
 * Não confundir com `./sugestao.ts`, que é a sugestão do preenchimento por arquivo.
 *
 * `localizarAncora` serve para DESTACAR: acha a ocorrência mais parecida, mesmo que seja outra.
 * Aplicar pede mais: se o trecho original mudou e o mesmo texto existe em outro lugar, a
 * sugestão não pode cair lá. Por isso a ocorrência precisa ter intacto ao menos um dos lados do contexto.
 */
import { criarAncora, OCORRENCIAS_MAX, textoPlano, TOKEN_BLOCO, TRECHO_MAX, type Ancora, type Faixa } from "./ancora";
import type { Bloco, Documento, ItemLista, NoTexto } from "./documento";

const TOKENS = Object.values(TOKEN_BLOCO);

/** Dá para sugerir só dentro de um bloco de texto: nunca atravessando blocos nem sobre Cronograma e Investimento. */
export function trechoSugerivel(trecho: string): boolean {
  return trecho !== "" && !trecho.includes("\n") && !TOKENS.some((t) => trecho.includes(t));
}

export function temCaractereReservado(texto: string): boolean {
  return TOKENS.some((t) => texto.includes(t));
}

/** Onde a sugestão se aplica no texto atual; null = desatualizada. */
export function localizarSugestao(texto: string, a: Ancora): Faixa | null {
  if (!trechoSugerivel(a.trecho)) return null;
  let melhor: Faixa | null = null;
  let pontos = 0;
  let n = 0;
  for (let i = texto.indexOf(a.trecho); i !== -1 && n < OCORRENCIAS_MAX; i = texto.indexOf(a.trecho, i + 1), n++) {
    const fim = i + a.trecho.length;
    // Contexto vazio quer dizer "começo (ou fim) do texto", e não "qualquer coisa".
    const antes = a.antes ? texto.slice(Math.max(0, i - a.antes.length), i) === a.antes : i === 0;
    const depois = a.depois ? texto.slice(fim, fim + a.depois.length) === a.depois : fim === texto.length;
    const p = Number(antes) + Number(depois);
    if (p > pontos) {
      pontos = p;
      melhor = { inicio: i, fim };
    }
  }
  return melhor;
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


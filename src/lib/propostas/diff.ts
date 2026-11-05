/**
 * Diff entre duas versões da proposta (GAB-87, spec §4.3/§4.5): quem recebe a
 * caneta vê o que mudou entre a versão que entregou e a que voltou; qualquer
 * um compara duas versões quaisquer. Puro e sem dependência: o Markdown
 * canônico tem um bloco por linha (títulos, parágrafos, itens), então o diff é
 * por linha (LCS), e cada bloco alterado mostra as palavras trocadas.
 *
 * Custo limitado: prefixo/sufixo iguais saem antes; se o miolo ainda passar de
 * `CELULAS_MAX` (texto enorme todo diferente), vira "removeu tudo / adicionou
 * tudo" — legível e sem travar o servidor.
 *
 * Blocos móveis (GAB-100): o diff compara a forma de EXIBIÇÃO, com os blocos explícitos
 * (a mesma regra de `documentoComBlocos`, por linha), para dizer o que aconteceu com eles:
 * sem marcador, os dois estão no fim; `bloco:nenhum`, nenhum dos dois. Aparecem em
 * palavras, e nunca pareados com texto: mover o bloco não é "texto alterado".
 *
 * Tabela (GAB-102): uma linha de diff por linha da tabela, com as palavras trocadas. A régua
 * `| --- |` não aparece, e a marca de total sai por extenso no fim da linha. Parágrafo nunca
 * começa por `|` no canônico (sai `\|`), então só tabela cai aqui.
 */
import { MARCADORES_BLOCO, rotuloDaEntrega } from "./blocos-dados";
import type { Estruturado } from "./estruturado";

export type Trecho = { tipo: "igual" | "removido" | "adicionado"; texto: string };

export type LinhaDiff =
  | { tipo: "igual"; texto: string }
  | { tipo: "removida"; texto: string }
  | { tipo: "adicionada"; texto: string }
  | { tipo: "alterada"; antes: Trecho[]; depois: Trecho[] };

const CELULAS_MAX = 2_000_000;

type Op<T> = { tipo: "igual" | "removido" | "adicionado"; item: T };

/**
 * LCS clássico sobre o miolo (sem prefixo/sufixo comuns). `adicionarAntes`: no empate, o que
 * entra primeiro em vez de sair; assim, ao mover um bloco, quem aparece movido é o bloco, e não o texto.
 */
function diffSequencia<T>(a: readonly T[], b: readonly T[], adicionarAntes?: (item: T) => boolean): Op<T>[] {
  let ini = 0;
  while (ini < a.length && ini < b.length && a[ini] === b[ini]) ini++;
  let fimA = a.length;
  let fimB = b.length;
  while (fimA > ini && fimB > ini && a[fimA - 1] === b[fimB - 1]) {
    fimA--;
    fimB--;
  }
  const ops: Op<T>[] = a.slice(0, ini).map((item) => ({ tipo: "igual", item }));
  const ma = a.slice(ini, fimA);
  const mb = b.slice(ini, fimB);
  const n = ma.length;
  const m = mb.length;
  if (n * m > CELULAS_MAX) {
    ops.push(...ma.map((item) => ({ tipo: "removido" as const, item })), ...mb.map((item) => ({ tipo: "adicionado" as const, item })));
  } else {
    // tab[i][j] = LCS de ma[i..] e mb[j..]
    const tab = new Uint32Array((n + 1) * (m + 1));
    const w = m + 1;
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        tab[i * w + j] = ma[i] === mb[j] ? tab[(i + 1) * w + j + 1] + 1 : Math.max(tab[(i + 1) * w + j], tab[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (ma[i] === mb[j]) {
        ops.push({ tipo: "igual", item: ma[i] });
        i++;
        j++;
      } else if (tab[(i + 1) * w + j] > tab[i * w + j + 1] || (tab[(i + 1) * w + j] === tab[i * w + j + 1] && !adicionarAntes?.(mb[j]))) {
        ops.push({ tipo: "removido", item: ma[i++] });
      } else {
        ops.push({ tipo: "adicionado", item: mb[j++] });
      }
    }
    while (i < n) ops.push({ tipo: "removido", item: ma[i++] });
    while (j < m) ops.push({ tipo: "adicionado", item: mb[j++] });
  }
  ops.push(...a.slice(fimA).map((item) => ({ tipo: "igual" as const, item })));
  return ops;
}

/** Junta tokens vizinhos do mesmo tipo em trechos. */
function trechos(ops: Op<string>[], lado: "antes" | "depois"): Trecho[] {
  const fora = lado === "antes" ? "adicionado" : "removido";
  const out: Trecho[] = [];
  for (const o of ops) {
    if (o.tipo === fora) continue;
    const ult = out.at(-1);
    if (ult && ult.tipo === o.tipo) ult.texto += o.item;
    else out.push({ tipo: o.tipo, texto: o.item });
  }
  return out;
}

function diffPalavras(antes: string, depois: string): { antes: Trecho[]; depois: Trecho[] } {
  const tok = (s: string) => s.split(/(\s+)/).filter((t) => t !== "");
  const ops = diffSequencia(tok(antes), tok(depois));
  return { antes: trechos(ops, "antes"), depois: trechos(ops, "depois") };
}

const MARCADOR_NENHUM = "<!-- bloco:nenhum -->";

const REGUA_DA_TABELA = /^\|( --- \|)+$/;
const COM_TOTAL = /^\| <!-- total -->(?: (?!\|))?/;
export const ROTULO_TOTAL = "[linha de total]";

/** Linhas do Markdown como a pessoa lê: a régua da tabela (a 2ª linha do bloco) sai, e o total fica por extenso. */
function linhasLegiveis(md: string): string[] {
  const brutas = md.split("\n");
  return brutas.flatMap((l, i) => {
    if (l.trim() === "") return [];
    const segundaDoBloco = i > 0 && brutas[i - 1].startsWith("|") && (i === 1 || brutas[i - 2].trim() === "");
    if (segundaDoBloco && REGUA_DA_TABELA.test(l)) return [];
    return [COM_TOTAL.test(l) ? `${l.replace(COM_TOTAL, "| ")} ${ROTULO_TOTAL}` : l];
  });
}

/** Linhas do Markdown canônico com os blocos em lugares explícitos. */
function linhas(md: string | null): string[] {
  if (md === null) return [];
  const todas = linhasLegiveis(md);
  const semMarcador = todas.filter((l) => l !== MARCADOR_NENHUM);
  if (semMarcador.length < todas.length || semMarcador.some((l) => Object.hasOwn(MARCADORES_BLOCO, l))) return semMarcador;
  return [...semMarcador, ...Object.keys(MARCADORES_BLOCO)];
}
const ehBloco = (l: string) => Object.hasOwn(MARCADORES_BLOCO, l);
const legivel = (l: string) => (ehBloco(l) ? MARCADORES_BLOCO[l] : l);

/** `antes` null = não há versão anterior: tudo entrou, inclusive os blocos. */
export function diffMarkdown(antes: string | null, depois: string): LinhaDiff[] {
  const ops = diffSequencia(linhas(antes), linhas(depois), ehBloco);
  const out: LinhaDiff[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].tipo === "igual") {
      out.push({ tipo: "igual", texto: legivel(ops[i].item) });
      i++;
      continue;
    }
    // Um bloco de mudanças: removidas e adicionadas em sequência; pareia por posição (= linha alterada).
    const rem: string[] = [];
    const adi: string[] = [];
    while (i < ops.length && ops[i].tipo !== "igual") {
      (ops[i].tipo === "removido" ? rem : adi).push(ops[i].item);
      i++;
    }
    const remTexto = rem.filter((l) => !ehBloco(l));
    const adiTexto = adi.filter((l) => !ehBloco(l));
    const pares = Math.min(remTexto.length, adiTexto.length);
    for (let k = 0; k < pares; k++) out.push({ tipo: "alterada", ...diffPalavras(remTexto[k], adiTexto[k]) });
    for (const t of remTexto.slice(pares)) out.push({ tipo: "removida", texto: t });
    for (const t of adiTexto.slice(pares)) out.push({ tipo: "adicionada", texto: t });
    for (const t of rem.filter(ehBloco)) out.push({ tipo: "removida", texto: legivel(t) });
    for (const t of adi.filter(ehBloco)) out.push({ tipo: "adicionada", texto: legivel(t) });
  }
  return out;
}

export function temMudanca(d: readonly LinhaDiff[]): boolean {
  return d.some((l) => l.tipo !== "igual");
}

/** Diff em texto (MCP): "  " igual, "- " antes, "+ " depois. */
export function diffParaTexto(d: readonly LinhaDiff[]): string {
  return d
    .flatMap((l) => {
      if (l.tipo === "igual") return [`  ${l.texto}`];
      if (l.tipo === "removida") return [`- ${l.texto}`];
      if (l.tipo === "adicionada") return [`+ ${l.texto}`];
      return [`- ${l.antes.map((t) => t.texto).join("")}`, `+ ${l.depois.map((t) => t.texto).join("")}`];
    })
    .join("\n");
}

// ---------------------------------------------------------------- parte estruturada

export type MudancaCampo = { campo: string; antes: string; depois: string };

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dinheiro = (v: string | null) => (v === null ? "—" : BRL.format(Number(v)).replace(/\s/g, " "));
function textoEntregas(e: Estruturado["entregas"]): string {
  if (e.length === 0) return "—";
  return e.map((x) => [x.titulo, rotuloDaEntrega(x), ...(x.valor ? [dinheiro(x.valor)] : [])].join(" · ")).join("\n");
}

/** Campos da parte estruturada que mudaram, já formatados como a tela mostra. */
export function diffEstruturado(antes: Estruturado, depois: Estruturado): MudancaCampo[] {
  const campos: [string, (e: Estruturado) => string][] = [
    ["Valor", (e) => dinheiro(e.valor)],
    ["Prazo", (e) => (e.prazoDias === null ? "—" : `${e.prazoDias} dias`)],
    ["Escopo resumido", (e) => e.escopoResumo ?? "—"],
    ["Cronograma de entregas", (e) => textoEntregas(e.entregas)],
  ];
  return campos.flatMap(([campo, f]) => (f(antes) === f(depois) ? [] : [{ campo, antes: f(antes), depois: f(depois) }]));
}

/**
 * Gerador de PDF do CRM (GAB-89; o contrato do GAB-92 reaproveita): junta um
 * `DocumentoPdf` (conteúdo) com um `TemplatePdf` (a cara) e devolve os bytes.
 *
 * Por que pdf-lib (+ @pdf-lib/fontkit): JavaScript puro, sem binário nem
 * navegador (puppeteer/chromium não cabem no container de 512 MB), sem `fs`
 * dentro da lib (empacota no Next sem ajuste) e com fonte TrueType EMBUTIDA em
 * subconjunto — acentos e qualquer caractere que a fonte tenha, só com os
 * glifos usados (o arquivo fica pequeno). O pdf-lib não faz layout: a quebra
 * de linha/página é este módulo (texto corrido, listas, campos e tabela — o
 * que a proposta e o contrato usam).
 *
 * Caractere que a fonte não tem (emoji, ideograma) vira "?" em vez de um
 * glifo vazio: o PDF nunca sai com buraco silencioso.
 */
import fontkit from "@pdf-lib/fontkit";
import { beginText, endText, moveText, PDFDocument, popGraphicsState, pushGraphicsState, rgb, setFillingColor, setFontAndSize, showText, type PDFFont, type PDFHexString, type PDFImage, type PDFName, type PDFOperator, type PDFPage } from "pdf-lib";
import type { BlocoPdf, CelulaPdf, ContextoPagina, Cor, DocumentoPdf, EstiloTexto, Pincel, TemplatePdf, Trecho } from "./tipos";

/**
 * Sem as features de layout do OpenType (contextuais, ligaduras, kerning):
 * cada `drawText` roda o shaping do fontkit, e com elas a Inter custava ~60 ms
 * por página (uma proposta de 100 mil caracteres levava segundos). Para texto
 * latino de documento o resultado visual é o mesmo, e as larguras medidas
 * (`medir`, soma por caractere) passam a bater exatamente com o desenhado.
 */
const SEM_LAYOUT = { calt: false, liga: false, clig: false, kern: false, ccmp: false, locl: false, mark: false, mkmk: false, rlig: false, dlig: false } as const;

const PAD_TABELA_V = 4;
const PAD_TABELA_H = 5;
/**
 * Quantos títulos seguidos um título reserva junto consigo. Até aqui, nenhum fica órfão. Numa
 * sequência maior a reserva para neste limite, senão cada título pediria o resto da sequência e
 * sairia um por página.
 */
const TITULOS_JUNTOS = 3;
/** Cabeçalho de tabela mais alto que esta parte da página não se repete: sobraria pouco para as linhas. */
const CABECALHO_REPETIDO_MAX = 0.4;

type Fontes = { regular: PDFFont; negrito: PDFFont; italico: PDFFont; negritoItalico: PDFFont; capa?: { regular: PDFFont; negrito: PDFFont } };

const cor = (c: Cor) => rgb(c.r, c.g, c.b);

function fonteDe(f: Fontes, negrito?: boolean, italico?: boolean): PDFFont {
  if (negrito && italico) return f.negritoItalico;
  if (negrito) return f.negrito;
  if (italico) return f.italico;
  return f.regular;
}

/** Texto que a fonte desenha: espaços/controle normalizados e o que ela não tem → "?". */
export function limparTexto(t: string, suportados: ReadonlySet<number>): string {
  let saida = "";
  for (const ch of t.normalize("NFC")) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x09 || cp === 0x0a || cp === 0x0d || cp === 0xa0) saida += " ";
    else if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0) || cp === 0x200b || cp === 0xfeff) continue;
    else saida += suportados.has(cp) ? ch : "?";
  }
  return saida;
}

/**
 * Largura = soma das larguras de cada caractere (cache por fonte). O
 * `widthOfTextAtSize` do pdf-lib roda o layout do fontkit a cada chamada:
 * medir palavra por palavra (e partir palavra longa) ficava quadrático.
 */
const larguras = new WeakMap<PDFFont, Map<string, number>>();
function medir(fonte: PDFFont, texto: string, tamanho: number): number {
  let cache = larguras.get(fonte);
  if (!cache) larguras.set(fonte, (cache = new Map()));
  let total = 0;
  for (const ch of texto) {
    let w = cache.get(ch);
    if (w === undefined) cache.set(ch, (w = fonte.widthOfTextAtSize(ch, 1000)));
    total += w;
  }
  return (total * tamanho) / 1000;
}

type Palavra = { texto: string; fonte: PDFFont; largura: number; espaco: number };

/**
 * Quebra os trechos em linhas de até `max` pontos (palavra maior que a linha é
 * partida). `recuoPrimeira`: a primeira linha tem esse tanto a menos.
 */
function quebrarLinhas(trechos: Trecho[], estilo: EstiloTexto, f: Fontes, limpar: (t: string) => string, max: number, recuoPrimeira = 0): Palavra[][] {
  const palavras: Palavra[] = [];
  for (const t of trechos) {
    const fonte = fonteDe(f, t.negrito ?? estilo.negrito, t.italico);
    const espaco = medir(fonte, " ", estilo.tamanho);
    const texto = limpar(t.texto);
    // Espaço na fronteira entre trechos ("**negrito** depois") conta como separador.
    const partes = texto.split(" ");
    partes.forEach((p, i) => {
      if (i > 0 && palavras.length) palavras[palavras.length - 1].espaco = espaco;
      if (p === "") return;
      // Trecho colado no anterior ("neg**rito**"): vira outra "palavra" com espaço 0 entre as duas.
      palavras.push({ texto: p, fonte, largura: medir(fonte, p, estilo.tamanho), espaco: 0 });
    });
  }
  const linhas: Palavra[][] = [];
  let atual: Palavra[] = [];
  let larg = 0;
  for (const p of palavras) {
    const pedacos = p.largura > max ? partirPalavra(p, estilo.tamanho, max) : [p];
    for (const q of pedacos) {
      const antes = atual.length ? atual[atual.length - 1].espaco : 0;
      const limite = linhas.length === 0 ? max - recuoPrimeira : max;
      // Palavra que só cabe sem o recuo: a primeira linha fica vazia e ela desce (linhas.length passa a 1).
      if (larg + antes + q.largura > limite && (atual.length || linhas.length === 0)) {
        linhas.push(atual);
        atual = [];
        larg = 0;
      }
      larg += (atual.length ? atual[atual.length - 1].espaco : 0) + q.largura;
      atual.push(q);
    }
  }
  if (atual.length) linhas.push(atual);
  return linhas;
}

/** Negrito da linha (cabeçalho, total) vale para a célula toda; o itálico de quem escreveu continua. */
function trechosDaCelula(c: CelulaPdf, negrito: boolean): Trecho[] {
  return typeof c === "string" ? [{ texto: c, negrito }] : c.map((t) => ({ ...t, negrito: negrito || t.negrito }));
}

/**
 * Palavras seguidas na mesma fonte viram um `drawText` só (com os espaços):
 * cada chamada roda o layout do fontkit, e por palavra a proposta de 100 mil
 * caracteres levava segundos. `largura` inclui o espaço depois do grupo.
 */
function agrupar(linha: Palavra[]): { texto: string; fonte: PDFFont; largura: number }[] {
  const grupos: { texto: string; fonte: PDFFont; largura: number }[] = [];
  for (const p of linha) {
    const g = grupos.at(-1);
    const espaco = p.espaco > 0 ? " " : "";
    if (g && g.fonte === p.fonte) {
      g.texto += p.texto + espaco;
      g.largura += p.largura + p.espaco;
    } else grupos.push({ texto: p.texto + espaco, fonte: p.fonte, largura: p.largura + p.espaco });
  }
  return grupos;
}

/** Texto já codificado para a fonte, por palavra: é o que evita o layout do fontkit a cada palavra justificada. */
const codificados = new WeakMap<PDFFont, Map<string, PDFHexString>>();
function codificar(fonte: PDFFont, texto: string): PDFHexString {
  let cache = codificados.get(fonte);
  if (!cache) codificados.set(fonte, (cache = new Map()));
  let hex = cache.get(texto);
  if (!hex) cache.set(texto, (hex = fonte.encodeText(texto)));
  return hex;
}

/** Chave da fonte nos recursos da página: uma entrada por fonte e página basta. */
const chavesDeFonte = new WeakMap<PDFPage, Map<PDFFont, PDFName>>();
function chaveDaFonte(pagina: PDFPage, fonte: PDFFont): PDFName {
  let cache = chavesDeFonte.get(pagina);
  if (!cache) chavesDeFonte.set(pagina, (cache = new Map()));
  let chave = cache.get(fonte);
  if (!chave) {
    chave = pagina.node.newFontDictionary(fonte.name, fonte.ref);
    cache.set(fonte, chave);
  }
  return chave;
}

/**
 * Linha justificada: o espaço que sobra entra só nos vãos entre palavras. O operador
 * de espaçamento do PDF não vale para fonte embutida em 2 bytes, então cada palavra
 * é posicionada, num bloco de texto só e com a codificação guardada.
 * false = não há vão (uma palavra só, ou vãos largos demais): quem chamou desenha normal.
 */
function desenharJustificada(pagina: PDFPage, linha: Palavra[], x: number, y: number, largura: number, tamanho: number, tinta: Cor): boolean {
  const vaos = linha.slice(0, -1).filter((p) => p.espaco > 0).length;
  if (vaos === 0) return false;
  const natural = linha.reduce((s, p, i) => s + p.largura + (i < linha.length - 1 ? p.espaco : 0), 0);
  const extra = (largura - natural) / vaos;
  if (extra < 0 || extra > tamanho * 2.5) return false;
  const ops: PDFOperator[] = [pushGraphicsState(), beginText(), setFillingColor(cor(tinta)), moveText(x, y)];
  let fonteAtual: PDFFont | null = null;
  linha.forEach((p, i) => {
    if (p.fonte !== fonteAtual) {
      ops.push(setFontAndSize(chaveDaFonte(pagina, p.fonte), tamanho));
      fonteAtual = p.fonte;
    }
    const ultima = i === linha.length - 1;
    // O espaço vai junto da palavra (não aparece, mas o texto copiado do PDF fica com ele).
    ops.push(showText(codificar(p.fonte, p.espaco > 0 && !ultima ? `${p.texto} ` : p.texto)));
    if (!ultima) ops.push(moveText(p.largura + p.espaco + (p.espaco > 0 ? extra : 0), 0));
  });
  ops.push(endText(), popGraphicsState());
  pagina.pushOperators(...ops);
  return true;
}

function partirPalavra(p: Palavra, tamanho: number, max: number): Palavra[] {
  const saida: Palavra[] = [];
  let buf = "";
  let larg = 0;
  for (const ch of p.texto) {
    const w = medir(p.fonte, ch, tamanho);
    if (buf && larg + w > max) {
      saida.push({ texto: buf, fonte: p.fonte, largura: larg, espaco: 0 });
      buf = "";
      larg = 0;
    }
    buf += ch;
    larg += w;
  }
  saida.push({ texto: buf, fonte: p.fonte, largura: larg, espaco: p.espaco });
  return saida;
}

/** Gera o PDF. Determinístico para o mesmo conteúdo (datas de criação fixadas pelo chamador, se quiser). */
export async function gerarPdf(doc: DocumentoPdf, template: TemplatePdf, opts: { criadoEm?: Date } = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const bytes = await template.fontes();
  const f: Fontes = {
    regular: await pdf.embedFont(bytes.regular, { subset: true, features: SEM_LAYOUT }),
    negrito: await pdf.embedFont(bytes.negrito, { subset: true, features: SEM_LAYOUT }),
    italico: await pdf.embedFont(bytes.italico, { subset: true, features: SEM_LAYOUT }),
    negritoItalico: await pdf.embedFont(bytes.negritoItalico, { subset: true, features: SEM_LAYOUT }),
  };
  const comCapa = Boolean(doc.capa && template.capa);
  if (comCapa && bytes.capa) f.capa = { regular: await pdf.embedFont(bytes.capa.regular, { subset: true, features: SEM_LAYOUT }), negrito: await pdf.embedFont(bytes.capa.negrito, { subset: true, features: SEM_LAYOUT }) };
  const imagens = new Map<string, PDFImage>();
  for (const [nome, png] of Object.entries((await template.imagens?.()) ?? {})) {
    if (nome !== "capa" || comCapa) imagens.set(nome, await pdf.embedPng(png));
  }
  const suportados = new Set(f.regular.getCharacterSet());
  const limpar = (t: string) => limparTexto(t, suportados);

  pdf.setTitle(limpar(doc.titulo));
  pdf.setCreator("ij-crm");
  pdf.setProducer("ij-crm (pdf-lib)");
  if (doc.autor) pdf.setAuthor(limpar(doc.autor));
  if (doc.assunto) pdf.setSubject(limpar(doc.assunto));
  if (opts.criadoEm) {
    pdf.setCreationDate(opts.criadoEm);
    pdf.setModificationDate(opts.criadoEm);
  }

  const { largura: W, altura: H, margem } = template.pagina;
  const larguraUtil = W - margem.esquerda - margem.direita;
  const est = template.estilos;
  if (comCapa) pdf.addPage([W, H]);
  let pagina: PDFPage = pdf.addPage([W, H]);
  let y = H - margem.topo;

  const novaPagina = () => {
    pagina = pdf.addPage([W, H]);
    y = H - margem.topo;
  };
  /** Garante `altura` livre; senão vai para a próxima página. Página ainda vazia fica: trocar só deixaria uma em branco. */
  const caber = (altura: number) => {
    if (y - altura < margem.base && y < H - margem.topo) novaPagina();
  };

  const larguraDaLinha = (l: Palavra[]) => l.reduce((s, p, i) => s + p.largura + (i < l.length - 1 ? p.espaco : 0), 0);

  const desenharLinhas = (linhas: Palavra[][], estilo: EstiloTexto, x: number, largura = larguraUtil - (x - margem.esquerda), recuoPrimeira = 0) => {
    const alturaLinha = estilo.tamanho * estilo.entrelinha;
    const base = (alturaLinha - estilo.tamanho) / 2;
    linhas.forEach((linha, i) => {
      caber(alturaLinha);
      y -= alturaLinha;
      const recuo = i === 0 ? recuoPrimeira : 0;
      if (estilo.alinhar === "justificado" && i < linhas.length - 1 && desenharJustificada(pagina, linha, x + recuo, y + base, largura - recuo, estilo.tamanho, estilo.cor)) return;
      let cx = estilo.alinhar === "centro" ? x + (largura - larguraDaLinha(linha)) / 2 : x + recuo;
      for (const g of agrupar(linha)) {
        pagina.drawText(g.texto, { x: cx, y: y + base, size: estilo.tamanho, font: g.fonte, color: cor(estilo.cor) });
        cx += g.largura;
      }
    });
  };

  const textoCorrido = (trechos: Trecho[], estilo: EstiloTexto, xBase: number, larguraBase: number, primeiro: boolean, semRecuo = false, reservaDepois = 0) => {
    const x = xBase + (estilo.recuo ?? 0);
    const largura = larguraBase - (estilo.recuo ?? 0);
    const recuoPrimeira = semRecuo ? 0 : (estilo.recuoPrimeira ?? 0);
    const linhas = quebrarLinhas(trechos, estilo, f, limpar, largura, recuoPrimeira);
    if (!primeiro) y -= estilo.antes;
    // Título nunca fica sozinho no pé da página: leva junto o começo do que vem depois.
    if (estilo !== est.texto && estilo !== est.rotulo) caber(estilo.tamanho * estilo.entrelinha * linhas.length + estilo.depois + reservaDepois);
    desenharLinhas(linhas, estilo, x, largura, recuoPrimeira);
    y -= estilo.depois;
  };

  const blocos: BlocoPdf[] = [
    { tipo: "titulo", nivel: 1, trechos: [{ texto: doc.titulo }] },
    ...(doc.subtitulo ?? []).map((s): BlocoPdf => ({ tipo: "paragrafo", trechos: [{ texto: s }] })),
  ];
  const nAbertura = blocos.length;
  blocos.push(...doc.blocos);

  const estiloDoTitulo = (nivel: 1 | 2 | 3) => (nivel === 1 ? est.titulo1 : nivel === 2 ? est.titulo2 : est.titulo3);
  const alturaUtil = H - margem.topo - margem.base;
  const alturaDaLinhaDeTabela = (b: Extract<BlocoPdf, { tipo: "tabela" }>, celulas: CelulaPdf[], negrito: boolean) =>
    Math.max(1, ...celulas.map((c, i) => quebrarLinhas(trechosDaCelula(c, negrito), est.tabela, f, limpar, b.colunas[i].largura * larguraUtil - PAD_TABELA_H * 2).length)) * est.tabela.tamanho * est.tabela.entrelinha + PAD_TABELA_V * 2;
  /** Cabeçalho e 1ª linha, que não se separam. A 1ª linha maior que a página vai partir: basta o começo dela. */
  const alturaDoInicioDaTabela = (b: Extract<BlocoPdf, { tipo: "tabela" }>) => {
    const cabecalho = alturaDaLinhaDeTabela(b, b.colunas.map((c) => c.titulo), true);
    const primeira = b.linhas[0] ?? b.total;
    if (!primeira) return Math.min(cabecalho, alturaUtil);
    const inteira = alturaDaLinhaDeTabela(b, primeira, !b.linhas[0] || Boolean(b.totais?.includes(0)));
    return cabecalho + inteira <= alturaUtil ? cabecalho + inteira : Math.min(cabecalho, alturaUtil / 2) + est.tabela.tamanho * est.tabela.entrelinha + PAD_TABELA_V * 2;
  };

  /** Altura real do começo do bloco `i`, para o título que vem antes não ficar órfão. Título seguido de título soma, até `TITULOS_JUNTOS`. */
  const alturaDoComeco = (i: number, titulos = 1): number => {
    const b = blocos[i];
    const linhaDeTexto = est.texto.tamanho * est.texto.entrelinha;
    switch (b?.tipo) {
      case undefined:
        return 0;
      case "titulo": {
        if (titulos >= TITULOS_JUNTOS) return 0;
        const e = estiloDoTitulo(b.nivel);
        const largura = larguraUtil - (e.recuo ?? 0);
        return e.antes + quebrarLinhas(b.trechos, e, f, limpar, largura).length * e.tamanho * e.entrelinha + e.depois + alturaDoComeco(i + 1, titulos + 1);
      }
      case "tabela":
        return est.tabela.antes + alturaDoInicioDaTabela(b);
      case "paragrafo":
      case "campos":
        return est.texto.antes + linhaDeTexto * 2;
      default:
        return linhaDeTexto * 2;
    }
  };

  blocos.forEach((b, i) => {
    const primeiro = i === 0;
    switch (b.tipo) {
      case "titulo":
        textoCorrido(b.trechos, estiloDoTitulo(b.nivel), margem.esquerda, larguraUtil, primeiro, false, alturaDoComeco(i + 1));
        break;
      case "paragrafo":
        textoCorrido(b.trechos, i < nAbertura ? est.rotulo : est.texto, margem.esquerda, larguraUtil, primeiro, b.semRecuo);
        break;
      case "item": {
        const recuo = est.recuoLista * (b.nivel + 1);
        const x = margem.esquerda + recuo;
        const linhas = quebrarLinhas(b.trechos.length ? b.trechos : [{ texto: "" }], est.texto, f, limpar, larguraUtil - recuo);
        y -= est.texto.antes / 2;
        const alturaLinha = est.texto.tamanho * est.texto.entrelinha;
        caber(alturaLinha);
        if (b.marcador) {
          const m = limpar(b.marcador);
          const lm = medir(f.regular, m, est.texto.tamanho);
          pagina.drawText(m, { x: x - lm - 5, y: y - alturaLinha + (alturaLinha - est.texto.tamanho) / 2, size: est.texto.tamanho, font: f.regular, color: cor(est.texto.cor) });
        }
        desenharLinhas(linhas.length ? linhas : [[]], est.texto, x);
        y -= est.texto.depois / 2;
        break;
      }
      case "linha":
        caber(est.texto.antes + est.texto.depois + 1);
        y -= est.texto.antes;
        pagina.drawLine({ start: { x: margem.esquerda, y }, end: { x: W - margem.direita, y }, thickness: 0.6, color: cor(est.corLinha) });
        y -= est.texto.depois;
        break;
      case "campos": {
        const rotuloLarg = Math.min(larguraUtil * 0.32, Math.max(...b.linhas.map((l) => medir(f.negrito, limpar(l.rotulo), est.texto.tamanho))) + 12);
        y -= est.texto.antes;
        for (const l of b.linhas) {
          const valor = quebrarLinhas([{ texto: l.valor }], est.texto, f, limpar, larguraUtil - rotuloLarg);
          const alturaLinha = est.texto.tamanho * est.texto.entrelinha;
          caber(alturaLinha);
          pagina.drawText(limpar(l.rotulo), { x: margem.esquerda, y: y - alturaLinha + (alturaLinha - est.texto.tamanho) / 2, size: est.texto.tamanho, font: f.negrito, color: cor(est.rotulo.cor) });
          desenharLinhas(valor.length ? valor : [[]], est.texto, margem.esquerda + rotuloLarg);
          y -= 2;
        }
        y -= est.texto.depois;
        break;
      }
      case "tabela":
        desenharTabela(b);
        break;
    }
  });

  function desenharTabela(b: Extract<BlocoPdf, { tipo: "tabela" }>) {
    const e = est.tabela;
    const c = est.tabelaCores;
    const alturaLinha = e.tamanho * e.entrelinha;
    const padV = PAD_TABELA_V;
    const padH = PAD_TABELA_H;
    const xs: number[] = [];
    let acc = margem.esquerda;
    for (const col of b.colunas) {
      xs.push(acc);
      acc += col.largura * larguraUtil;
    }
    const celulas = (cs: CelulaPdf[], negrito: boolean) => cs.map((cel, i) => quebrarLinhas(trechosDaCelula(cel, negrito), e, f, limpar, b.colunas[i].largura * larguraUtil - padH * 2));
    const alturaDe = (cs: Palavra[][][]) => Math.max(1, ...cs.map((l) => l.length)) * alturaLinha + padV * 2;
    /** Desenha onde está: quem chama já garantiu o espaço. */
    const faixa = (cs: Palavra[][][], fundo: Cor | null, tinta: Cor) => {
      const altura = alturaDe(cs);
      pagina.drawRectangle({ x: margem.esquerda, y: y - altura, width: larguraUtil, height: altura, color: fundo ? cor(fundo) : undefined, borderColor: cor(c.borda), borderWidth: 0.6 });
      for (const x of xs.slice(1)) pagina.drawLine({ start: { x, y }, end: { x, y: y - altura }, thickness: 0.6, color: cor(c.borda) });
      cs.forEach((linhas, i) => {
        const col = b.colunas[i];
        const largCol = col.largura * larguraUtil;
        let cy = y - padV;
        for (const l of linhas) {
          cy -= alturaLinha;
          const largTexto = larguraDaLinha(l);
          let cx = col.alinhar === "direita" ? xs[i] + largCol - padH - largTexto : col.alinhar === "centro" ? xs[i] + (largCol - largTexto) / 2 : xs[i] + padH;
          for (const g of agrupar(l)) {
            pagina.drawText(g.texto, { x: cx, y: cy + (alturaLinha - e.tamanho) / 2, size: e.tamanho, font: g.fonte, color: cor(tinta) });
            cx += g.largura;
          }
        }
      });
      y -= altura;
    };
    y -= e.antes;
    const cabecalho = celulas(b.colunas.map((col) => col.titulo), true);
    const repete = alturaDe(cabecalho) <= alturaUtil * CABECALHO_REPETIDO_MAX;
    const proximaPagina = () => {
      novaPagina();
      if (repete) faixa(cabecalho, c.cabecalho, c.textoCabecalho);
    };
    /**
     * Linha inteira, na página atual ou na próxima. Só a que não cabe numa página inteira parte,
     * pelas linhas de texto: é isso ou o fim dela sair fora da folha.
     */
    const linha = (cs: Palavra[][][], fundo: Cor | null, tinta: Cor) => {
      const altura = alturaDe(cs);
      if (altura <= alturaUtil - (repete ? alturaDe(cabecalho) : 0)) {
        if (y - altura < margem.base) proximaPagina();
        faixa(cs, fundo, tinta);
        return;
      }
      let resto = cs;
      while (resto.some((l) => l.length > 0)) {
        const cabem = Math.floor((y - margem.base - padV * 2) / alturaLinha);
        if (cabem < 1) {
          proximaPagina();
          continue;
        }
        faixa(resto.map((l) => l.slice(0, cabem)), fundo, tinta);
        resto = resto.map((l) => l.slice(cabem));
      }
    };
    // Cabeçalho nunca fica sozinho no pé da página.
    caber(alturaDoInicioDaTabela(b));
    if (repete) faixa(cabecalho, c.cabecalho, c.textoCabecalho);
    else linha(cabecalho, c.cabecalho, c.textoCabecalho);
    const totais = new Set(b.totais);
    b.linhas.forEach((l, i) => {
      const destaque = totais.has(i);
      linha(celulas(l, destaque), destaque ? c.total : null, e.cor);
    });
    if (b.total) linha(celulas(b.total, true), c.total, e.cor);
    y -= e.depois;
  }

  // Cabeçalho e rodapé por último: o total de páginas já é conhecido.
  const paginas = pdf.getPages();
  paginas.forEach((pg, i) => {
    const ctx: ContextoPagina = { pagina: i + 1, total: paginas.length, largura: W, altura: H, titulo: doc.titulo, marca: doc.marca };
    const pincel = pincelDe(pg, f, limpar, est.texto.cor, imagens);
    if (comCapa && i === 0) return template.capa!(pincel, ctx, doc.capa!);
    template.cabecalho?.(pincel, ctx);
    template.rodape?.(pincel, ctx);
  });

  return pdf.save();
}

function pincelDe(pg: PDFPage, f: Fontes, limpar: (t: string) => string, padrao: Cor, imagens: ReadonlyMap<string, PDFImage>): Pincel {
  const fonteDoTexto = (o: { negrito?: boolean; italico?: boolean; familia?: "capa" }) => (o.familia === "capa" && f.capa ? (o.negrito ? f.capa.negrito : f.capa.regular) : fonteDe(f, o.negrito, o.italico));
  const limparPara = (t: string, fonte: PDFFont) => (fonte === f.capa?.regular || fonte === f.capa?.negrito ? limparTexto(t, new Set(fonte.getCharacterSet())) : limpar(t));
  return {
    texto(t, x, y, o = {}) {
      const tamanho = o.tamanho ?? 9;
      const fonte = fonteDoTexto(o);
      const s = limparPara(t, fonte);
      const l = medir(fonte, s, tamanho);
      const x0 = o.alinhar === "direita" ? x - l : o.alinhar === "centro" ? x - l / 2 : x;
      pg.drawText(s, { x: x0, y, size: tamanho, font: fonte, color: cor(o.cor ?? padrao) });
    },
    linha(x1, y1, x2, y2, o = {}) {
      pg.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: o.espessura ?? 0.5, color: cor(o.cor ?? padrao) });
    },
    retangulo(x, y, largura, altura, c) {
      pg.drawRectangle({ x, y, width: largura, height: altura, color: cor(c) });
    },
    larguraDe(t, tamanho, negrito, familia) {
      const fonte = fonteDoTexto({ negrito, familia });
      return medir(fonte, limparPara(t, fonte), tamanho);
    },
    imagem(nome, x, y, largura, altura) {
      const img = imagens.get(nome);
      if (img) pg.drawImage(img, { x, y, width: largura, height: altura });
    },
  };
}

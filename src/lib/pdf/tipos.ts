/**
 * Documento de PDF do CRM (GAB-89; reaproveitado pelo contrato, GAB-92): o
 * CONTEÚDO, em blocos simples, separado do TEMPLATE (a cara: página, fontes,
 * cores, cabeçalho e rodapé). Quem gera (`./gerador.ts`) só junta os dois.
 *
 * Trocar o template = escrever outro `TemplatePdf` e apontar `templateAtual`
 * (./templates) para ele — o fluxo (proposta, contrato) e o gerador não mudam.
 */

/** Trecho de texto com a formatação que o editor da proposta permite. */
export type Trecho = { texto: string; negrito?: boolean; italico?: boolean };

/** Célula de tabela: texto simples ou trechos com negrito e itálico. */
export type CelulaPdf = string | Trecho[];

export type BlocoPdf =
  | { tipo: "titulo"; nivel: 1 | 2 | 3; trechos: Trecho[] }
  /** `semRecuo`: sem o recuo de primeira linha do template (linhas de dados). */
  | { tipo: "paragrafo"; trechos: Trecho[]; semRecuo?: boolean }
  /** Item de lista: `marcador` ("•", "1.") só no 1º parágrafo do item; `nivel` 0 = lista de fora. */
  | { tipo: "item"; marcador: string | null; nivel: number; trechos: Trecho[] }
  | { tipo: "linha" }
  /** Pares rótulo → valor (ex.: Valor total, Prazo). */
  | { tipo: "campos"; linhas: { rotulo: string; valor: string }[] }
  /**
   * Tabela: `largura` em frações (somam 1); cabeçalho repetido se a tabela quebra de página, sem partir
   * linha (só a que não cabe numa página inteira). `total` = última linha em destaque; `totais` = índices
   * de `linhas` em destaque, marcados por quem escreve.
   */
  | { tipo: "tabela"; colunas: { titulo: CelulaPdf; largura: number; alinhar?: "esquerda" | "centro" | "direita" }[]; linhas: CelulaPdf[][]; total?: CelulaPdf[]; totais?: number[] };

/** Capa: página inteira do template, antes do conteúdo. */
export type CapaPdf = { titulo: string; empresa: string; data: string; endereco: string };

export type DocumentoPdf = {
  /** Título do documento (cabeçalho e metadados do PDF). */
  titulo: string;
  /** Linhas abaixo do título (cliente, versão, data…). */
  subtitulo?: string[];
  capa?: CapaPdf;
  /** Aviso visível em toda página (prévia que não é a versão final). */
  marca?: string;
  blocos: BlocoPdf[];
  /** Metadados do arquivo. */
  autor?: string;
  assunto?: string;
};

export type Cor = { r: number; g: number; b: number };

export type EstiloTexto = {
  tamanho: number;
  entrelinha: number;
  antes: number;
  depois: number;
  cor: Cor;
  negrito?: boolean;
  alinhar?: "esquerda" | "centro" | "justificado";
  /** Recuo só da primeira linha. */
  recuoPrimeira?: number;
  /** Recuo de todas as linhas. */
  recuo?: number;
};

/** Bytes de uma fonte TrueType (embutida com subconjunto: acentos e qualquer Unicode que ela tenha). */
export type FontesTemplate = { regular: Uint8Array; negrito: Uint8Array; italico: Uint8Array; negritoItalico: Uint8Array; capa?: { regular: Uint8Array; negrito: Uint8Array } };

/** PNG por nome; o template desenha com `pincel.imagem`. */
export type ImagensTemplate = Record<string, Uint8Array>;

/**
 * A cara do documento. O cabeçalho/rodapé recebem um "pincel" mínimo (texto
 * e linha), não o pdf-lib: um template novo não depende da biblioteca.
 */
export type TemplatePdf = {
  nome: string;
  /** Pontos (1/72 pol.). A4 = 595.28 × 841.89. */
  pagina: { largura: number; altura: number; margem: { topo: number; base: number; esquerda: number; direita: number } };
  fontes: () => Promise<FontesTemplate>;
  imagens?: () => Promise<ImagensTemplate>;
  estilos: {
    texto: EstiloTexto;
    titulo1: EstiloTexto;
    titulo2: EstiloTexto;
    titulo3: EstiloTexto;
    /** Subtítulo da abertura e rótulos dos campos. */
    rotulo: EstiloTexto;
    tabela: EstiloTexto;
    tabelaCores: { cabecalho: Cor; textoCabecalho: Cor; borda: Cor; total: Cor };
    /** Recuo por nível de lista. */
    recuoLista: number;
    corLinha: Cor;
  };
  /** Primeira página, sem cabeçalho nem rodapé, quando o documento tem `capa`. */
  capa?: (p: Pincel, ctx: ContextoPagina, capa: CapaPdf) => void;
  /** Desenhado em toda página, por cima do conteúdo (depois de saber o total de páginas). */
  cabecalho?: (p: Pincel, ctx: ContextoPagina) => void;
  rodape?: (p: Pincel, ctx: ContextoPagina) => void;
};

export type ContextoPagina = { pagina: number; total: number; largura: number; altura: number; titulo: string; marca?: string };

export type Pincel = {
  /** Texto numa linha (sem quebra), `x` à esquerda ou alinhado à direita/centro de `x`. */
  texto: (t: string, x: number, y: number, o?: { tamanho?: number; negrito?: boolean; italico?: boolean; cor?: Cor; alinhar?: "esquerda" | "direita" | "centro"; familia?: "capa" }) => void;
  linha: (x1: number, y1: number, x2: number, y2: number, o?: { cor?: Cor; espessura?: number }) => void;
  retangulo: (x: number, y: number, largura: number, altura: number, cor: Cor) => void;
  larguraDe: (t: string, tamanho: number, negrito?: boolean, familia?: "capa") => number;
  /** Imagem de `template.imagens`, com o canto inferior esquerdo em (x, y). */
  imagem: (nome: string, x: number, y: number, largura: number, altura: number) => void;
};

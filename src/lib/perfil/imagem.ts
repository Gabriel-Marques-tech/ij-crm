/**
 * Validação da foto de perfil no servidor (GAB-43). Sem `sharp`/libvips: o
 * navegador já recorta e redimensiona (canvas → WebP 256×256, JPEG se não
 * houver encoder WebP); aqui só se confere o que chegou, pelos BYTES:
 *
 * - tamanho ≤ 150 KB (antes de qualquer parse);
 * - tipo pelo magic number (nome/`File.type` do cliente são ignorados);
 * - estrutura inteira percorrida: o container termina exatamente onde diz
 *   (nada colado depois — corta poliglotas WebP+HTML/ZIP);
 * - dimensões lidas do cabeçalho do bitstream (VP8/VP8L/VP8X; SOFn no JPEG)
 *   e iguais a 256×256.
 *
 * Não decodifica pixels: um bitstream malformado depois do cabeçalho só
 * vira uma imagem quebrada no `<img>` (servida com o mime validado + nosniff),
 * e o cliente cai para as iniciais.
 */

export const FOTO_LADO = 256;
export const FOTO_MAX_BYTES = 150 * 1024;
export const FOTO_MIMES = ["image/webp", "image/jpeg"] as const;
export type MimeFoto = (typeof FOTO_MIMES)[number];

export type ErroFoto = "VAZIA" | "GRANDE_DEMAIS" | "TIPO_INVALIDO" | "DIMENSOES_INVALIDAS" | "CORROMPIDA";
export type ResultadoFoto = { ok: true; mime: MimeFoto; largura: number; altura: number } | { ok: false; erro: ErroFoto };

export const MENSAGEM_ERRO_FOTO: Record<ErroFoto, string> = {
  VAZIA: "Nenhuma imagem recebida.",
  GRANDE_DEMAIS: "A imagem processada passou de 150 KB. Tente outra foto.",
  TIPO_INVALIDO: "Arquivo não é uma imagem WebP/JPEG válida.",
  DIMENSOES_INVALIDAS: "A imagem precisa ter 256×256 pixels (use o recorte da página).",
  CORROMPIDA: "Imagem corrompida ou com conteúdo extra. Tente outra foto.",
};

class Corrompida extends Error {}

function u16le(b: Uint8Array, i: number): number {
  return b[i] | (b[i + 1] << 8);
}
function u16be(b: Uint8Array, i: number): number {
  return (b[i] << 8) | b[i + 1];
}
function u24le(b: Uint8Array, i: number): number {
  return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
}
function u32le(b: Uint8Array, i: number): number {
  return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
}
function fourcc(b: Uint8Array, i: number): string {
  return String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
}
function exigir(cond: boolean): void {
  if (!cond) throw new Corrompida();
}

function ehWebp(b: Uint8Array): boolean {
  return b.length >= 12 && fourcc(b, 0) === "RIFF" && fourcc(b, 8) === "WEBP";
}
function ehJpeg(b: Uint8Array): boolean {
  return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

type Dim = { largura: number; altura: number };

/** Dimensões de um chunk VP8 (com perdas). */
function dimVp8(b: Uint8Array, d: number, tam: number): Dim {
  exigir(tam >= 10);
  exigir((b[d] & 1) === 0); // keyframe
  exigir(b[d + 3] === 0x9d && b[d + 4] === 0x01 && b[d + 5] === 0x2a);
  return { largura: u16le(b, d + 6) & 0x3fff, altura: u16le(b, d + 8) & 0x3fff };
}

/** Dimensões de um chunk VP8L (sem perdas): 0x2f + 14 bits de cada lado (menos 1). */
function dimVp8l(b: Uint8Array, d: number, tam: number): Dim {
  exigir(tam >= 5);
  exigir(b[d] === 0x2f);
  const bits = u32le(b, d + 1);
  exigir(bits >>> 29 === 0); // versão 0
  return { largura: (bits & 0x3fff) + 1, altura: ((bits >>> 14) & 0x3fff) + 1 };
}

function dimWebp(b: Uint8Array): Dim {
  exigir(b.length >= 20);
  // O RIFF tem de terminar exatamente no fim do arquivo.
  exigir(u32le(b, 4) + 8 === b.length);
  let canvas: Dim | null = null;
  let imagem: Dim | null = null;
  let i = 12;
  let primeiro = true;
  while (i < b.length) {
    exigir(i + 8 <= b.length);
    const tipo = fourcc(b, i);
    const tam = u32le(b, i + 4);
    const d = i + 8;
    const fim = d + tam + (tam % 2);
    exigir(fim <= b.length);
    if (tipo === "VP8X") {
      exigir(primeiro && tam >= 10);
      exigir((b[d] & 0x02) === 0); // animação: não é avatar
      canvas = { largura: u24le(b, d + 4) + 1, altura: u24le(b, d + 7) + 1 };
    } else if (tipo === "VP8 " || tipo === "VP8L") {
      exigir(imagem === null);
      imagem = tipo === "VP8 " ? dimVp8(b, d, tam) : dimVp8l(b, d, tam);
    } else {
      // ALPH/ICCP/EXIF/XMP só existem no formato estendido.
      exigir(canvas !== null);
    }
    primeiro = false;
    i = fim;
  }
  exigir(i === b.length && imagem !== null);
  if (canvas && (canvas.largura !== imagem!.largura || canvas.altura !== imagem!.altura)) {
    return { largura: 0, altura: 0 };
  }
  return imagem!;
}

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function dimJpeg(b: Uint8Array): Dim {
  exigir(b.length >= 4 && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9);
  let i = 2;
  let dim: Dim | null = null;
  for (;;) {
    exigir(i + 4 <= b.length && b[i] === 0xff);
    let marcador = b[i + 1];
    while (marcador === 0xff) {
      i++;
      exigir(i + 4 <= b.length);
      marcador = b[i + 1];
    }
    exigir(marcador !== 0xd9 && marcador !== 0x00 && !(marcador >= 0xd0 && marcador <= 0xd7));
    const tam = u16be(b, i + 2);
    exigir(tam >= 2 && i + 2 + tam <= b.length);
    if (SOF.has(marcador)) {
      exigir(tam >= 7 && dim === null);
      dim = { altura: u16be(b, i + 5), largura: u16be(b, i + 7) };
    }
    if (marcador === 0xda) break; // SOS: daqui em diante é entropia até o EOI final
    i += 2 + tam;
  }
  exigir(dim !== null);
  return dim!;
}

export function validarFoto(bytes: Uint8Array): ResultadoFoto {
  if (bytes.length === 0) return { ok: false, erro: "VAZIA" };
  if (bytes.length > FOTO_MAX_BYTES) return { ok: false, erro: "GRANDE_DEMAIS" };
  const mime: MimeFoto | null = ehWebp(bytes) ? "image/webp" : ehJpeg(bytes) ? "image/jpeg" : null;
  if (!mime) return { ok: false, erro: "TIPO_INVALIDO" };
  let dim: Dim;
  try {
    dim = mime === "image/webp" ? dimWebp(bytes) : dimJpeg(bytes);
  } catch (e) {
    if (e instanceof Corrompida || e instanceof RangeError) return { ok: false, erro: "CORROMPIDA" };
    throw e;
  }
  if (dim.largura !== FOTO_LADO || dim.altura !== FOTO_LADO) return { ok: false, erro: "DIMENSOES_INVALIDAS" };
  return { ok: true, mime, largura: dim.largura, altura: dim.altura };
}

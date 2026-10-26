import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FOTO_LADO, FOTO_MAX_BYTES, limparMetadados, validarFoto } from "./imagem";

// ---------------------------------------------------------------- construtores de bytes

function u32le(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}
function ascii(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}
function chunk(fourcc: string, dados: number[]): number[] {
  const pad = dados.length % 2 ? [0] : [];
  return [...ascii(fourcc), ...u32le(dados.length), ...dados, ...pad];
}
function riff(chunks: number[][], extra: number[] = []): Uint8Array {
  const corpo = [...ascii("WEBP"), ...chunks.flat()];
  return new Uint8Array([...ascii("RIFF"), ...u32le(corpo.length), ...corpo, ...extra]);
}

/** VP8L (sem perdas): assinatura 0x2f + 14 bits (largura-1) + 14 bits (altura-1). */
function vp8l(largura: number, altura: number, resto = 40): number[] {
  const w = largura - 1;
  const h = altura - 1;
  const bits = w | (h << 14);
  return chunk("VP8L", [0x2f, bits & 0xff, (bits >>> 8) & 0xff, (bits >>> 16) & 0xff, (bits >>> 24) & 0x0f, ...new Array(resto).fill(0)]);
}

/** VP8 (com perdas, keyframe): frame tag + start code 9d 01 2a + 16 bits de cada lado. */
function vp8(largura: number, altura: number): number[] {
  return chunk("VP8 ", [0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a, largura & 0xff, (largura >> 8) & 0x3f, altura & 0xff, (altura >> 8) & 0x3f, ...new Array(30).fill(0)]);
}

function vp8x(largura: number, altura: number, flags = 0): number[] {
  const w = largura - 1;
  const h = altura - 1;
  return chunk("VP8X", [flags, 0, 0, 0, w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff]);
}

function jpeg(largura: number, altura: number, { fim = true } = {}): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 8, altura >> 8, altura & 0xff, largura >> 8, largura & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const sos = [0xff, 0xda, 0x00, 0x0c, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0, ...new Array(50).fill(0x55)];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof0, ...sos, ...(fim ? [0xff, 0xd9] : [])]);
}

// PNG 256×256 (só a assinatura + IHDR já basta para ser "um PNG").
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, ...ascii("IHDR"), 0, 0, 1, 0, 0, 0, 1, 0, 8, 6, 0, 0, 0, 0, 0, 0, 0]);

describe("validarFoto — aceita", () => {
  it("WebP sem perdas (VP8L) 256×256", () => {
    expect(validarFoto(riff([vp8l(256, 256)]))).toEqual({ ok: true, mime: "image/webp", largura: 256, altura: 256 });
  });

  it("WebP com perdas (VP8) 256×256", () => {
    expect(validarFoto(riff([vp8(256, 256)]))).toMatchObject({ ok: true, mime: "image/webp" });
  });

  it("WebP estendido (VP8X + VP8) 256×256, sem animação", () => {
    expect(validarFoto(riff([vp8x(256, 256), vp8(256, 256)]))).toMatchObject({ ok: true, mime: "image/webp" });
  });

  it("JPEG 256×256 (fallback de navegador sem encoder WebP)", () => {
    expect(validarFoto(jpeg(256, 256))).toEqual({ ok: true, mime: "image/jpeg", largura: 256, altura: 256 });
  });
});

describe("validarFoto — arquivos reais (gerados com libwebp/libjpeg, src/test/fixtures/fotos)", () => {
  const ler = (nome: string) => new Uint8Array(readFileSync(path.join(import.meta.dirname, "../../test/fixtures/fotos", nome)));

  it.each(["real-256.webp", "real-256-lossless.webp", "real-256-alpha.webp"])("aceita %s", (nome) => {
    expect(validarFoto(ler(nome))).toEqual({ ok: true, mime: "image/webp", largura: 256, altura: 256 });
  });

  it("aceita JPEG real 256×256", () => {
    expect(validarFoto(ler("real-256.jpg"))).toEqual({ ok: true, mime: "image/jpeg", largura: 256, altura: 256 });
  });

  it("recusa PNG renomeado para .webp e WebP 300×300", () => {
    expect(validarFoto(ler("png-renomeado.webp"))).toEqual({ ok: false, erro: "TIPO_INVALIDO" });
    expect(validarFoto(ler("real-300.webp"))).toEqual({ ok: false, erro: "DIMENSOES_INVALIDAS" });
  });
});

describe("validarFoto — recusa", () => {
  it("vazio", () => {
    expect(validarFoto(new Uint8Array())).toEqual({ ok: false, erro: "VAZIA" });
  });

  it(`maior que ${FOTO_MAX_BYTES} bytes (antes de olhar o conteúdo)`, () => {
    const grande = riff([vp8l(256, 256, FOTO_MAX_BYTES)]);
    expect(validarFoto(grande)).toEqual({ ok: false, erro: "GRANDE_DEMAIS" });
  });

  it("PNG renomeado para .webp (o tipo vem dos bytes, não do nome)", () => {
    expect(validarFoto(PNG)).toEqual({ ok: false, erro: "TIPO_INVALIDO" });
  });

  it("bytes aleatórios / texto", () => {
    expect(validarFoto(new TextEncoder().encode("<script>alert(1)</script>".repeat(4)))).toEqual({ ok: false, erro: "TIPO_INVALIDO" });
    expect(validarFoto(new Uint8Array(500).map((_, i) => (i * 37) % 256))).toEqual({ ok: false, erro: "TIPO_INVALIDO" });
  });

  it.each([
    [512, 512],
    [256, 255],
    [1, 1],
  ])("dimensões erradas (%i×%i)", (w, h) => {
    expect(validarFoto(riff([vp8l(w, h)]))).toEqual({ ok: false, erro: "DIMENSOES_INVALIDAS" });
    expect(validarFoto(riff([vp8(w, h)]))).toEqual({ ok: false, erro: "DIMENSOES_INVALIDAS" });
    expect(validarFoto(jpeg(w, h))).toEqual({ ok: false, erro: "DIMENSOES_INVALIDAS" });
  });

  it("VP8X dizendo 256 mas imagem de outro tamanho", () => {
    expect(validarFoto(riff([vp8x(256, 256), vp8(300, 300)]))).toEqual({ ok: false, erro: "DIMENSOES_INVALIDAS" });
  });

  it("WebP animado", () => {
    expect(validarFoto(riff([vp8x(256, 256, 0x02), vp8(256, 256)]))).toEqual({ ok: false, erro: "CORROMPIDA" });
  });

  it("poliglota: WebP válido com bytes extras depois do RIFF (ex.: HTML/ZIP colado)", () => {
    const extra = [...new TextEncoder().encode("<html><script>alert(1)</script></html>")];
    expect(validarFoto(riff([vp8l(256, 256)], extra))).toEqual({ ok: false, erro: "CORROMPIDA" });
  });

  it("tamanho do RIFF mentindo / chunk que estoura o arquivo", () => {
    const b = riff([vp8l(256, 256)]);
    const mentindo = b.slice();
    mentindo[4] = 0xff;
    expect(validarFoto(mentindo)).toEqual({ ok: false, erro: "CORROMPIDA" });
    const truncado = b.slice(0, b.length - 10);
    truncado.set(u32le(truncado.length - 8), 4);
    expect(validarFoto(truncado)).toEqual({ ok: false, erro: "CORROMPIDA" });
  });

  it("WebP sem chunk de imagem (só VP8X)", () => {
    expect(validarFoto(riff([vp8x(256, 256)]))).toEqual({ ok: false, erro: "CORROMPIDA" });
  });

  it("JPEG sem fim (EOI) ou com lixo depois", () => {
    expect(validarFoto(jpeg(256, 256, { fim: false }))).toEqual({ ok: false, erro: "CORROMPIDA" });
    const j = jpeg(256, 256);
    expect(validarFoto(new Uint8Array([...j, ...ascii("PK\u0003\u0004lixo")]))).toEqual({ ok: false, erro: "CORROMPIDA" });
  });

  it("lado esperado é 256", () => {
    expect(FOTO_LADO).toBe(256);
  });
});

describe("limparMetadados — tira bytes arbitrários (COM/APPn, EXIF/XMP/ICCP)", () => {
  const PAYLOAD = "<script>alert(1)</script>";
  const contem = (b: Uint8Array, s: string) => Buffer.from(b).includes(Buffer.from(s));
  const ler = (nome: string) => new Uint8Array(readFileSync(path.join(import.meta.dirname, "../../test/fixtures/fotos", nome)));

  /** Insere segmentos logo depois do SOI. */
  function jpegCom(segmentos: number[][]): Uint8Array {
    const j = jpeg(256, 256);
    return new Uint8Array([0xff, 0xd8, ...segmentos.flat(), ...j.slice(2)]);
  }
  function seg(marcador: number, dados: number[]): number[] {
    const tam = dados.length + 2;
    return [0xff, marcador, tam >> 8, tam & 0xff, ...dados];
  }

  it("JPEG com <script> num COM passa na validação, mas o payload não sobrevive à limpeza", () => {
    const sujo = jpegCom([seg(0xfe, ascii(PAYLOAD)), seg(0xe1, [...ascii("Exif\0\0"), ...ascii(PAYLOAD)])]);
    expect(validarFoto(sujo)).toMatchObject({ ok: true, mime: "image/jpeg" });
    const limpo = limparMetadados(sujo, "image/jpeg");
    expect(contem(limpo, PAYLOAD)).toBe(false);
    expect(contem(limpo, "JFIF")).toBe(false); // APP0 também sai
    expect(validarFoto(limpo)).toEqual({ ok: true, mime: "image/jpeg", largura: 256, altura: 256 });
    // SOF, SOS e entropia ficam intactos.
    const j = jpeg(256, 256);
    const semApp0 = new Uint8Array([0xff, 0xd8, ...j.slice(2 + 18)]);
    expect(Buffer.from(limpo).equals(Buffer.from(semApp0))).toBe(true);
  });

  it("WebP com EXIF/XMP/ICCP: chunks removidos, flags do VP8X zeradas, ALPH mantido", () => {
    const alph = chunk("ALPH", [0, 1, 2, 3]);
    const sujo = riff([
      vp8x(256, 256, 0x20 | 0x10 | 0x08 | 0x04),
      chunk("ICCP", ascii(PAYLOAD)),
      alph,
      vp8(256, 256),
      chunk("EXIF", ascii(PAYLOAD)),
      chunk("XMP ", ascii(PAYLOAD)),
      chunk("ABCD", ascii(PAYLOAD)),
    ]);
    expect(validarFoto(sujo)).toMatchObject({ ok: true });
    const limpo = limparMetadados(sujo, "image/webp");
    expect(contem(limpo, PAYLOAD)).toBe(false);
    expect(validarFoto(limpo)).toEqual({ ok: true, mime: "image/webp", largura: 256, altura: 256 });
    expect(Buffer.from(limpo).equals(Buffer.from(riff([vp8x(256, 256, 0x10), alph, vp8(256, 256)])))).toBe(true);
  });

  it("WebP simples e arquivos reais continuam válidos (e idempotente)", () => {
    const simples = riff([vp8l(256, 256)]);
    expect(Buffer.from(limparMetadados(simples, "image/webp")).equals(Buffer.from(simples))).toBe(true);
    for (const [nome, mime] of [
      ["real-256.webp", "image/webp"],
      ["real-256-alpha.webp", "image/webp"],
      ["real-256-lossless.webp", "image/webp"],
      ["real-256.jpg", "image/jpeg"],
    ] as const) {
      const uma = limparMetadados(ler(nome), mime);
      expect(validarFoto(uma), nome).toMatchObject({ ok: true, mime });
      expect(Buffer.from(limparMetadados(uma, mime)).equals(Buffer.from(uma)), nome).toBe(true);
    }
  });
});

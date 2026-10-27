import { describe, expect, it } from "vitest";
import { situacaoSafeMode } from "./safe-mode";

describe("situacaoSafeMode", () => {
  it("produção sem enviar → aviso de bot silencioso", () => {
    expect(situacaoSafeMode({ producao: true, enviando: false })).toMatchObject({
      ambiente: "produção",
      aviso: true,
      texto: expect.stringMatching(/bot silencioso em produção: confirmações e alertas não estão sendo enviados/),
    });
  });
  it("produção enviando → neutro", () => {
    expect(situacaoSafeMode({ producao: true, enviando: true })).toMatchObject({ ambiente: "produção", aviso: false });
  });
  it("fora de produção enviando → aviso", () => {
    expect(situacaoSafeMode({ producao: false, enviando: true })).toMatchObject({ ambiente: "desenvolvimento", aviso: true, texto: expect.stringMatching(/mensagens reais/) });
  });
  it("fora de produção sem enviar → neutro", () => {
    expect(situacaoSafeMode({ producao: false, enviando: false })).toMatchObject({ aviso: false });
  });
});

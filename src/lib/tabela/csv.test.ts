import { describe, expect, it } from "vitest";
import { BOM, celulaData, celulaDataHora, celulaNumero, celulaTexto, linhaCsv } from "./csv";

describe("celulaTexto", () => {
  it("texto simples passa direto; vazio/null viram célula vazia", () => {
    expect(celulaTexto("Padaria do Zé")).toBe("Padaria do Zé");
    expect(celulaTexto(null)).toBe("");
    expect(celulaTexto(undefined)).toBe("");
  });

  it("aspas, separador e quebras de linha → entre aspas, aspas dobradas", () => {
    expect(celulaTexto('diz "oi"')).toBe('"diz ""oi"""');
    expect(celulaTexto("a;b")).toBe('"a;b"');
    expect(celulaTexto("linha1\nlinha2")).toBe('"linha1\nlinha2"');
    expect(celulaTexto("a\r\nb")).toBe('"a\r\nb"');
  });

  it("anti formula injection: = + - @ tab CR no início ganham apóstrofo", () => {
    expect(celulaTexto("=HYPERLINK(\"http://x\")")).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(celulaTexto("+5511999")).toBe("'+5511999");
    expect(celulaTexto("-2")).toBe("'-2");
    expect(celulaTexto("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(celulaTexto("\tcmd")).toBe("'\tcmd");
    expect(celulaTexto("\r=1")).toBe("\"'\r=1\"");
    expect(celulaTexto("a=b")).toBe("a=b");
    expect(celulaTexto(" a")).toBe(" a");
  });

  it("anti formula injection também com espaço/tab antes do sinal", () => {
    expect(celulaTexto(' =HYPERLINK("x")')).toBe(`"' =HYPERLINK(""x"")"`);
    expect(celulaTexto("\t=1")).toBe("'\t=1");
    expect(celulaTexto("   -2")).toBe("'   -2");
    expect(celulaTexto("\n@x")).toBe(`"'\n@x"`);
  });
});

describe("números e datas pt-BR", () => {
  it("vírgula decimal, sem separador de milhar, 2 casas", () => {
    expect(celulaNumero({ toFixed: (n: number) => (12500.5).toFixed(n) })).toBe("12500,50");
    expect(celulaNumero("1234.5")).toBe("1234,50");
    expect(celulaNumero(7)).toBe("7");
    expect(celulaNumero(null)).toBe("");
  });

  it("datas no fuso de negócio (SP), dd/mm/aaaa", () => {
    // 02:30 UTC do dia 25 = 23:30 do dia 24 em SP.
    const d = new Date("2026-10-25T02:30:00Z");
    expect(celulaData(d)).toBe("24/10/2026");
    expect(celulaDataHora(d)).toBe("24/10/2026 23:30");
    expect(celulaData(null)).toBe("");
  });
});

describe("linhaCsv", () => {
  it("separa por ; e termina em CRLF", () => {
    expect(linhaCsv(["a", "", "c"])).toBe("a;;c\r\n");
  });
  it("BOM UTF-8", () => {
    expect(BOM).toBe("﻿");
  });
});

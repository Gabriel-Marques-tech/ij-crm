import { describe, expect, it } from "vitest";
import { decodificarArquivo, lerCsv } from "./csv";

describe("lerCsv", () => {
  it("lê CSV com vírgula, aspas e aspas escapadas", () => {
    const r = lerCsv('a,b,c\n1,"dois, com vírgula","diz ""oi"""\n');
    expect(r).toEqual({
      ok: true,
      separador: ",",
      registros: [
        { linha: 1, campos: ["a", "b", "c"] },
        { linha: 2, campos: ["1", "dois, com vírgula", 'diz "oi"'] },
      ],
    });
  });

  it("detecta ponto e vírgula pelo cabeçalho e tira o BOM", () => {
    const r = lerCsv("﻿ID;Título;Fase atual\r\n10;Site, novo;Perdido\r\n");
    expect(r.ok && r.separador).toBe(";");
    expect(r.ok && r.registros).toEqual([
      { linha: 1, campos: ["ID", "Título", "Fase atual"] },
      { linha: 2, campos: ["10", "Site, novo", "Perdido"] },
    ]);
  });

  it("aceita campo com quebra de linha dentro de aspas e numera pela linha física de início", () => {
    const r = lerCsv('id;dor\n1;"linha 1\nlinha 2\r\nlinha 3"\n2;curta\n');
    expect(r.ok && r.registros).toEqual([
      { linha: 1, campos: ["id", "dor"] },
      { linha: 2, campos: ["1", "linha 1\nlinha 2\nlinha 3"] },
      { linha: 5, campos: ["2", "curta"] },
    ]);
  });

  it("pula linhas vazias e aceita último registro sem quebra de linha", () => {
    const r = lerCsv("a,b\n\n1,2\n\n3,");
    expect(r.ok && r.registros.map((x) => x.campos)).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", ""],
    ]);
  });

  it("detecta tab", () => {
    const r = lerCsv("a\tb\n1\t2");
    expect(r.ok && r.separador).toBe("\t");
  });

  it("aspas sem fechamento → erro com a linha", () => {
    const r = lerCsv('a,b\n1,"aberta\n2,3\n');
    expect(r).toEqual({ ok: false, erro: "Aspas sem fechamento a partir da linha 2. Confira se o arquivo é um CSV exportado do Pipefy." });
  });

  it("arquivo vazio → erro", () => {
    expect(lerCsv("﻿ \n\n")).toEqual({ ok: false, erro: "O arquivo está vazio." });
  });

  it("limite de registros", () => {
    const texto = ["id", ...Array.from({ length: 6 }, (_, i) => String(i))].join("\n");
    expect(lerCsv(texto, { maxRegistros: 5 })).toEqual({ ok: false, erro: "O arquivo tem mais de 5 linhas de dados. Divida o export em partes menores." });
    expect(lerCsv(texto, { maxRegistros: 6 }).ok).toBe(true);
  });
});

describe("decodificarArquivo", () => {
  it("UTF-8 passa direto", () => {
    expect(decodificarArquivo(new TextEncoder().encode("Reunião"))).toBe("Reunião");
  });

  it("Windows-1252 (CSV salvo pelo Excel) vira texto certo", () => {
    // "Reunião" em cp1252: ã = 0xE3
    const bytes = new Uint8Array([0x52, 0x65, 0x75, 0x6e, 0x69, 0xe3, 0x6f]);
    expect(decodificarArquivo(bytes)).toBe("Reunião");
  });
});

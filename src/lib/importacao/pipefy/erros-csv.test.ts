import { describe, expect, it } from "vitest";
import { ocorrenciasParaCsv } from "./erros-csv";
import { lerCsv } from "./csv";

describe("ocorrenciasParaCsv", () => {
  it("gera CSV que o próprio leitor relê, com aspas e fórmula neutralizada", () => {
    const csv = ocorrenciasParaCsv([
      { linha: 3, pipefyId: "1", tipo: "erro", mensagem: 'Fase "X"; sem mapa' },
      { linha: 4, pipefyId: null, tipo: "aviso", mensagem: "=HYPERLINK(1)" },
    ]);
    expect(csv.startsWith("﻿linha;id_pipefy;tipo;mensagem\r\n")).toBe(true);
    const r = lerCsv(csv);
    expect(r.ok && r.registros.map((x) => x.campos)).toEqual([
      ["linha", "id_pipefy", "tipo", "mensagem"],
      ["3", "1", "erro", 'Fase "X"; sem mapa'],
      ["4", "", "aviso", "'=HYPERLINK(1)"],
    ]);
  });
});

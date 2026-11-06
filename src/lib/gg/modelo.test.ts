import { describe, expect, it } from "vitest";
import { contaDifere, derivarDoOrganograma, descendentes, progresso, semestreDe, temCiclo, validarImportacao, vigente } from "./modelo";

describe("vigente [início, fim)", () => {
  it("o dia do fim já não conta; início vazio não limita; invalidada nunca vale", () => {
    expect(vigente({ inicio: "2026-01-01", fim: "2026-11-05" }, "2026-11-04")).toBe(true);
    expect(vigente({ inicio: "2026-01-01", fim: "2026-11-05" }, "2026-11-05")).toBe(false);
    expect(vigente({ inicio: null, fim: null }, "2020-01-01")).toBe(true);
    expect(vigente({ inicio: "2026-12-01", fim: null }, "2026-11-05")).toBe(false);
    expect(vigente({ inicio: null, fim: null, invalidadoEm: new Date() }, "2026-11-05")).toBe(false);
  });
});

describe("estrutura", () => {
  it("descendentes inclui frentes em qualquer profundidade; temCiclo pega volta", () => {
    const areas = [
      { id: "gg", superiorId: null },
      { id: "rh", superiorId: "gg" },
      { id: "sub", superiorId: "rh" },
      { id: "proj", superiorId: null },
    ];
    expect([...descendentes(areas, "gg")].sort()).toEqual(["gg", "rh", "sub"]);
    const itens = areas.map((a) => ({ id: a.id, superior: a.superiorId }));
    expect(temCiclo(itens, "gg", "sub")).toBe(true);
    expect(temCiclo(itens, "proj", "sub")).toBe(false);
  });
});

describe("validarImportacao", () => {
  const hoje = "2026-11-05";
  it("normaliza e aceita campos vazios sem inventar dados", () => {
    expect(validarImportacao([{ nome: " Ana ", status: "ativo" }], hoje)).toEqual([{ nome: "Ana", email: null, status: "ATIVO", area: null, cargo: null, entrada: null }]);
  });
  it("recusa lista vazia, e-mail ruim, data futura e repetido", () => {
    expect(() => validarImportacao([], hoje)).toThrow(/1 a 500/);
    expect(() => validarImportacao([{ nome: "A", email: "x" }], hoje)).toThrow(/Linha 1: e-mail/);
    expect(() => validarImportacao([{ nome: "A", entrada: "2027-01-01" }], hoje)).toThrow(/data de entrada/);
    expect(() => validarImportacao([{ nome: "A", email: "a@ij.test" }, { nome: "B", email: "A@ij.test" }], hoje)).toThrow(/Linha 2: membro repetido/);
    expect(() => validarImportacao([{ nome: "A", status: "chefe" }], hoje)).toThrow(/status/);
  });
});

describe("derivarDoOrganograma (ponte com o CRM)", () => {
  const posto = (ladoCrm: "PROJETOS" | "VENDAS" | null, categoria: "DIRETORIA" | "LIDERANCA" | "MEMBRO", ehGp = false, principal = true) => ({ ladoCrm, categoria, ehGp, principal });
  it("diretoria vira GESTOR; PM vira GP de Projetos; membro de Vendas vira VENDEDOR", () => {
    expect(derivarDoOrganograma([posto("PROJETOS", "DIRETORIA")])).toEqual({ area: "PROJETOS", papel: "GESTOR", gp: false, conflito: null });
    expect(derivarDoOrganograma([posto("PROJETOS", "LIDERANCA", true)])).toEqual({ area: "PROJETOS", papel: "PROJETOS", gp: true, conflito: null });
    expect(derivarDoOrganograma([posto("VENDAS", "MEMBRO")])).toMatchObject({ area: "VENDAS", papel: "VENDEDOR" });
  });
  it("área sem lado (G&G, Marketing) vira VISUALIZADOR; sem posição, nada", () => {
    expect(derivarDoOrganograma([posto(null, "MEMBRO")])).toMatchObject({ area: null, papel: "VISUALIZADOR" });
    expect(derivarDoOrganograma([])).toEqual({ area: null, papel: null, gp: false, conflito: null });
  });
  it("duas áreas: vale a principal; sem principal entre elas, conflito", () => {
    expect(derivarDoOrganograma([posto("PROJETOS", "LIDERANCA", false, false), posto("VENDAS", "MEMBRO", false, true)])).toMatchObject({ area: "VENDAS", conflito: null });
    expect(derivarDoOrganograma([posto("PROJETOS", "LIDERANCA", false, false), posto("VENDAS", "MEMBRO", false, false)])).toMatchObject({ area: null, conflito: ["PROJETOS", "VENDAS"] });
  });
  it("contaDifere ignora admin e conflito", () => {
    const d = derivarDoOrganograma([posto("PROJETOS", "LIDERANCA", true)]);
    expect(contaDifere({ papel: "PROJETOS", area: "PROJETOS", gp: false }, d)).toBe(true);
    expect(contaDifere({ papel: "PROJETOS", area: "PROJETOS", gp: true }, d)).toBe(false);
    expect(contaDifere({ papel: "ADMIN", area: null, gp: false }, d)).toBe(false);
  });
});

describe("rotina", () => {
  it("semestre e progresso", () => {
    expect(semestreDe("2026-06-30")).toBe("2026.1");
    expect(semestreDe("2026-07-01")).toBe("2026.2");
    expect(progresso(30, 62, 40)).toBe(31);
    expect(progresso(30, 62, 99)).toBe(100);
    expect(progresso(10, 10, 10)).toBe(100);
  });
});

import { describe, expect, it } from "vitest";
import { contaDaDerivacao, contaDifere, cupula, derivarDoOrganograma, descendentes, descreverConta, progresso, semestreDe, temCiclo, validarImportacao, vigente } from "./modelo";

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
  // "INST" = área institucional (Presidência, Vice): sem lado no CRM.
  const posto = (lado: "PROJETOS" | "VENDAS" | "INST" | null, categoria: "DIRETORIA" | "LIDERANCA" | "MEMBRO", ehGp = false, principal = true, ehPo = false) => ({
    ladoCrm: lado === "INST" ? null : lado,
    institucional: lado === "INST",
    categoria,
    ehGp,
    ehPo,
    principal,
  });
  it("diretoria de Projetos vira GESTOR + Diretor; PM vira PM de Projetos; membro de Vendas vira VENDEDOR", () => {
    expect(derivarDoOrganograma([posto("PROJETOS", "DIRETORIA")])).toEqual({ area: "PROJETOS", papel: "GESTOR", cargos: ["DIRETOR"], conflito: null });
    expect(derivarDoOrganograma([posto("PROJETOS", "LIDERANCA", true)])).toEqual({ area: "PROJETOS", papel: "PROJETOS", cargos: ["PM"], conflito: null });
    expect(derivarDoOrganograma([posto("VENDAS", "MEMBRO")])).toEqual({ area: "VENDAS", papel: "VENDEDOR", cargos: [], conflito: null });
  });
  it("cargo GP (eh_gp) em Vendas vira GP; PO vira PO; diretoria de Vendas é só GESTOR (Diretor é de Projetos)", () => {
    expect(derivarDoOrganograma([posto("VENDAS", "LIDERANCA", true)])).toEqual({ area: "VENDAS", papel: "VENDEDOR", cargos: ["GP"], conflito: null });
    expect(derivarDoOrganograma([posto("PROJETOS", "LIDERANCA", false, true, true)])).toEqual({ area: "PROJETOS", papel: "PROJETOS", cargos: ["PO"], conflito: null });
    expect(derivarDoOrganograma([posto("VENDAS", "DIRETORIA")])).toEqual({ area: "VENDAS", papel: "GESTOR", cargos: [], conflito: null });
    // PO só existe em Projetos: marcado numa área de Vendas, não vira nada.
    expect(derivarDoOrganograma([posto("VENDAS", "LIDERANCA", false, true, true)])).toMatchObject({ cargos: [] });
  });
  it("vários postos no mesmo lado somam cargos, na ordem do catálogo (PM, PO, Diretor)", () => {
    expect(derivarDoOrganograma([posto("PROJETOS", "LIDERANCA", false, false, true), posto("PROJETOS", "DIRETORIA", false, true), posto("PROJETOS", "LIDERANCA", true, false)])).toEqual({
      area: "PROJETOS",
      papel: "GESTOR",
      cargos: ["PM", "PO", "DIRETOR"],
      conflito: null,
    });
    // Diretor de G&G (sem lado) que também é PM em Projetos: a diretoria de G&G não dá gestão (GAB-107), fica PM de Projetos.
    expect(derivarDoOrganograma([posto(null, "DIRETORIA"), posto("PROJETOS", "LIDERANCA", true)])).toEqual({ area: "PROJETOS", papel: "PROJETOS", cargos: ["PM"], conflito: null });
  });
  it("área sem lado (G&G, Marketing) vira VISUALIZADOR; sem posição, nada", () => {
    expect(derivarDoOrganograma([posto(null, "MEMBRO")])).toMatchObject({ area: null, papel: "VISUALIZADOR", cargos: [] });
    expect(derivarDoOrganograma([])).toEqual({ area: null, papel: null, cargos: [], conflito: null });
  });
  it("duas áreas: vale a principal; sem principal entre elas, conflito", () => {
    expect(derivarDoOrganograma([posto("PROJETOS", "LIDERANCA", true, false), posto("VENDAS", "MEMBRO", false, true)])).toMatchObject({ area: "VENDAS", cargos: [], conflito: null });
    expect(derivarDoOrganograma([posto("PROJETOS", "LIDERANCA", false, false), posto("VENDAS", "MEMBRO", false, false)])).toMatchObject({ area: null, cargos: [], conflito: ["PROJETOS", "VENDAS"] });
  });
  it("contaDifere compara os cargos como conjunto, ignora admin e conflito", () => {
    const d = derivarDoOrganograma([posto("PROJETOS", "LIDERANCA", true, true, true)]);
    expect(contaDifere({ papel: "PROJETOS", area: "PROJETOS", cargos: [] }, d)).toBe(true);
    expect(contaDifere({ papel: "PROJETOS", area: "PROJETOS", cargos: ["PM"] }, d)).toBe(true);
    expect(contaDifere({ papel: "PROJETOS", area: "PROJETOS", cargos: ["PO", "PM"] }, d)).toBe(false);
    expect(contaDifere({ papel: "ADMIN", area: null, cargos: [] }, d)).toBe(false);
  });
  it("contaDifere: GP legado em Projetos conta como PM (não fica 'difere' para sempre); Diretor aplicado não difere", () => {
    expect(contaDifere({ papel: "PROJETOS", area: "PROJETOS", cargos: ["GP"] }, derivarDoOrganograma([posto("PROJETOS", "LIDERANCA", true)]))).toBe(false);
    expect(contaDifere({ papel: "GESTOR", area: "PROJETOS", cargos: ["DIRETOR"] }, derivarDoOrganograma([posto("PROJETOS", "DIRETORIA")]))).toBe(false);
    // Conta com sujeira (DIRETOR em papel PROJETOS) é lida sem o cargo: difere do que a diretoria sugere.
    expect(contaDifere({ papel: "PROJETOS", area: "PROJETOS", cargos: ["DIRETOR"] }, derivarDoOrganograma([posto("PROJETOS", "DIRETORIA")]))).toBe(true);
  });
});

describe("cadastro derivado da posição (GAB-107)", () => {
  // "INST" = área institucional (Presidência, Vice): sem lado no CRM.
  const posto = (lado: "PROJETOS" | "VENDAS" | "INST" | null, categoria: "DIRETORIA" | "LIDERANCA" | "MEMBRO", ehGp = false, principal = true, ehPo = false) => ({
    ladoCrm: lado === "INST" ? null : lado,
    institucional: lado === "INST",
    categoria,
    ehGp,
    ehPo,
    principal,
  });
  it("presidência/vice (institucional, sem lado, cargo de diretoria) = GESTOR sem área, que conta nas duas áreas; entra no Geral", () => {
    const d = derivarDoOrganograma([posto("INST", "DIRETORIA")]);
    expect(d).toEqual({ area: null, papel: "GESTOR", cargos: [], conflito: null });
    expect(contaDaDerivacao(d)).toEqual({ papel: "GESTOR", area: null, cargos: [], areaEntrada: "GERAL" });
    expect(descreverConta(contaDaDerivacao(d)!)).toBe("Gestor de Vendas e Projetos");
  });
  it("diretoria de Vendas = Gestor de Vendas; diretoria de Projetos = Gestor de Projetos · Diretor (entra pela própria área)", () => {
    const v = contaDaDerivacao(derivarDoOrganograma([posto("VENDAS", "DIRETORIA")]));
    expect(v).toEqual({ papel: "GESTOR", area: "VENDAS", cargos: [], areaEntrada: null });
    expect(descreverConta(v!)).toBe("Gestor de Vendas");
    const p = contaDaDerivacao(derivarDoOrganograma([posto("PROJETOS", "DIRETORIA")]));
    expect(p).toEqual({ papel: "GESTOR", area: "PROJETOS", cargos: ["DIRETOR"], areaEntrada: null });
    expect(descreverConta(p!)).toBe("Gestor de Projetos · Diretor");
  });
  it("diretoria de área sem lado no CRM (G&G, Marketing, ADM-FIN) NÃO vira gestor das duas áreas: Visualizador", () => {
    const d = derivarDoOrganograma([posto(null, "DIRETORIA")]);
    expect(d).toEqual({ area: null, papel: "VISUALIZADOR", cargos: [], conflito: null });
    expect(descreverConta(contaDaDerivacao(d)!)).toBe("Visualizador (só leitura)");
    // Liderança institucional (não diretoria) também não dá gestão.
    expect(derivarDoOrganograma([posto("INST", "LIDERANCA")])).toMatchObject({ papel: "VISUALIZADOR" });
  });
  it("diretoria do outro lado (não principal) não dá gestão do lado da conta", () => {
    expect(derivarDoOrganograma([posto("VENDAS", "MEMBRO", false, true), posto("PROJETOS", "DIRETORIA", false, false)])).toEqual({ area: "VENDAS", papel: "VENDEDOR", cargos: [], conflito: null });
    // Presidência + membro de Vendas: gestor, com o lado de Vendas.
    expect(derivarDoOrganograma([posto("INST", "DIRETORIA"), posto("VENDAS", "MEMBRO")])).toMatchObject({ area: "VENDAS", papel: "GESTOR" });
  });
  it("contaDifere segue a mesma regra: diretor de G&G com conta Gestor difere (sugere Visualizador)", () => {
    const d = derivarDoOrganograma([posto(null, "DIRETORIA")]);
    expect(contaDifere({ papel: "GESTOR", area: null, cargos: [] }, d)).toBe(true);
    expect(contaDifere({ papel: "VISUALIZADOR", area: null, cargos: [] }, d)).toBe(false);
  });
  it("membro e GP: papel do lado, cargo do lado", () => {
    expect(descreverConta(contaDaDerivacao(derivarDoOrganograma([posto("PROJETOS", "MEMBRO")]))!)).toBe("Membro de Projetos");
    expect(descreverConta(contaDaDerivacao(derivarDoOrganograma([posto("PROJETOS", "LIDERANCA", true)]))!)).toBe("Membro de Projetos · PM");
    const gp = contaDaDerivacao(derivarDoOrganograma([posto("VENDAS", "LIDERANCA", true)]));
    expect(gp).toEqual({ papel: "VENDEDOR", area: "VENDAS", cargos: ["GP"], areaEntrada: null });
    expect(descreverConta(gp!)).toBe("Membro de Vendas · GP");
  });
  it("só G&G (sem lado) ou sem posição = Visualizador, entra no Geral", () => {
    const gg = contaDaDerivacao(derivarDoOrganograma([posto(null, "MEMBRO")]));
    expect(gg).toEqual({ papel: "VISUALIZADOR", area: null, cargos: [], areaEntrada: "GERAL" });
    expect(descreverConta(gg!)).toBe("Visualizador (só leitura)");
    expect(contaDaDerivacao(derivarDoOrganograma([]))).toEqual({ papel: "VISUALIZADOR", area: null, cargos: [], areaEntrada: "GERAL" });
  });
  it("administrador: papel ADMIN, mantém o lado da posição e entra por ele", () => {
    const a = contaDaDerivacao(derivarDoOrganograma([posto("VENDAS", "LIDERANCA", true)]), { administrador: true });
    expect(a).toEqual({ papel: "ADMIN", area: "VENDAS", cargos: ["GP"], areaEntrada: "VENDAS" });
    expect(descreverConta(a!)).toBe("Administrador · Vendas · GP");
    expect(contaDaDerivacao(derivarDoOrganograma([]), { administrador: true })).toEqual({ papel: "ADMIN", area: null, cargos: [], areaEntrada: "GERAL" });
  });
  it("conflito (dois lados sem principal) não vira conta", () => {
    const d = derivarDoOrganograma([posto("PROJETOS", "MEMBRO", false, false), posto("VENDAS", "MEMBRO", false, false)]);
    expect(d.conflito).toEqual(["PROJETOS", "VENDAS"]);
    expect(contaDaDerivacao(d)).toBeNull();
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

describe("cupula (organograma)", () => {
  const no = (id: string, superiorId: string | null, institucional = false) => ({ id, superiorId, institucional });

  it("forma do seed: Presidência → VP → diretorias vira uma linha com as diretorias abaixo", () => {
    const itens = [no("pres", null, true), no("vp", "pres", true), no("dir_gg", "vp"), no("dir_proj", "vp"), no("ger_rh", "dir_gg")];
    expect(cupula(itens, "pres")).toEqual({ ids: ["pres", "vp"], filhos: ["dir_gg", "dir_proj"] });
  });

  it("sem cadeia institucional: a raiz fica sozinha com os próprios filhos", () => {
    const itens = [no("dir", null), no("ger", "dir"), no("an", "ger")];
    expect(cupula(itens, "dir")).toEqual({ ids: ["dir"], filhos: ["ger"] });
    // Raiz institucional com filho comum também não junta nada.
    expect(cupula([no("pres", null, true), no("dir", "pres")], "pres")).toEqual({ ids: ["pres"], filhos: ["dir"] });
    // Raiz comum com filho institucional: a regra só começa em institucional.
    expect(cupula([no("dir", null), no("inst", "dir", true)], "dir")).toEqual({ ids: ["dir"], filhos: ["inst"] });
  });

  it("dois filhos institucionais: não junta (ambiguidade fica na árvore)", () => {
    const itens = [no("pres", null, true), no("vp1", "pres", true), no("vp2", "pres", true), no("dir", "vp1")];
    expect(cupula(itens, "pres")).toEqual({ ids: ["pres"], filhos: ["vp1", "vp2"] });
  });

  it("filhos não institucionais dos nós puxados continuam na linha de baixo", () => {
    const itens = [no("pres", null, true), no("assessoria", "pres"), no("vp", "pres", true), no("dir", "vp")];
    expect(cupula(itens, "pres")).toEqual({ ids: ["pres", "vp"], filhos: ["assessoria", "dir"] });
  });

  it("linha tem no máximo 2 (o 3º institucional fica abaixo); ciclo não trava", () => {
    const longa = [no("a", null, true), no("b", "a", true), no("c", "b", true), no("d", "c")];
    expect(cupula(longa, "a")).toEqual({ ids: ["a", "b"], filhos: ["c"] });
    const ciclo = [no("a", "b", true), no("b", "a", true)];
    expect(cupula(ciclo, "a")).toEqual({ ids: ["a", "b"], filhos: [] });
  });
});

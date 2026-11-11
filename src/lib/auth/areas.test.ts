import { describe, expect, it } from "vitest";
import type { Area, Cargo, Papel } from "@prisma/client";
import { CARGOS_DA_AREA, cargosDaArea, cargosDe, descreverLado, ehGpDoLado, ehGpDoProprioLado, ladoDe, podeEditarEquipe, podeSerResponsavelNoProjeto, podeVerTarefas, podeVerTarefasDoProjeto, regraDeArea, resolverAreaCargos, temCargo } from "./areas";

const pessoa = (papel: Papel, area: Area | null = null, cargos: Cargo[] = []) => ({ papel, area, cargos });

describe("regraDeArea / resolverAreaCargos (coerência área × papel)", () => {
  it("vendedor é sempre vendas e projetos é sempre projetos, mesmo pedindo outra área", () => {
    expect(regraDeArea("VENDEDOR")).toEqual({ tipo: "fixa", area: "VENDAS" });
    expect(regraDeArea("PROJETOS")).toEqual({ tipo: "fixa", area: "PROJETOS" });
    expect(resolverAreaCargos("VENDEDOR", "PROJETOS", ["GP"])).toEqual({ area: "VENDAS", cargos: ["GP"] });
    expect(resolverAreaCargos("PROJETOS", null, [])).toEqual({ area: "PROJETOS", cargos: [] });
  });

  it("visualizador não tem área nem cargo", () => {
    expect(regraDeArea("VISUALIZADOR")).toEqual({ tipo: "nenhuma" });
    expect(resolverAreaCargos("VISUALIZADOR", "VENDAS", ["GP"])).toEqual({ area: null, cargos: [] });
  });

  it("gestor/admin: área livre (padrão nenhuma); sem área, sem cargo", () => {
    expect(regraDeArea("GESTOR")).toEqual({ tipo: "livre" });
    expect(regraDeArea("ADMIN")).toEqual({ tipo: "livre" });
    expect(resolverAreaCargos("GESTOR", null, ["GP"])).toEqual({ area: null, cargos: [] });
    expect(resolverAreaCargos("GESTOR", "VENDAS", ["GP", "GP"])).toEqual({ area: "VENDAS", cargos: ["GP"] });
  });
});

describe("cargos por área (PM, PO e Diretor em Projetos; GP em Vendas)", () => {
  it("catálogo: cada área tem os seus cargos", () => {
    expect(CARGOS_DA_AREA).toEqual({ VENDAS: ["GP"], PROJETOS: ["PM", "PO", "DIRETOR"] });
  });

  it("resolver só mantém cargo da área efetiva, na ordem do catálogo", () => {
    expect(resolverAreaCargos("PROJETOS", null, ["PO", "PM"])).toEqual({ area: "PROJETOS", cargos: ["PM", "PO"] });
    expect(resolverAreaCargos("VENDEDOR", "VENDAS", ["PM", "PO", "GP"])).toEqual({ area: "VENDAS", cargos: ["GP"] });
    expect(resolverAreaCargos("GESTOR", "VENDAS", ["PM"])).toEqual({ area: "VENDAS", cargos: [] });
    expect(resolverAreaCargos("GESTOR", "PROJETOS", ["GP", "PM", "PO"])).toEqual({ area: "PROJETOS", cargos: ["PM", "PO"] });
  });

  it("GP legado em Projetos é sinônimo de PM (contas antigas seguem valendo, sem migrar dados)", () => {
    expect(resolverAreaCargos("PROJETOS", "PROJETOS", ["GP"])).toEqual({ area: "PROJETOS", cargos: ["PM"] });
    expect(resolverAreaCargos("PROJETOS", "PROJETOS", ["GP", "PM"])).toEqual({ area: "PROJETOS", cargos: ["PM"] });
    expect(cargosDe(pessoa("PROJETOS", "PROJETOS", ["GP"]))).toEqual(["PM"]);
    expect(temCargo(pessoa("PROJETOS", "PROJETOS", ["GP"]), "PM")).toBe(true);
  });

  it("DIRETOR só com papel GESTOR/ADMIN e lado Projetos; com papel PROJETOS (action direta) é descartado", () => {
    expect(resolverAreaCargos("GESTOR", "PROJETOS", ["DIRETOR"])).toEqual({ area: "PROJETOS", cargos: ["DIRETOR"] });
    expect(resolverAreaCargos("ADMIN", "PROJETOS", ["DIRETOR", "PM"])).toEqual({ area: "PROJETOS", cargos: ["PM", "DIRETOR"] });
    expect(resolverAreaCargos("PROJETOS", "PROJETOS", ["DIRETOR"])).toEqual({ area: "PROJETOS", cargos: [] });
    expect(resolverAreaCargos("PROJETOS", null, ["DIRETOR", "PO"])).toEqual({ area: "PROJETOS", cargos: ["PO"] });
    expect(resolverAreaCargos("GESTOR", "VENDAS", ["DIRETOR"])).toEqual({ area: "VENDAS", cargos: [] });
    // Sujeira no banco (DIRETOR com papel PROJETOS) não vale na leitura.
    expect(cargosDe(pessoa("PROJETOS", "PROJETOS", ["DIRETOR"]))).toEqual([]);
  });

  it("cargosDaArea: o que o form oferece — Diretor só para gestão; GP nunca em Projetos", () => {
    expect(cargosDaArea("VENDAS", "VENDEDOR")).toEqual(["GP"]);
    expect(cargosDaArea("VENDAS", "GESTOR")).toEqual(["GP"]);
    expect(cargosDaArea("PROJETOS", "PROJETOS")).toEqual(["PM", "PO"]);
    expect(cargosDaArea("PROJETOS", "GESTOR")).toEqual(["PM", "PO", "DIRETOR"]);
    expect(cargosDaArea("PROJETOS", "ADMIN")).toEqual(["PM", "PO", "DIRETOR"]);
  });
});

describe("ladoDe", () => {
  it("responde o lado de cada papel", () => {
    expect(ladoDe(pessoa("VENDEDOR", "VENDAS"))).toBe("VENDAS");
    expect(ladoDe(pessoa("PROJETOS", "PROJETOS"))).toBe("PROJETOS");
    expect(ladoDe(pessoa("GESTOR"))).toBeNull();
    expect(ladoDe(pessoa("ADMIN"))).toBeNull();
    expect(ladoDe(pessoa("GESTOR", "PROJETOS"))).toBe("PROJETOS");
  });

  it("defensivo: o papel prevalece sobre coluna incoerente (ex.: convite feito pela versão anterior no deploy)", () => {
    expect(ladoDe(pessoa("VENDEDOR", null))).toBe("VENDAS");
    expect(ladoDe(pessoa("PROJETOS", "VENDAS"))).toBe("PROJETOS");
    expect(ladoDe(pessoa("VISUALIZADOR", "VENDAS", ["GP"]))).toBeNull();
  });
});

describe("ehGpDoLado / temCargo", () => {
  it("GP de vendas é GP só de vendas", () => {
    const gpVendas = pessoa("VENDEDOR", "VENDAS", ["GP"]);
    expect(ehGpDoLado(gpVendas, "VENDAS")).toBe(true);
    expect(ehGpDoLado(gpVendas, "PROJETOS")).toBe(false);
  });

  it("GP de projetos é GP só de projetos", () => {
    const gpProj = pessoa("PROJETOS", "PROJETOS", ["GP"]);
    expect(ehGpDoLado(gpProj, "PROJETOS")).toBe(true);
    expect(ehGpDoLado(gpProj, "VENDAS")).toBe(false);
  });

  it("membro sem cargo não é GP", () => {
    expect(ehGpDoLado(pessoa("VENDEDOR", "VENDAS"), "VENDAS")).toBe(false);
    expect(ehGpDoLado(pessoa("PROJETOS", "PROJETOS"), "PROJETOS")).toBe(false);
  });

  it("gestor só é GP se a gestão deu lado e cargo; gestor sem lado nunca é GP", () => {
    expect(ehGpDoLado(pessoa("GESTOR", "VENDAS", ["GP"]), "VENDAS")).toBe(true);
    expect(ehGpDoLado(pessoa("GESTOR", null, ["GP"]), "VENDAS")).toBe(false);
    expect(ehGpDoLado(pessoa("ADMIN", null, ["GP"]), "PROJETOS")).toBe(false);
  });

  it("visualizador com cargo sujo no banco não age como GP", () => {
    expect(temCargo(pessoa("VISUALIZADOR", "VENDAS", ["GP"]), "GP")).toBe(false);
    expect(ehGpDoLado(pessoa("VISUALIZADOR", "VENDAS", ["GP"]), "VENDAS")).toBe(false);
  });

  it("cargo segue o lado efetivo (papel), não a coluna", () => {
    // projetos com área VENDAS gravada por engano: é GP de projetos, não de vendas
    const u = pessoa("PROJETOS", "VENDAS", ["GP"]);
    expect(ehGpDoLado(u, "PROJETOS")).toBe(true);
    expect(ehGpDoLado(u, "VENDAS")).toBe(false);
  });

  it("PM é quem age por Projetos na caneta (o 'GP do lado' de projetos); GP legado em Projetos continua valendo", () => {
    expect(ehGpDoLado(pessoa("PROJETOS", "PROJETOS", ["PM"]), "PROJETOS")).toBe(true);
    expect(ehGpDoLado(pessoa("PROJETOS", "PROJETOS", ["PM"]), "VENDAS")).toBe(false);
    expect(ehGpDoLado(pessoa("GESTOR", "PROJETOS", ["PM"]), "PROJETOS")).toBe(true);
    expect(ehGpDoLado(pessoa("PROJETOS", "PROJETOS", ["GP"]), "PROJETOS")).toBe(true);
    expect(ehGpDoProprioLado(pessoa("PROJETOS", "PROJETOS", ["PM"]))).toBe(true);
    expect(ehGpDoProprioLado(pessoa("VENDEDOR", "VENDAS", ["GP"]))).toBe(true);
  });

  it("PO e Diretor não dão a caneta: nenhuma permissão nova", () => {
    expect(ehGpDoLado(pessoa("PROJETOS", "PROJETOS", ["PO"]), "PROJETOS")).toBe(false);
    expect(ehGpDoLado(pessoa("GESTOR", "PROJETOS", ["DIRETOR"]), "PROJETOS")).toBe(false);
    expect(ehGpDoProprioLado(pessoa("PROJETOS", "PROJETOS", ["PO"]))).toBe(false);
    expect(ehGpDoProprioLado(pessoa("GESTOR", "PROJETOS", ["DIRETOR"]))).toBe(false);
    expect(ehGpDoProprioLado(pessoa("GESTOR", null, ["PM"]))).toBe(false);
    // PM em Vendas não existe: não vira GP de vendas por engano
    expect(ehGpDoLado(pessoa("VENDEDOR", "VENDAS", ["PM"]), "VENDAS")).toBe(false);
  });
});

describe("descreverLado", () => {
  it("rótulos da tabela de usuários", () => {
    expect(descreverLado(pessoa("VENDEDOR", "VENDAS", ["GP"]))).toBe("GP de vendas");
    expect(descreverLado(pessoa("PROJETOS", "PROJETOS"))).toBe("Projetos");
    expect(descreverLado(pessoa("GESTOR"))).toBe("—");
  });

  it("cargos de Projetos: PM, PO e Diretor; GP legado aparece como PM", () => {
    expect(descreverLado(pessoa("PROJETOS", "PROJETOS", ["PM"]))).toBe("PM de projetos");
    expect(descreverLado(pessoa("PROJETOS", "PROJETOS", ["PO"]))).toBe("PO de projetos");
    expect(descreverLado(pessoa("PROJETOS", "PROJETOS", ["PO", "PM"]))).toBe("PM, PO de projetos");
    expect(descreverLado(pessoa("GESTOR", "PROJETOS", ["DIRETOR"]))).toBe("Diretor de projetos");
    expect(descreverLado(pessoa("PROJETOS", "PROJETOS", ["GP"]))).toBe("PM de projetos");
    expect(descreverLado(pessoa("PROJETOS", "PROJETOS", ["DIRETOR"]))).toBe("Projetos"); // sujeira: Diretor exige gestão
  });
});

describe("podeVerTarefas (kanban interno do projeto)", () => {
  it("passa: papel PROJETOS, gestor com área Projetos, diretoria sem área e admin", () => {
    expect(podeVerTarefas(pessoa("GESTOR", null))).toBe(true); // diretoria (conta nas duas áreas, hub §4.7)
    expect(podeVerTarefas(pessoa("PROJETOS", "PROJETOS"))).toBe(true);
    expect(podeVerTarefas(pessoa("PROJETOS", null))).toBe(true); // o papel fixa o lado
    expect(podeVerTarefas(pessoa("GESTOR", "PROJETOS"))).toBe(true);
    expect(podeVerTarefas(pessoa("GESTOR", "PROJETOS", ["GP"]))).toBe(true);
    expect(podeVerTarefas(pessoa("ADMIN"))).toBe(true);
  });

  it("recusa: vendedor, gestor de vendas e visualizador (mesmo com área gravada)", () => {
    expect(podeVerTarefas(pessoa("VENDEDOR", "VENDAS"))).toBe(false);
    expect(podeVerTarefas(pessoa("VENDEDOR", "PROJETOS"))).toBe(false); // coluna incoerente: o papel prevalece
    expect(podeVerTarefas(pessoa("GESTOR", "VENDAS"))).toBe(false);
    expect(podeVerTarefas(pessoa("VISUALIZADOR", "PROJETOS"))).toBe(false);
  });
});

describe("escala do projeto (equipe)", () => {
  const com = (papel: Parameters<typeof pessoa>[0], area: Parameters<typeof pessoa>[1], id: string) => ({ ...pessoa(papel, area), id });
  const paula = com("PROJETOS", "PROJETOS", "paula");
  const pedro = com("PROJETOS", "PROJETOS", "pedro");
  const diretor = com("GESTOR", "PROJETOS", "guto");
  const ana = com("VENDEDOR", "VENDAS", "ana");
  const semEquipe = { equipe: [], responsavelId: "x", gpId: null };
  const comEquipe = { equipe: ["paula"], responsavelId: "x", gpId: "gp" };

  it("sem equipe, o time inteiro vê e recebe tarefa; com equipe, só quem está escalado", () => {
    expect(podeVerTarefasDoProjeto(pedro, semEquipe)).toBe(true);
    expect(podeVerTarefasDoProjeto(pedro, comEquipe)).toBe(false);
    expect(podeVerTarefasDoProjeto(paula, comEquipe)).toBe(true);
    expect(podeVerTarefasDoProjeto({ ...pedro, id: "gp" }, comEquipe)).toBe(true); // GP do handoff
    expect(podeSerResponsavelNoProjeto(pedro, comEquipe)).toBe(false);
    expect(podeSerResponsavelNoProjeto(pedro, semEquipe)).toBe(true);
  });
  it("diretoria e admin sempre veem e montam a equipe; vendas nunca", () => {
    expect(podeVerTarefasDoProjeto(diretor, comEquipe)).toBe(true);
    expect(podeEditarEquipe(diretor, comEquipe)).toBe(true);
    expect(podeEditarEquipe(paula, comEquipe)).toBe(false);
    expect(podeEditarEquipe({ ...pedro, id: "gp" }, comEquipe)).toBe(true);
    expect(podeVerTarefasDoProjeto(ana, semEquipe)).toBe(false);
  });
  it("responsável ou GP fora do time de projetos (ex.: vendedor antes do GP no handoff) não monta a equipe", () => {
    expect(podeEditarEquipe(ana, { ...comEquipe, responsavelId: "ana" })).toBe(false);
    expect(podeEditarEquipe(ana, { ...comEquipe, gpId: "ana" })).toBe(false);
    expect(podeEditarEquipe(com("GESTOR", "VENDAS", "gv"), { ...comEquipe, responsavelId: "gv" })).toBe(false);
    expect(podeEditarEquipe({ ...pedro, id: "x" }, comEquipe)).toBe(true); // responsável do time de projetos segue
  });
});

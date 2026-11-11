import { describe, expect, it } from "vitest";
import type { Area, AreaEntrada, Cargo, Papel } from "@prisma/client";
import { mesmaAreaEntrada, resolverAreaEntrada, usaAreaDeEntrada } from "./areas";
import {
  alcanceDaAgenda,
  areaDeEntrada,
  areaDoQuadro,
  areaPadrao,
  destinoDaArea,
  destinoDeEntrada,
  ehDaArea,
  itensDaArea,
  itensGerais,
  lerArea,
  podeCriarCardNoQuadro,
  podeEditarCard,
  podeTrocarResponsavel,
  podeVerAgendaDe,
  podeVerItem,
  podeVerItemEmAlgumaArea,
  podeVerProposta,
  quadroPadrao,
  veOutrasAgendas,
  veTodasAsPropostas,
  visaoDaCanetaNoPainel,
} from "./visibilidade";

const pessoa = (papel: Papel, area: Area | null = null, areaEntrada: AreaEntrada | null = null) => ({ papel, area, cargos: [] as Cargo[], areaEntrada });

const VENDEDOR = pessoa("VENDEDOR", "VENDAS");
const MEMBRO_PROJETOS = pessoa("PROJETOS", "PROJETOS");
const GESTOR_VENDAS = pessoa("GESTOR", "VENDAS");
const GESTOR_PROJETOS = pessoa("GESTOR", "PROJETOS");
const GESTOR_SEM_AREA = pessoa("GESTOR");
const ADMIN = pessoa("ADMIN");
const VISUALIZADOR = pessoa("VISUALIZADOR");

const TUDO_VENDAS = ["semana", "kanban", "propostas", "tabela", "ranking", "contatos", "empresas", "calendario"];
const TUDO_PROJETOS = ["semana", "kanban", "propostas", "contatos", "empresas", "calendario"];
const VISITANTE = ["kanban", "propostas", "contatos", "empresas", "calendario"];

describe("itensDaArea", () => {
  it.each([
    ["vendedor em vendas", VENDEDOR, "VENDAS", TUDO_VENDAS],
    ["vendedor visitando projetos", VENDEDOR, "PROJETOS", VISITANTE],
    ["membro de projetos em projetos", MEMBRO_PROJETOS, "PROJETOS", TUDO_PROJETOS],
    ["membro de projetos visitando vendas: sem Tabela, Ranking e Semana", MEMBRO_PROJETOS, "VENDAS", VISITANTE],
    ["gestor de vendas em vendas", GESTOR_VENDAS, "VENDAS", TUDO_VENDAS],
    ["gestor de vendas visitando projetos", GESTOR_VENDAS, "PROJETOS", VISITANTE],
    ["gestor de projetos visitando vendas", GESTOR_PROJETOS, "VENDAS", VISITANTE],
    ["gestor sem área em vendas", GESTOR_SEM_AREA, "VENDAS", TUDO_VENDAS],
    ["gestor sem área em projetos", GESTOR_SEM_AREA, "PROJETOS", TUDO_PROJETOS],
    ["admin em vendas", ADMIN, "VENDAS", TUDO_VENDAS],
    ["admin em projetos", ADMIN, "PROJETOS", TUDO_PROJETOS],
    ["admin com lado continua vendo a outra área", pessoa("ADMIN", "VENDAS"), "PROJETOS", TUDO_PROJETOS],
    ["visualizador em vendas", VISUALIZADOR, "VENDAS", ["kanban", "contatos", "empresas"]],
    ["visualizador em projetos", VISUALIZADOR, "PROJETOS", ["kanban", "contatos", "empresas"]],
  ] as const)("%s", (_nome, p, area, esperado) => {
    expect(itensDaArea(p, area)).toEqual(esperado);
  });

  it("o lado vem do papel, não da coluna: vendedor com coluna errada segue sendo de vendas", () => {
    expect(itensDaArea(pessoa("VENDEDOR", "PROJETOS"), "VENDAS")).toEqual(TUDO_VENDAS);
  });
});

describe("podeVerItem", () => {
  it("item que a área não tem é não, mesmo para admin", () => {
    expect(podeVerItem(ADMIN, "PROJETOS", "tabela")).toBe(false);
    expect(podeVerItem(ADMIN, "PROJETOS", "ranking")).toBe(false);
    expect(podeVerItem(ADMIN, "VENDAS", "tabela")).toBe(true);
  });
});

describe("podeVerItemEmAlgumaArea (rotas que não dependem da área aberta)", () => {
  it("Tabela: só quem é de vendas, gestor sem área e admin", () => {
    expect(podeVerItemEmAlgumaArea(VENDEDOR, "tabela")).toBe(true);
    expect(podeVerItemEmAlgumaArea(GESTOR_SEM_AREA, "tabela")).toBe(true);
    expect(podeVerItemEmAlgumaArea(MEMBRO_PROJETOS, "tabela")).toBe(false);
    expect(podeVerItemEmAlgumaArea(GESTOR_PROJETOS, "tabela")).toBe(false);
    expect(podeVerItemEmAlgumaArea(VISUALIZADOR, "tabela")).toBe(false);
  });

  it("Minha Semana: todos menos o visualizador", () => {
    expect(podeVerItemEmAlgumaArea(MEMBRO_PROJETOS, "semana")).toBe(true);
    expect(podeVerItemEmAlgumaArea(VISUALIZADOR, "semana")).toBe(false);
  });
});

describe("ehDaArea", () => {
  it("admin e gestor sem área contam nas duas; visualizador em nenhuma", () => {
    for (const area of ["VENDAS", "PROJETOS"] as const) {
      expect(ehDaArea(ADMIN, area)).toBe(true);
      expect(ehDaArea(GESTOR_SEM_AREA, area)).toBe(true);
      expect(ehDaArea(VISUALIZADOR, area)).toBe(false);
    }
    expect(ehDaArea(GESTOR_VENDAS, "PROJETOS")).toBe(false);
  });
});

describe("itensGerais", () => {
  it("Gestão só para gestor e admin", () => {
    expect(itensGerais(ADMIN)).toEqual(["painel", "gestao", "perfil"]);
    expect(itensGerais(GESTOR_VENDAS)).toEqual(["painel", "gestao", "perfil"]);
    for (const p of [VENDEDOR, MEMBRO_PROJETOS, VISUALIZADOR]) expect(itensGerais(p)).toEqual(["painel", "perfil"]);
  });
});

describe("área de entrada", () => {
  it("só ADMIN, GESTOR sem área e VISUALIZADOR usam a coluna", () => {
    expect(usaAreaDeEntrada("ADMIN", "VENDAS")).toBe(true);
    expect(usaAreaDeEntrada("ADMIN", null)).toBe(true);
    expect(usaAreaDeEntrada("GESTOR", null)).toBe(true);
    expect(usaAreaDeEntrada("VISUALIZADOR", null)).toBe(true);
    expect(usaAreaDeEntrada("GESTOR", "VENDAS")).toBe(false);
    expect(usaAreaDeEntrada("VENDEDOR", "VENDAS")).toBe(false);
    expect(usaAreaDeEntrada("PROJETOS", "PROJETOS")).toBe(false);
  });

  it("resolverAreaEntrada zera para quem entra pela própria área", () => {
    expect(resolverAreaEntrada("VENDEDOR", "VENDAS", "PROJETOS")).toBeNull();
    expect(resolverAreaEntrada("GESTOR", "VENDAS", "PROJETOS")).toBeNull();
    expect(resolverAreaEntrada("GESTOR", null, "PROJETOS")).toBe("PROJETOS");
    expect(resolverAreaEntrada("ADMIN", "VENDAS", "PROJETOS")).toBe("PROJETOS");
  });

  it("mesmaAreaEntrada: null e GERAL são a mesma", () => {
    expect(mesmaAreaEntrada(null, "GERAL")).toBe(true);
    expect(mesmaAreaEntrada("GERAL", null)).toBe(true);
    expect(mesmaAreaEntrada(null, null)).toBe(true);
    expect(mesmaAreaEntrada("VENDAS", "VENDAS")).toBe(true);
    expect(mesmaAreaEntrada(null, "VENDAS")).toBe(false);
    expect(mesmaAreaEntrada("PROJETOS", "VENDAS")).toBe(false);
  });

  it("membro e gestor com área: a própria, ignorando a coluna", () => {
    expect(areaDeEntrada(pessoa("VENDEDOR", "VENDAS", "PROJETOS"))).toBe("VENDAS");
    expect(areaDeEntrada(MEMBRO_PROJETOS)).toBe("PROJETOS");
    expect(areaDeEntrada(pessoa("GESTOR", "PROJETOS", "VENDAS"))).toBe("PROJETOS");
  });

  it("admin, gestor sem área e visualizador: a coluna; sem valor, Geral", () => {
    expect(areaDeEntrada(ADMIN)).toBe("GERAL");
    expect(areaDeEntrada(pessoa("ADMIN", "VENDAS", "PROJETOS"))).toBe("PROJETOS");
    expect(areaDeEntrada(pessoa("ADMIN", "VENDAS"))).toBe("GERAL");
    expect(areaDeEntrada(pessoa("GESTOR", null, "VENDAS"))).toBe("VENDAS");
    expect(areaDeEntrada(pessoa("VISUALIZADOR", null, "PROJETOS"))).toBe("PROJETOS");
  });

  it("areaPadrao: a de entrada; em Geral, o lado ou Vendas", () => {
    expect(areaPadrao(MEMBRO_PROJETOS)).toBe("PROJETOS");
    expect(areaPadrao(pessoa("ADMIN", null, "PROJETOS"))).toBe("PROJETOS");
    expect(areaPadrao(pessoa("ADMIN", "PROJETOS"))).toBe("PROJETOS");
    expect(areaPadrao(ADMIN)).toBe("VENDAS");
    expect(areaPadrao(VISUALIZADOR)).toBe("VENDAS");
  });
});

describe("destinoDaArea", () => {
  it("a preferência vale dentro da área", () => {
    expect(destinoDaArea(VENDEDOR, "VENDAS", "semana")).toBe("/semana");
    expect(destinoDaArea(VENDEDOR, "VENDAS", "kanban")).toBe("/kanban");
    expect(destinoDaArea(MEMBRO_PROJETOS, "PROJETOS", "kanban")).toBe("/kanban?quadro=projetos");
    expect(destinoDaArea(ADMIN, "PROJETOS", "semana")).toBe("/semana");
  });

  it("quem não vê a Semana naquela área vai ao Kanban dela", () => {
    expect(destinoDaArea(VENDEDOR, "PROJETOS", "semana")).toBe("/kanban?quadro=projetos");
    expect(destinoDaArea(VISUALIZADOR, "VENDAS", "semana")).toBe("/kanban");
  });
});

describe("destinoDeEntrada", () => {
  it.each([
    ["membro sem preferência", VENDEDOR, "semana", "/semana"],
    ["membro de projetos com kanban", MEMBRO_PROJETOS, "kanban", "/kanban?quadro=projetos"],
    ["gestor com área", GESTOR_PROJETOS, "kanban", "/kanban?quadro=projetos"],
    ["admin sem valor: Geral", ADMIN, "semana", "/painel"],
    ["admin sem valor ignora a preferência", ADMIN, "kanban", "/painel"],
    ["admin em Geral", pessoa("ADMIN", null, "GERAL"), "semana", "/painel"],
    ["admin em Projetos", pessoa("ADMIN", null, "PROJETOS"), "kanban", "/kanban?quadro=projetos"],
    ["gestor sem área em Vendas: a Semana recebe a área", pessoa("GESTOR", null, "VENDAS"), "semana", "/semana?area=VENDAS"],
    ["admin em Projetos com semana: a Semana recebe a área", pessoa("ADMIN", null, "PROJETOS"), "semana", "/semana?area=PROJETOS"],
    ["admin com lado em Vendas e entrada em Projetos", pessoa("ADMIN", "VENDAS", "PROJETOS"), "semana", "/semana?area=PROJETOS"],
    ["visualizador sem valor", VISUALIZADOR, "semana", "/painel"],
    ["visualizador em Projetos não tem Semana", pessoa("VISUALIZADOR", null, "PROJETOS"), "semana", "/kanban?quadro=projetos"],
  ] as const)("%s", (_nome, p, inicio, esperado) => {
    expect(destinoDeEntrada(p, inicio)).toBe(esperado);
  });
});

describe("lerArea", () => {
  it("só aceita área conhecida", () => {
    expect(lerArea("VENDAS")).toBe("VENDAS");
    expect(lerArea("PROJETOS")).toBe("PROJETOS");
    expect(lerArea("GERAL")).toBeNull();
    expect(lerArea("x")).toBeNull();
    expect(lerArea(undefined)).toBeNull();
    expect(lerArea(null)).toBeNull();
    expect(lerArea("constructor")).toBeNull();
  });
});

const ID = "eu";
const comId = <T extends object>(p: T) => ({ ...p, id: ID });
const GP_VENDAS = { ...pessoa("VENDEDOR", "VENDAS"), cargos: ["GP"] as Cargo[] };
const GP_PROJETOS = { ...pessoa("PROJETOS", "PROJETOS"), cargos: ["GP"] as Cargo[] };
const GESTOR_GP_VENDAS = { ...pessoa("GESTOR", "VENDAS"), cargos: ["GP"] as Cargo[] };
// Cargos de Projetos: PM é o GP do lado; PO e Diretor não dão nada além do papel.
const PM_PROJETOS = { ...pessoa("PROJETOS", "PROJETOS"), cargos: ["PM"] as Cargo[] };
const PO_PROJETOS = { ...pessoa("PROJETOS", "PROJETOS"), cargos: ["PO"] as Cargo[] };
const DIRETOR_PROJETOS = { ...pessoa("GESTOR", "PROJETOS"), cargos: ["DIRETOR"] as Cargo[] };

/** Matriz papel × área (GAB-98): o que o servidor decide, igual em tela, action e MCP. */
const MATRIZ: { nome: string; p: typeof VENDEDOR; tabelaRanking: boolean; vendas: boolean; projetos: boolean; todasPropostas: boolean; agenda: "nenhum" | "proprio" | "area" | "todos" }[] = [
  { nome: "vendedor", p: VENDEDOR, tabelaRanking: true, vendas: true, projetos: false, todasPropostas: false, agenda: "proprio" },
  { nome: "GP de vendas", p: GP_VENDAS, tabelaRanking: true, vendas: true, projetos: false, todasPropostas: true, agenda: "proprio" },
  { nome: "membro de projetos", p: MEMBRO_PROJETOS, tabelaRanking: false, vendas: false, projetos: true, todasPropostas: false, agenda: "proprio" },
  { nome: "GP de projetos", p: GP_PROJETOS, tabelaRanking: false, vendas: false, projetos: true, todasPropostas: true, agenda: "proprio" },
  { nome: "PM de projetos", p: PM_PROJETOS, tabelaRanking: false, vendas: false, projetos: true, todasPropostas: true, agenda: "proprio" },
  { nome: "PO de projetos", p: PO_PROJETOS, tabelaRanking: false, vendas: false, projetos: true, todasPropostas: false, agenda: "proprio" },
  { nome: "diretor de projetos (gestor com lado)", p: DIRETOR_PROJETOS, tabelaRanking: false, vendas: false, projetos: true, todasPropostas: true, agenda: "area" },
  { nome: "gestor de vendas", p: GESTOR_VENDAS, tabelaRanking: true, vendas: true, projetos: false, todasPropostas: true, agenda: "area" },
  { nome: "gestor de projetos", p: GESTOR_PROJETOS, tabelaRanking: false, vendas: false, projetos: true, todasPropostas: true, agenda: "area" },
  { nome: "gestor sem área", p: GESTOR_SEM_AREA, tabelaRanking: true, vendas: true, projetos: true, todasPropostas: true, agenda: "todos" },
  { nome: "admin", p: ADMIN, tabelaRanking: true, vendas: true, projetos: true, todasPropostas: true, agenda: "todos" },
  { nome: "visualizador", p: VISUALIZADOR, tabelaRanking: false, vendas: false, projetos: false, todasPropostas: false, agenda: "nenhum" },
];

describe.each(MATRIZ)("matriz GAB-98: $nome", ({ p, tabelaRanking, vendas, projetos, todasPropostas, agenda }) => {
  const eu = comId(p);

  it("Tabela e Ranking só para quem é de Vendas; Painel é de todos", () => {
    expect(podeVerItemEmAlgumaArea(p, "tabela")).toBe(tabelaRanking);
    expect(podeVerItemEmAlgumaArea(p, "ranking")).toBe(tabelaRanking);
    expect(itensGerais(p)).toContain("painel");
  });

  it("edita e move o card da área dona; de outra área, não", () => {
    expect(podeEditarCard(eu, { responsavelId: "outro", quadro: "vendas" })).toBe(vendas);
    expect(podeEditarCard(eu, { responsavelId: "outro", quadro: "projetos" })).toBe(projetos);
    expect(podeCriarCardNoQuadro(p, "vendas")).toBe(vendas);
    expect(podeCriarCardNoQuadro(p, "projetos")).toBe(projetos);
  });

  it("o responsável edita mesmo fora da área (vendedor depois do Ganho); visualizador nunca", () => {
    const escreve = p.papel !== "VISUALIZADOR";
    expect(podeEditarCard(eu, { responsavelId: ID, quadro: "vendas" })).toBe(escreve);
    expect(podeEditarCard(eu, { responsavelId: ID, quadro: "projetos" })).toBe(escreve);
  });

  it("quadro desconhecido não é de nenhuma área: só quem conta nas duas edita", () => {
    expect(podeEditarCard(eu, { responsavelId: "outro", quadro: "adm-fin" })).toBe(vendas && projetos);
    expect(areaDoQuadro("adm-fin")).toBeNull();
  });

  it("proposta: vê todas ou só as em que está escalada; visualizador, nenhuma", () => {
    expect(veTodasAsPropostas(p)).toBe(todasPropostas);
    expect(podeVerProposta(p, false)).toBe(todasPropostas);
    expect(podeVerProposta(p, true)).toBe(p.papel !== "VISUALIZADOR");
  });

  it("caneta no painel de projetos: nunca passa de quem vê a proposta, com o ranking aberto ou não", () => {
    const esperado = (aberto: boolean) => (todasPropostas ? "todas" : p.papel === "VISUALIZADOR" ? "nenhuma" : aberto ? "escaladas" : "so_minhas");
    expect(visaoDaCanetaNoPainel(p, true)).toBe(esperado(true));
    expect(visaoDaCanetaNoPainel(p, false)).toBe(esperado(false));
  });

  it("agenda: alcance de quem vê quem", () => {
    expect(alcanceDaAgenda(p)).toBe(agenda);
    expect(veOutrasAgendas(p)).toBe(agenda === "area" || agenda === "todos");
    expect(podeVerAgendaDe(eu, comId(p))).toBe(agenda !== "nenhum");
    const de = (q: { papel: Papel; area: Area | null }) => podeVerAgendaDe(eu, { ...q, cargos: [], id: "outro" });
    expect(de(VENDEDOR)).toBe(agenda === "todos" || (agenda === "area" && vendas));
    expect(de(MEMBRO_PROJETOS)).toBe(agenda === "todos" || (agenda === "area" && projetos));
    expect(de(GESTOR_SEM_AREA)).toBe(agenda === "todos");
  });
});

describe("GAB-98: casos à parte", () => {
  it("gestor com área e GP continua vendo todas as propostas com o cargo; GP sem poder escrever não existe", () => {
    expect(veTodasAsPropostas(GESTOR_GP_VENDAS)).toBe(true);
    expect(veTodasAsPropostas({ papel: "VISUALIZADOR", area: "VENDAS", cargos: ["GP"] })).toBe(false);
  });

  it("papel fixa a área mesmo com coluna incoerente (ladoDe é a fonte)", () => {
    expect(podeEditarCard({ papel: "VENDEDOR", area: "PROJETOS", cargos: [], id: ID }, { responsavelId: "x", quadro: "vendas" })).toBe(true);
    expect(podeEditarCard({ papel: "VENDEDOR", area: "PROJETOS", cargos: [], id: ID }, { responsavelId: "x", quadro: "projetos" })).toBe(false);
  });

  it("areaDoQuadro lê a chave do pipeline", () => {
    expect(areaDoQuadro("vendas")).toBe("VENDAS");
    expect(areaDoQuadro("projetos")).toBe("PROJETOS");
  });
});

describe("GAB-98: trocar o responsável", () => {
  const CASOS: [string, typeof VENDEDOR, boolean, boolean][] = [
    ["vendedor", VENDEDOR, false, false],
    ["GP de vendas", GP_VENDAS, true, false],
    ["membro de projetos", MEMBRO_PROJETOS, false, false],
    ["GP de projetos", GP_PROJETOS, false, true],
    ["PM de projetos", PM_PROJETOS, false, true],
    ["PO de projetos", PO_PROJETOS, false, false],
    ["diretor de projetos", DIRETOR_PROJETOS, false, true],
    ["gestor de vendas", GESTOR_VENDAS, true, false],
    ["gestor de projetos", GESTOR_PROJETOS, false, true],
    ["gestor sem área", GESTOR_SEM_AREA, true, true],
    ["admin", ADMIN, true, true],
    ["visualizador", VISUALIZADOR, false, false],
  ];

  it.each(CASOS)("%s", (_nome, p, vendas, projetos) => {
    const eu = comId(p);
    expect(podeTrocarResponsavel(eu, { responsavelId: "outro", quadro: "vendas" })).toBe(vendas);
    expect(podeTrocarResponsavel(eu, { responsavelId: "outro", quadro: "projetos" })).toBe(projetos);
    expect(podeTrocarResponsavel(eu, { responsavelId: ID, quadro: "vendas" })).toBe(p.papel !== "VISUALIZADOR");
  });

  it("quadro padrão: o da área; sem lado, vendas", () => {
    expect(quadroPadrao(MEMBRO_PROJETOS)).toBe("projetos");
    expect(quadroPadrao(VENDEDOR)).toBe("vendas");
    expect(quadroPadrao(GESTOR_SEM_AREA)).toBe("vendas");
  });
});

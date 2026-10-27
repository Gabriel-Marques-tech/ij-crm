import { describe, expect, it } from "vitest";
import {
  ESTADO_PADRAO,
  FILTROS_TABELA_VAZIOS,
  contarAtivosTabela,
  escreverEstado,
  lerEstado,
  paramsDeRegistro,
  proximaOrdem,
  type EstadoTabela,
} from "./params";

const ler = (qs: string) => lerEstado(new URLSearchParams(qs));

describe("lerEstado", () => {
  it("vazio → padrão (criado desc, página 1, sem filtros)", () => {
    expect(ler("")).toEqual(ESTADO_PADRAO);
    expect(ESTADO_PADRAO.ordem).toEqual({ coluna: "criado", dir: "desc" });
  });

  it("usa os mesmos nomes de parâmetro do Kanban onde coincidem", () => {
    const e = ler("resp=u1,u2&q=  acme &revisar=sim&acao=vencida,hoje&origem=RD,SEM&quadro=vendas");
    expect(e.filtros).toMatchObject({ resp: ["u1", "u2"], q: "acme", revisar: "sim", acao: ["vencida", "hoje"], origem: ["RD", "SEM"], quadro: ["vendas"] });
  });

  it("descarta valores fora da lista permitida e repetidos", () => {
    const e = ler("acao=vencida,xx,vencida&origem=RD,FOO&revisar=talvez&terminais=x&quadro=vendas,vendas");
    expect(e.filtros.acao).toEqual(["vencida"]);
    expect(e.filtros.origem).toEqual(["RD"]);
    expect(e.filtros.revisar).toBeNull();
    expect(e.filtros.terminais).toBeNull();
    expect(e.filtros.quadro).toEqual(["vendas"]);
  });

  it("fase, terminais e período", () => {
    const e = ler("fase=f1,f2&terminais=nao&de=2026-01-01&ate=2026-02-30");
    expect(e.filtros.fase).toEqual(["f1", "f2"]);
    expect(e.filtros.terminais).toBe("nao");
    expect(e.filtros.de).toBe("2026-01-01");
    // Data que o JS "rolaria" (30/02) é inválida.
    expect(e.filtros.ate).toBeNull();
  });

  it("ordem só de colunas permitidas; página inteira ≥ 1", () => {
    expect(ler("ordem=titulo&dir=asc").ordem).toEqual({ coluna: "titulo", dir: "asc" });
    expect(ler("ordem=senhaHash&dir=asc").ordem).toEqual(ESTADO_PADRAO.ordem);
    expect(ler("ordem=titulo&dir=lateral").ordem).toEqual({ coluna: "titulo", dir: "asc" });
    expect(ler("pagina=3").pagina).toBe(3);
    for (const p of ["0", "-2", "abc", "1.5", "99999999"]) expect(ler(`pagina=${p}`).pagina).toBe(1);
  });

  it("busca aparada e limitada a 100 caracteres", () => {
    expect(ler(`q=${"a".repeat(150)}`).filtros.q).toHaveLength(100);
  });
});

describe("escreverEstado", () => {
  it("ida e volta preserva o estado", () => {
    const e: EstadoTabela = {
      filtros: {
        ...FILTROS_TABELA_VAZIOS,
        quadro: ["vendas"],
        fase: ["f1"],
        resp: ["u1"],
        origem: ["SEM"],
        revisar: "nao",
        acao: ["semana", "sem"],
        de: "2026-01-01",
        ate: "2026-03-31",
        terminais: "sim",
        q: "50% off",
      },
      ordem: { coluna: "orcamento", dir: "asc" },
      pagina: 4,
    };
    expect(lerEstado(escreverEstado(e))).toEqual(e);
  });

  it("omite padrões (URL limpa) e mantém parâmetros alheios", () => {
    expect(escreverEstado(ESTADO_PADRAO).toString()).toBe("");
    const p = escreverEstado({ ...ESTADO_PADRAO, pagina: 2 }, new URLSearchParams("x=1&resp=velho"));
    expect(p.get("x")).toBe("1");
    expect(p.get("resp")).toBeNull();
    expect(p.get("pagina")).toBe("2");
  });
});

describe("contarAtivosTabela", () => {
  it("um por valor de lista; período conta uma vez cada ponta", () => {
    expect(contarAtivosTabela(FILTROS_TABELA_VAZIOS)).toBe(0);
    expect(contarAtivosTabela({ ...FILTROS_TABELA_VAZIOS, resp: ["a", "b"], de: "2026-01-01", ate: "2026-01-02", terminais: "nao", q: "x" })).toBe(6);
  });
});

describe("proximaOrdem", () => {
  it("mesma coluna alterna; coluna nova começa no sentido natural", () => {
    expect(proximaOrdem({ coluna: "titulo", dir: "asc" }, "titulo")).toEqual({ coluna: "titulo", dir: "desc" });
    expect(proximaOrdem({ coluna: "criado", dir: "desc" }, "titulo")).toEqual({ coluna: "titulo", dir: "asc" });
    expect(proximaOrdem({ coluna: "titulo", dir: "asc" }, "orcamento")).toEqual({ coluna: "orcamento", dir: "desc" });
  });
});

describe("paramsDeRegistro", () => {
  it("searchParams do Next (string | string[]) → URLSearchParams, primeira ocorrência", () => {
    const p = paramsDeRegistro({ q: ["a", "b"], resp: "u1", vazio: undefined });
    expect(p.get("q")).toBe("a");
    expect(p.get("resp")).toBe("u1");
    expect(p.has("vazio")).toBe(false);
  });
});

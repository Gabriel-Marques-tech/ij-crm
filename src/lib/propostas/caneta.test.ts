import { describe, expect, it } from "vitest";
import type { Area, StatusProposta } from "@prisma/client";
import {
  ACOES_CANETA,
  acoesPossiveis,
  estaComACaneta,
  outroLado,
  podeEditarProposta,
  recusaDaAcao,
  statusAoReceber,
  type EstadoCaneta,
  type Pessoa,
} from "./caneta";

const ana: Pessoa = { id: "ana", papel: "VENDEDOR", area: null, cargos: [], ativo: true };
const bia: Pessoa = { id: "bia", papel: "VENDEDOR", area: null, cargos: [], ativo: true };
const gpVendas: Pessoa = { id: "gv", papel: "VENDEDOR", area: "VENDAS", cargos: ["GP"], ativo: true };
const paula: Pessoa = { id: "paula", papel: "PROJETOS", area: null, cargos: [], ativo: true };
const pedro: Pessoa = { id: "pedro", papel: "PROJETOS", area: null, cargos: [], ativo: true };
const gpProjetos: Pessoa = { id: "gp", papel: "PROJETOS", area: "PROJETOS", cargos: ["GP"], ativo: true }; // GP legado em Projetos = PM
const pmProjetos: Pessoa = { id: "pm", papel: "PROJETOS", area: "PROJETOS", cargos: ["PM"], ativo: true };
const poProjetos: Pessoa = { id: "po", papel: "PROJETOS", area: "PROJETOS", cargos: ["PO"], ativo: true };
const diretorProjetos: Pessoa = { id: "dirp", papel: "GESTOR", area: "PROJETOS", cargos: ["DIRETOR"], ativo: true };
const gestor: Pessoa = { id: "gil", papel: "GESTOR", area: null, cargos: [], ativo: true };
const diretorVendas: Pessoa = { id: "dir", papel: "GESTOR", area: "VENDAS", cargos: [], ativo: true };
const vera: Pessoa = { id: "vera", papel: "VISUALIZADOR", area: null, cargos: [], ativo: true };

const estado = (e: Partial<EstadoCaneta> = {}): EstadoCaneta => ({ status: "RASCUNHO", canetaComId: "ana", canetaLado: "VENDAS", ...e });
const comProjetos = (e: Partial<EstadoCaneta> = {}) => estado({ status: "EM_ANALISE", canetaComId: "paula", canetaLado: "PROJETOS", ultimaVersaoLado: "VENDAS", ...e });

describe("caneta: quem edita", () => {
  it("só o dono da caneta, do lado dela, ativo e que escreve", () => {
    expect(podeEditarProposta(ana, estado())).toBe(true);
    expect(podeEditarProposta(bia, estado())).toBe(false);
    expect(podeEditarProposta(paula, estado())).toBe(false);
    expect(podeEditarProposta(gpVendas, estado())).toBe(false); // GP pega antes; não edita na mão de outro
    expect(podeEditarProposta(gestor, estado())).toBe(false); // gestão não age na caneta
    expect(podeEditarProposta(vera, estado({ canetaComId: "vera" }))).toBe(false);
    expect(podeEditarProposta({ ...ana, ativo: false }, estado())).toBe(false);
  });

  it("quem mudou de lado perde a caneta (o papel/área vale na hora)", () => {
    expect(estaComACaneta({ ...ana, papel: "PROJETOS" }, estado())).toBe(false);
  });

  it("gestor com lado (diretor que é de vendas) age como do lado", () => {
    expect(podeEditarProposta(diretorVendas, estado({ canetaComId: "dir" }))).toBe(true);
  });

  it("fora do pingue-pongue ninguém edita: pronta, enviada, inviável…", () => {
    for (const status of ["PRONTA_PARA_ENVIO", "ENVIADA", "ACEITA", "RECUSADA", "INVIAVEL"] as StatusProposta[]) {
      expect(podeEditarProposta(ana, estado({ status })), status).toBe(false);
    }
    // GAB-89: revisão pedida pelo cliente reabre a edição com vendas.
    for (const status of ["RASCUNHO", "EM_ANALISE", "EM_AJUSTE", "REVISAO_PEDIDA"] as StatusProposta[]) {
      expect(podeEditarProposta(ana, estado({ status })), status).toBe(true);
    }
  });

  it("lado null (dado antigo) conta como vendas: o pingue-pongue começa em vendas", () => {
    expect(podeEditarProposta(ana, estado({ canetaLado: null }))).toBe(true);
    expect(podeEditarProposta(paula, estado({ canetaLado: null, canetaComId: "paula" }))).toBe(false);
  });
});

describe("caneta: transições", () => {
  it("lados e status ao receber", () => {
    expect(outroLado("VENDAS")).toBe("PROJETOS");
    expect(outroLado("PROJETOS")).toBe("VENDAS");
    expect(statusAoReceber("PROJETOS")).toBe("EM_ANALISE");
    expect(statusAoReceber("VENDAS")).toBe("EM_AJUSTE");
  });

  describe("passar (mesmo lado)", () => {
    it("dono passa para alguém ativo do mesmo lado", () => {
      expect(recusaDaAcao("passar", ana, estado(), bia)).toBeNull();
      expect(recusaDaAcao("passar", ana, estado(), gpVendas)).toBeNull();
      expect(recusaDaAcao("passar", paula, comProjetos(), pedro)).toBeNull();
    });
    it("recusas: não é o dono, outro lado, si mesmo, inativo, visualizador, gestor sem lado", () => {
      expect(recusaDaAcao("passar", bia, estado(), ana)).toBe("SEM_CANETA");
      expect(recusaDaAcao("passar", gpVendas, estado(), bia)).toBe("SEM_CANETA");
      for (const alvo of [paula, ana, { ...bia, ativo: false }, vera, gestor, null]) {
        expect(recusaDaAcao("passar", ana, estado(), alvo)).toBe("DESTINO_MESMO_LADO");
      }
    });
    it("vale também com a proposta pronta para envio (vendas escolhe quem envia)", () => {
      expect(recusaDaAcao("passar", ana, estado({ status: "PRONTA_PARA_ENVIO" }), bia)).toBeNull();
    });
  });

  describe("devolver (outro lado)", () => {
    it("dono devolve para alguém do outro lado", () => {
      expect(recusaDaAcao("devolver", ana, estado(), paula)).toBeNull();
      expect(recusaDaAcao("devolver", paula, comProjetos(), bia)).toBeNull();
    });
    it("recusas: não é o dono (nem o GP sem pegar), mesmo lado, inativo, sem lado", () => {
      expect(recusaDaAcao("devolver", gpVendas, estado(), paula)).toBe("SEM_CANETA");
      expect(recusaDaAcao("devolver", gestor, estado(), paula)).toBe("SEM_CANETA");
      for (const alvo of [bia, { ...paula, ativo: false }, gestor, vera, null]) {
        expect(recusaDaAcao("devolver", ana, estado(), alvo)).toBe("DESTINO_OUTRO_LADO");
      }
    });
    it("pronta para envio: reabra antes", () => {
      expect(recusaDaAcao("devolver", ana, estado({ status: "PRONTA_PARA_ENVIO" }), paula)).toBe("PROPOSTA_PRONTA");
    });
  });

  describe("concordar", () => {
    it("só se a última versão veio do outro lado", () => {
      expect(recusaDaAcao("concordar", paula, comProjetos())).toBeNull();
      expect(recusaDaAcao("concordar", ana, estado({ status: "EM_AJUSTE", ultimaVersaoLado: "PROJETOS" }))).toBeNull();
      expect(recusaDaAcao("concordar", paula, comProjetos({ ultimaVersaoLado: "PROJETOS" }))).toBe("CONCORDAR_PROPRIA_VERSAO");
      expect(recusaDaAcao("concordar", ana, estado({ ultimaVersaoLado: "VENDAS" }))).toBe("CONCORDAR_PROPRIA_VERSAO");
      // versão antiga sem lado (gestão salvou no GAB-86): não é "do outro lado"
      expect(recusaDaAcao("concordar", paula, comProjetos({ ultimaVersaoLado: null }))).toBe("CONCORDAR_PROPRIA_VERSAO");
      expect(recusaDaAcao("concordar", ana, estado({ ultimaVersaoLado: undefined }))).toBe("CONCORDAR_SEM_VERSAO");
    });
    it("só o dono; nem gestor nem GP sem pegar", () => {
      expect(recusaDaAcao("concordar", pedro, comProjetos())).toBe("SEM_CANETA");
      expect(recusaDaAcao("concordar", gpProjetos, comProjetos())).toBe("SEM_CANETA");
      expect(recusaDaAcao("concordar", gestor, comProjetos())).toBe("SEM_CANETA");
    });
    it("pronta: já há consenso", () => {
      expect(recusaDaAcao("concordar", ana, estado({ status: "PRONTA_PARA_ENVIO", ultimaVersaoLado: "PROJETOS" }))).toBe("PROPOSTA_PRONTA");
    });
  });

  describe("pegar (GP do lado destrava)", () => {
    it("GP do lado da caneta pega, mesmo de ninguém", () => {
      expect(recusaDaAcao("pegar", gpVendas, estado())).toBeNull();
      expect(recusaDaAcao("pegar", gpVendas, estado({ canetaComId: null }))).toBeNull();
      expect(recusaDaAcao("pegar", gpProjetos, comProjetos())).toBeNull();
      expect(recusaDaAcao("pegar", gpVendas, estado({ status: "PRONTA_PARA_ENVIO" }))).toBeNull();
    });
    it("GP do outro lado, membro comum, gestor e visualizador não pegam", () => {
      for (const p of [gpProjetos, bia, gestor, diretorVendas, vera, { ...gpVendas, ativo: false }]) {
        expect(recusaDaAcao("pegar", p, estado()), p.id).toBe("SO_GP_PEGA");
      }
    });
    it("em Projetos quem pega é o PM (o GP legado também); PO e Diretor não", () => {
      expect(recusaDaAcao("pegar", pmProjetos, comProjetos())).toBeNull();
      expect(recusaDaAcao("pegar", pmProjetos, comProjetos({ canetaComId: null }))).toBeNull();
      expect(recusaDaAcao("pegar", gpProjetos, comProjetos())).toBeNull();
      expect(recusaDaAcao("pegar", pmProjetos, estado())).toBe("SO_GP_PEGA"); // caneta em vendas
      for (const p of [poProjetos, diretorProjetos, pedro]) expect(recusaDaAcao("pegar", p, comProjetos()), p.id).toBe("SO_GP_PEGA");
    });
    it("quem já está com ela", () => {
      expect(recusaDaAcao("pegar", gpVendas, estado({ canetaComId: "gv" }))).toBe("JA_COM_A_CANETA");
    });
  });

  describe("reabrir (pronta → em ajuste)", () => {
    it("só o dono e só se pronta", () => {
      const pronta = estado({ status: "PRONTA_PARA_ENVIO" });
      expect(recusaDaAcao("reabrir", ana, pronta)).toBeNull();
      expect(recusaDaAcao("reabrir", bia, pronta)).toBe("SEM_CANETA");
      expect(recusaDaAcao("reabrir", ana, estado())).toBe("REABRIR_SO_PRONTA");
    });
  });

  describe("inviável", () => {
    it("PM de projetos (sempre; GP legado idem) ou o dono da caneta do lado projetos", () => {
      expect(recusaDaAcao("inviavel", pmProjetos, estado())).toBeNull();
      expect(recusaDaAcao("inviavel", pmProjetos, comProjetos())).toBeNull();
      expect(recusaDaAcao("inviavel", gpProjetos, estado())).toBeNull();
      expect(recusaDaAcao("inviavel", gpProjetos, comProjetos())).toBeNull();
      expect(recusaDaAcao("inviavel", paula, comProjetos())).toBeNull();
      expect(recusaDaAcao("inviavel", gpProjetos, estado({ status: "PRONTA_PARA_ENVIO" }))).toBeNull();
    });
    it("vendas (nem o dono), outro de projetos sem caneta, gestor: não", () => {
      expect(recusaDaAcao("inviavel", ana, estado())).toBe("INVIAVEL_SEM_PERMISSAO");
      expect(recusaDaAcao("inviavel", gpVendas, estado())).toBe("INVIAVEL_SEM_PERMISSAO");
      expect(recusaDaAcao("inviavel", pedro, comProjetos())).toBe("INVIAVEL_SEM_PERMISSAO");
      expect(recusaDaAcao("inviavel", paula, estado())).toBe("INVIAVEL_SEM_PERMISSAO");
      expect(recusaDaAcao("inviavel", gestor, comProjetos())).toBe("INVIAVEL_SEM_PERMISSAO");
      // PO e Diretor: nenhuma permissão nova na caneta
      expect(recusaDaAcao("inviavel", poProjetos, estado())).toBe("INVIAVEL_SEM_PERMISSAO");
      expect(recusaDaAcao("inviavel", diretorProjetos, comProjetos())).toBe("INVIAVEL_SEM_PERMISSAO");
    });
  });

  it("proposta encerrada (aceita, recusada, inviável): nenhuma ação de caneta", () => {
    for (const status of ["ACEITA", "RECUSADA", "INVIAVEL"] as StatusProposta[]) {
      for (const acao of ACOES_CANETA) {
        expect(recusaDaAcao(acao, gpProjetos, estado({ status, canetaComId: "gp", canetaLado: "PROJETOS" as Area }), pedro), `${status}/${acao}`).toBe("PROPOSTA_ENCERRADA");
      }
    }
  });

  it("enviada (GAB-89): com o cliente — só passar (para outro vendedor) e o GP pegar", () => {
    const enviada = estado({ status: "ENVIADA", ultimaVersaoLado: "PROJETOS" });
    expect(acoesPossiveis(ana, enviada)).toEqual(["passar"]);
    expect(acoesPossiveis(gpVendas, enviada)).toEqual(["pegar"]);
    expect(acoesPossiveis(gpProjetos, enviada)).toEqual([]);
    expect(recusaDaAcao("devolver", ana, enviada)).toBe("PROPOSTA_COM_O_CLIENTE");
    expect(recusaDaAcao("concordar", ana, enviada)).toBe("PROPOSTA_COM_O_CLIENTE");
    expect(recusaDaAcao("inviavel", gpProjetos, enviada)).toBe("PROPOSTA_COM_O_CLIENTE");
    expect(recusaDaAcao("reabrir", ana, enviada)).toBe("REABRIR_SO_PRONTA");
  });

  it("revisão pedida (GAB-89): o pingue-pongue reabre com vendas", () => {
    const rev = estado({ status: "REVISAO_PEDIDA", ultimaVersaoLado: "PROJETOS" });
    expect(acoesPossiveis(ana, rev)).toEqual(["passar", "devolver", "concordar"]);
    expect(acoesPossiveis(gpProjetos, rev)).toEqual(["inviavel"]);
  });

  it("acoesPossiveis: o que a tela e o MCP oferecem a cada um", () => {
    expect(acoesPossiveis(ana, estado())).toEqual(["passar", "devolver"]);
    expect(acoesPossiveis(ana, estado({ status: "EM_AJUSTE", ultimaVersaoLado: "PROJETOS" }))).toEqual(["passar", "devolver", "concordar"]);
    expect(acoesPossiveis(paula, comProjetos())).toEqual(["passar", "devolver", "concordar", "inviavel"]);
    expect(acoesPossiveis(gpVendas, estado())).toEqual(["pegar"]);
    expect(acoesPossiveis(gpProjetos, estado())).toEqual(["inviavel"]);
    expect(acoesPossiveis(ana, estado({ status: "PRONTA_PARA_ENVIO" }))).toEqual(["passar", "reabrir"]);
    expect(acoesPossiveis(gestor, comProjetos())).toEqual([]);
    expect(acoesPossiveis(vera, comProjetos())).toEqual([]);
  });
});

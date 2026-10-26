import { describe, expect, it } from "vitest";
import { canonico, mapeamentoPadrao, resolverResponsavel, validarMapeamento, type FaseCrm } from "./mapeamento";

const crm: FaseCrm[] = [
  { id: "f-pc", chave: "primeiro_contato", nome: "Primeiro Contato", pipelineChave: "vendas", pipelineNome: "Vendas", tipoTerminal: null },
  { id: "f-rd", chave: "reuniao_diagnostica", nome: "Reunião Diagnóstica", pipelineChave: "vendas", pipelineNome: "Vendas", tipoTerminal: null },
  { id: "f-ca", chave: "contrato_assinado", nome: "Contrato assinado", pipelineChave: "vendas", pipelineNome: "Vendas", tipoTerminal: "GANHO" },
  { id: "p-fin", chave: "finalizado", nome: "Finalizado", pipelineChave: "projetos", pipelineNome: "Projetos", tipoTerminal: "GANHO" },
  { id: "v-fin", chave: "finalizado", nome: "Finalizado", pipelineChave: "vendas", pipelineNome: "Vendas", tipoTerminal: null },
];
const pipefy = [
  { chave: "primeiro contato", nome: "Primeiro Contato", cardsAtuais: 1 },
  { chave: "reuniao diagnostica", nome: "Reunião Diagnóstica", cardsAtuais: 1 },
  { chave: "contrato assinado", nome: "Contrato assinado", cardsAtuais: 1 },
  { chave: "finalizado", nome: "Finalizado", cardsAtuais: 1 },
  { chave: "backlog antigo", nome: "Backlog antigo", cardsAtuais: 1 },
];

describe("mapeamentoPadrao", () => {
  it("casa por nome normalizado; vendas ganha empate; desconhecida → null", () => {
    expect(mapeamentoPadrao(pipefy, crm)).toEqual({
      "primeiro contato": "f-pc",
      "reuniao diagnostica": "f-rd",
      "contrato assinado": "f-ca",
      finalizado: "v-fin",
      "backlog antigo": null,
    });
  });
});

describe("validarMapeamento", () => {
  it("aceita ids válidos e null; completa ausentes com null", () => {
    expect(validarMapeamento({ "backlog antigo": "f-pc", finalizado: "p-fin" }, pipefy, crm)).toEqual({
      ok: true,
      mapeamento: { "primeiro contato": null, "reuniao diagnostica": null, "contrato assinado": null, finalizado: "p-fin", "backlog antigo": "f-pc" },
    });
  });
  it("recusa fase fora do arquivo, id desconhecido e não-objeto", () => {
    expect(validarMapeamento({ outra: "f-pc" }, pipefy, crm).ok).toBe(false);
    expect(validarMapeamento({ finalizado: "x" }, pipefy, crm).ok).toBe(false);
    expect(validarMapeamento([], pipefy, crm).ok).toBe(false);
    expect(validarMapeamento(JSON.parse('{"__proto__":"f-pc"}'), pipefy, crm).ok).toBe(false);
  });
  it("canonico independe da ordem", () => {
    expect(canonico({ b: "1", a: null })).toBe(canonico({ a: null, b: "1" }));
  });
});

describe("resolverResponsavel", () => {
  const us = [
    { id: "u1", nome: "Ana Souza", email: "ana@ij.test" },
    { id: "u2", nome: "Bruno Lima", email: "bruno@ij.test" },
    { id: "u3", nome: "Bruno Lima", email: "bruno2@ij.test" },
  ];
  it("nome exato normalizado, email exato; ambíguo/desconhecido → null", () => {
    expect(resolverResponsavel("ana  SOUZA", us)?.id).toBe("u1");
    expect(resolverResponsavel("Bruno2@IJ.test", us)?.id).toBe("u3");
    expect(resolverResponsavel("Bruno Lima", us)).toBeNull();
    expect(resolverResponsavel("Ana", us)).toBeNull();
    expect(resolverResponsavel(null, us)).toBeNull();
  });
});

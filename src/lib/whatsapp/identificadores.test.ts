import { describe, expect, it } from "vitest";
import { extrairIdentificadores } from "./identificadores";

describe("extrairIdentificadores", () => {
  it("telefone sem DDI (texto digitado), email e CNPJ alfanumérico", () => {
    const r = extrairIdentificadores(
      "#crm falei com a Ana (11) 98888-7777, ana@Acme.com.br, CNPJ 12.ABC.345/01DE-35, orçamento 15.000",
    );
    expect(r.telefones).toEqual(["+5511988887777"]);
    expect(r.emails).toEqual(["ana@acme.com.br"]);
    expect(r.cnpjs).toEqual(["12ABC34501DE35"]);
  });

  it("dígitos do CNPJ não viram telefone; valores e datas não viram telefone", () => {
    const r = extrairIdentificadores("cnpj 11.222.333/0001-81 orçamento R$ 150.000 sexta 31/10 às 14h");
    expect(r.cnpjs).toEqual(["11222333000181"]);
    expect(r.telefones).toEqual([]);
  });

  it("com DDI e formatos variados; repetidos contam uma vez", () => {
    const r = extrairIdentificadores("+55 21 99999-0000 ou 21999990000 ou 5521 3333-4444");
    expect(r.telefones).toEqual(["+5521999990000", "+552133334444"]);
  });

  it("CNPJ com DV errado e telefone sem DDD são ignorados", () => {
    const r = extrairIdentificadores("cnpj 11.222.333/0001-99, tel 98888-7777");
    expect(r).toEqual({ telefones: [], emails: [], cnpjs: [] });
  });
});

import { describe, expect, it } from "vitest";
import { ehDominioPublico, normalizarCnpj, normalizarDominio, normalizarEmail, normalizarTelefoneBr, normalizarPonto } from "./normalizacao";

describe("normalizarEmail", () => {
  it("lowercase + trim", () => {
    expect(normalizarEmail("  Joao.Silva@IntelIJunior.com ")).toBe("joao.silva@intelijunior.com");
  });

  it("rejeita sem @ ou vazio", () => {
    expect(normalizarEmail("joao")).toBeNull();
    expect(normalizarEmail("   ")).toBeNull();
  });

  it("rejeita formas quebradas: '@', 'a@', '@b', sem domínio, com espaço", () => {
    for (const e of ["@", "a@", "@b", "a@b", "a b@c.com", "a@c .com"]) expect(normalizarEmail(e)).toBeNull();
  });
});

describe("normalizarTelefoneBr", () => {
  it.each([
    ["11 99999-8888", "+5511999998888"],
    ["(11) 99999-8888", "+5511999998888"],
    ["5511999998888", "+5511999998888"],
    ["+55 11 99999-8888", "+5511999998888"],
    ["011999998888", "+5511999998888"],
  ])("%s → %s", (entrada, esperado) => {
    expect(normalizarTelefoneBr(entrada)).toBe(esperado);
  });

  it("aceita fixo com 8 dígitos", () => {
    expect(normalizarTelefoneBr("11 3333-4444")).toBe("+551133334444");
  });

  it("rejeita número curto ou DDD inválido", () => {
    expect(normalizarTelefoneBr("99999-8888")).toBeNull();
    expect(normalizarTelefoneBr("00 99999-8888")).toBeNull();
    expect(normalizarTelefoneBr("")).toBeNull();
  });

  it("rejeita DDI que não seja +55", () => {
    expect(normalizarTelefoneBr("+1 555 123 4567")).toBeNull();
    expect(normalizarTelefoneBr("+351 912 345 678")).toBeNull();
  });

  it("é idempotente", () => {
    const n = normalizarTelefoneBr("11999998888")!;
    expect(normalizarTelefoneBr(n)).toBe(n);
  });
});

describe("normalizarTelefoneBr — nono dígito", () => {
  it.each([
    ["11 9999-8888", "+5511999998888"],
    ["+55 11 9999-8888", "+5511999998888"],
    ["551199998888", "+5511999998888"],
    ["(21) 8888-7777", "+5521988887777"],
    ["011 7777-6666", "+5511977776666"],
  ])("celular sem o 9 (%s) ganha o 9 → %s", (entrada, esperado) => {
    expect(normalizarTelefoneBr(entrada)).toBe(esperado);
  });

  it("com e sem o 9 chegam ao mesmo valor", () => {
    const variantes = ["11 99999-8888", "11 9999-8888", "+5511999998888", "5511999998888", "551199998888", "+55 (11) 9999-8888"];
    expect(new Set(variantes.map(normalizarTelefoneBr))).toEqual(new Set(["+5511999998888"]));
  });

  it("fixo (começa com 2–5) nunca ganha o 9", () => {
    expect(normalizarTelefoneBr("11 2222-3333")).toBe("+551122223333");
    expect(normalizarTelefoneBr("+55 31 5555-4444")).toBe("+553155554444");
  });

  it("rejeita 11 dígitos locais que não comecem com 9 (não é celular)", () => {
    expect(normalizarTelefoneBr("11 89999-8888")).toBeNull();
  });

  it("rejeita DDD que não existe (ex.: 20, 23, 30)", () => {
    expect(normalizarTelefoneBr("20 99999-8888")).toBeNull();
    expect(normalizarTelefoneBr("30 99999-8888")).toBeNull();
  });
});

describe("normalizarCnpj", () => {
  it.each([
    ["11.222.333/0001-81", "11222333000181"],
    ["11222333000181", "11222333000181"],
    ["  11 222 333 0001 81 ", "11222333000181"],
    ["12.abc.345/01de-35", "12ABC34501DE35"],
    ["12ABC34501DE35", "12ABC34501DE35"],
  ])("%s → %s", (entrada, esperado) => {
    expect(normalizarCnpj(entrada)).toBe(esperado);
  });

  it("mantém letras (formato alfanumérico de 2026): nunca remove tudo que não é dígito", () => {
    expect(normalizarCnpj("12.ABC.345/01DE-35")).toMatch(/[A-Z]/);
  });

  it("rejeita dígito verificador errado", () => {
    expect(normalizarCnpj("11.222.333/0001-82")).toBeNull();
    expect(normalizarCnpj("12.ABC.345/01DE-36")).toBeNull();
  });

  it("rejeita tamanho errado, letra no DV e caracteres repetidos", () => {
    expect(normalizarCnpj("1122233300018")).toBeNull();
    expect(normalizarCnpj("112223330001811")).toBeNull();
    expect(normalizarCnpj("12ABC34501DEAB")).toBeNull();
    expect(normalizarCnpj("00.000.000/0000-00")).toBeNull();
    expect(normalizarCnpj("")).toBeNull();
  });

  it("rejeita símbolos fora da pontuação usual", () => {
    expect(normalizarCnpj("11#222333000181")).toBeNull();
    expect(normalizarCnpj("1122233300018ç")).toBeNull();
  });
});

describe("normalizarDominio", () => {
  it.each([
    ["joao@Acme.com.br", "acme.com.br"],
    ["  Maria.Silva@WWW.Acme.COM ", "acme.com"],
    ["https://www.acme.com.br/contato?x=1", "acme.com.br"],
    ["http://Acme.com:8080", "acme.com"],
    ["www.acme.com", "acme.com"],
    ["acme.com.", "acme.com"],
    ["ACME.io/", "acme.io"],
    ["sub.acme.com.br", "sub.acme.com.br"],
  ])("%s → %s", (entrada, esperado) => {
    expect(normalizarDominio(entrada)).toBe(esperado);
  });

  it("rejeita entradas sem domínio válido", () => {
    for (const e of ["", "acme", "joao@", "http://", "a b.com", "-acme.com", "acme..com", "acme.c0m1"]) expect(normalizarDominio(e)).toBeNull();
  });

  it("é idempotente", () => {
    expect(normalizarDominio(normalizarDominio("https://www.Acme.com.br")!)).toBe("acme.com.br");
  });
});

describe("ehDominioPublico", () => {
  it("provedores de email genéricos não identificam empresa", () => {
    expect(ehDominioPublico("gmail.com")).toBe(true);
    expect(ehDominioPublico("hotmail.com.br")).toBe(true);
    expect(ehDominioPublico("acme.com.br")).toBe(false);
  });
});

describe("normalizarPonto", () => {
  it("decide o tipo pela forma: com @ é email, senão telefone", () => {
    expect(normalizarPonto(" Ana@Acme.com ")).toEqual({ tipo: "EMAIL", valorNormalizado: "ana@acme.com" });
    expect(normalizarPonto("11 9999-8888")).toEqual({ tipo: "TELEFONE", valorNormalizado: "+5511999998888" });
  });

  it("respeita o tipo pedido e devolve null quando não normaliza", () => {
    expect(normalizarPonto("11 9999-8888", "EMAIL")).toBeNull();
    expect(normalizarPonto("ana@acme.com", "TELEFONE")).toBeNull();
    expect(normalizarPonto("oi")).toBeNull();
  });
});

describe("review: email com embrulho", () => {
  it.each([
    ["ana@acme.com.", "ana@acme.com"],
    ["<ana@acme.com>", "ana@acme.com"],
    ["ana@acme.com,", "ana@acme.com"],
    ['"Ana@Acme.com";', "ana@acme.com"],
    ["ana@ação.com.br", "ana@xn--ao-siap.com.br"],
  ])("%s → %s", (entrada, esperado) => {
    expect(normalizarEmail(entrada)).toBe(esperado);
  });

  it("rejeita TLD não alfabético e <>,; no meio", () => {
    for (const e of ["ana@acme.c0m", "ana@acme.123", "a<b@acme.com", "ana,bia@acme.com", "ana@ac;me.com", "a@b@acme.com"]) expect(normalizarEmail(e)).toBeNull();
  });
});

describe("review: telefone", () => {
  it("5551234567: BR por padrão (fixo de POA); exigindo DDI é inválido", () => {
    expect(normalizarTelefoneBr("5551234567")).toBe("+555551234567");
    expect(normalizarTelefoneBr("5551234567", { exigirDdi: true })).toBeNull();
    expect(normalizarTelefoneBr("5511999998888", { exigirDdi: true })).toBe("+5511999998888");
    expect(normalizarTelefoneBr("11999998888", { exigirDdi: true })).toBeNull();
  });

  it("assinante começando com 0/1 é inválido; celular de 9 dígitos é 9[6-9]", () => {
    expect(normalizarTelefoneBr("11 0000-0031")).toBeNull();
    expect(normalizarTelefoneBr("11 1234-5678")).toBeNull();
    expect(normalizarTelefoneBr("11 90000-0031")).toBeNull();
    expect(normalizarTelefoneBr("11 95000-0000")).toBeNull();
    expect(normalizarTelefoneBr("11 96000-0000")).toBe("+5511960000000");
  });
});

describe("review: domínio IDN e provedores", () => {
  it("IDN vira punycode, igual para empresa e email", () => {
    expect(normalizarDominio("https://www.Ação.com.br")).toBe("xn--ao-siap.com.br");
    expect(normalizarDominio("ana@ação.com.br")).toBe(normalizarEmail("ana@ação.com.br")!.split("@")[1]);
  });

  it("lista ampliada e famílias multi-TLD", () => {
    for (const d of ["live.com.br", "msn.com.br", "ymail.com", "rocketmail.com", "zoho.com", "mail.com", "gmx.de", "gmx.net", "yandex.ru", "yahoo.co.uk"]) {
      expect(ehDominioPublico(d)).toBe(true);
    }
    expect(ehDominioPublico("live.acme.com")).toBe(false);
    expect(ehDominioPublico("gmxacme.com.br")).toBe(false);
  });
});

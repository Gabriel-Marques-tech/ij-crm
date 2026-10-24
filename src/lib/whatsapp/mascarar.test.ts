import { describe, expect, it } from "vitest";
import { mascararJid, mascararTelefone } from "./mascarar";

describe("mascararTelefone", () => {
  it("mantém DDI e os 2 últimos dígitos", () => {
    expect(mascararTelefone("+5511999998888")).toBe("+55*********88");
    expect(mascararTelefone("5511999998888")).toBe("+55*********88");
  });

  it("número estrangeiro: mantém só os 2 últimos", () => {
    expect(mascararTelefone("+351912345678")).toBe("+**********78");
  });

  it("curto demais → tudo mascarado", () => {
    expect(mascararTelefone("123")).toBe("***");
    expect(mascararTelefone("")).toBe("");
  });
});

describe("mascararJid", () => {
  it("telefone@s.whatsapp.net mascara a parte local como telefone", () => {
    expect(mascararJid("5511999998888@s.whatsapp.net")).toBe("+55*********88@s.whatsapp.net");
  });

  it("grupo e lid: mantém 2 primeiros e 2 últimos", () => {
    expect(mascararJid("120363000000000001@g.us")).toBe("12**************01@g.us");
    expect(mascararJid("123456789012345@lid")).toBe("12***********45@lid");
  });

  it("sem @ → mascara como telefone", () => {
    expect(mascararJid("+5511999998888")).toBe("+55*********88");
  });
});

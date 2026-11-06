import { describe, expect, it } from "vitest";
import { hrefAviso, jidPrivado, textoWhatsapp, vaiPorWhatsapp } from "./regras";

describe("regras dos avisos", () => {
  it("só 'é sua vez' e 'aceita/handoff' vão ao WhatsApp privado (spec §4.11)", () => {
    expect(vaiPorWhatsapp("SUA_VEZ")).toBe(true);
    expect(vaiPorWhatsapp("PROPOSTA_ACEITA")).toBe(true);
    expect(vaiPorWhatsapp("HANDOFF")).toBe(true);
    expect(vaiPorWhatsapp("CHECKIN_ATRASADO")).toBe(false);
    expect(vaiPorWhatsapp("GP_TROCADO")).toBe(false);
    expect(vaiPorWhatsapp("CANETA_PEGA")).toBe(false);
    expect(vaiPorWhatsapp("STATUS_PROPOSTA")).toBe(false);
    expect(vaiPorWhatsapp("COMENTARIO")).toBe(false);
  });

  it("link: aba da proposta; handoff abre o projeto; sem projeto, sem link", () => {
    expect(hrefAviso({ tipo: "SUA_VEZ", projetoId: "p1" })).toBe("/projetos/p1/proposta");
    expect(hrefAviso({ tipo: "COMENTARIO", projetoId: "p1" })).toBe("/projetos/p1/proposta");
    expect(hrefAviso({ tipo: "HANDOFF", projetoId: "p1" })).toBe("/projetos/p1");
    expect(hrefAviso({ tipo: "CHECKIN_ATRASADO", projetoId: "p1" })).toBe("/projetos/p1");
    expect(hrefAviso({ tipo: "GP_TROCADO", projetoId: "p1" })).toBe("/projetos/p1");
    expect(hrefAviso({ tipo: "TAREFA_ATRIBUIDA", projetoId: "p1" })).toBe("/projetos/p1/tarefas");
    expect(hrefAviso({ tipo: "EQUIPE_PROJETO", projetoId: "p1" })).toBe("/projetos/p1/equipe");
    expect(hrefAviso({ tipo: "LEMBRETE_GG", projetoId: null })).toBe("/gg/agenda");
    expect(vaiPorWhatsapp("TAREFA_ATRIBUIDA")).toBe(false);
    expect(vaiPorWhatsapp("LEMBRETE_GG")).toBe(false);
    expect(hrefAviso({ tipo: "SUA_VEZ", projetoId: null })).toBeNull();
  });

  it("JID privado a partir do telefone E.164 gravado no usuário", () => {
    expect(jidPrivado("+5511999998888")).toBe("5511999998888@s.whatsapp.net");
  });

  it("texto do WhatsApp: título + link absoluto quando há", () => {
    expect(textoWhatsapp("É sua vez", "https://crm.ij/projetos/p1/proposta")).toBe("🖊️ CRM IJ: É sua vez\nhttps://crm.ij/projetos/p1/proposta");
    expect(textoWhatsapp("É sua vez", null)).toBe("🖊️ CRM IJ: É sua vez");
  });
});

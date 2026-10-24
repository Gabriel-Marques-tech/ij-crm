import { describe, expect, it } from "vitest";
import { fixtureEvolution, GRUPO_FIXTURE } from "@/test/fixtures/evolution";
import { identificarParticipante, interpretarPayload, temTagCrm } from "./payload";

describe("temTagCrm", () => {
  it.each([
    "#crm falei com o Gustavo",
    "falei com o Gustavo #crm",
    "falei #CRM com o Gustavo",
    "resumo:\n#Crm proposta enviada",
    "(#crm) fechou",
    "#crm.",
  ])("reconhece em %j", (t) => {
    expect(temTagCrm(t)).toBe(true);
  });

  it.each(["#crmx", "#crm2", "email#crm", "crm sem cerquilha", "##crm", "#cr m", ""])("rejeita %j", (t) => {
    expect(temTagCrm(t)).toBe(false);
  });
});

describe("identificarParticipante", () => {
  it("telefone BR em JID @s.whatsapp.net → E.164", () => {
    expect(identificarParticipante("5511999998888@s.whatsapp.net")).toEqual({
      telefone: "+5511999998888",
      lid: null,
    });
  });

  it("@lid → lid completo, sem telefone", () => {
    expect(identificarParticipante("123456789012345@lid")).toEqual({ telefone: null, lid: "123456789012345@lid" });
  });

  it("@lid com participantAlt por telefone → os dois", () => {
    expect(identificarParticipante("123456789012345@lid", "5511999998888@s.whatsapp.net")).toEqual({
      telefone: "+5511999998888",
      lid: "123456789012345@lid",
    });
  });

  it("telefone estrangeiro não vira BR: guarda +dígitos crus", () => {
    expect(identificarParticipante("351912345678@s.whatsapp.net")).toEqual({ telefone: "+351912345678", lid: null });
  });

  it("ausente/vazio → nada", () => {
    expect(identificarParticipante(undefined)).toEqual({ telefone: null, lid: null });
    expect(identificarParticipante("")).toEqual({ telefone: null, lid: null });
  });
});

describe("interpretarPayload", () => {
  it("texto no grupo → PROCESSAR com remetente por telefone", () => {
    const r = interpretarPayload(fixtureEvolution("texto-grupo"), GRUPO_FIXTURE);
    expect(r).toEqual({
      tipo: "PROCESSAR",
      mensagem: {
        eventoId: "3EB0A1B2C3D4E5F60001",
        grupoJid: GRUPO_FIXTURE,
        remetente: { telefone: "+5511999998888", lid: null },
        participantJid: "5511999998888@s.whatsapp.net",
        texto: "#crm falei com o Gustavo da Economia Sensata, mando proposta sexta",
        respondendoEventoId: null,
        recebidaEm: new Date(1761307200 * 1000),
      },
    });
  });

  it("reply → texto do extendedTextMessage e respondendoEventoId = stanzaId", () => {
    const r = interpretarPayload(fixtureEvolution("resposta-grupo"), GRUPO_FIXTURE);
    expect(r.tipo).toBe("PROCESSAR");
    if (r.tipo !== "PROCESSAR") return;
    expect(r.mensagem.texto).toBe("é da Economia Sensata #CRM");
    expect(r.mensagem.respondendoEventoId).toBe("3EB0A1B2C3D4E5F60001");
  });

  it("reply sem contextInfo dentro da mensagem usa o data.contextInfo", () => {
    const p = fixtureEvolution("resposta-grupo");
    const data = p.data as { message: { extendedTextMessage: { contextInfo?: unknown } } };
    delete data.message.extendedTextMessage.contextInfo;
    const r = interpretarPayload(p, GRUPO_FIXTURE);
    expect(r.tipo === "PROCESSAR" && r.mensagem.respondendoEventoId).toBe("3EB0A1B2C3D4E5F60001");
  });

  it("participante @lid → remetente.lid", () => {
    const r = interpretarPayload(fixtureEvolution("participante-lid"), GRUPO_FIXTURE);
    expect(r.tipo === "PROCESSAR" && r.mensagem.remetente).toEqual({ telefone: null, lid: "123456789012345@lid" });
  });

  it("messageTimestamp como string também vira Date", () => {
    const p = fixtureEvolution("texto-grupo");
    (p.data as { messageTimestamp: unknown }).messageTimestamp = "1761307200";
    const r = interpretarPayload(p, GRUPO_FIXTURE);
    expect(r.tipo === "PROCESSAR" && r.mensagem.recebidaEm).toEqual(new Date(1761307200 * 1000));
  });

  it.each([
    ["from-me", "FROM_ME"],
    ["imagem", "SEM_TEXTO"],
    ["outro-evento", "EVENTO_DIFERENTE"],
    ["outro-chat", "OUTRO_CHAT"],
  ] as const)("%s → IGNORAR (%s)", (nome, motivo) => {
    expect(interpretarPayload(fixtureEvolution(nome), GRUPO_FIXTURE)).toEqual({ tipo: "IGNORAR", motivo });
  });

  it("grupo diferente do configurado → OUTRO_CHAT (mesmo sendo @g.us)", () => {
    expect(interpretarPayload(fixtureEvolution("texto-grupo"), "120363999999999999@g.us")).toEqual({
      tipo: "IGNORAR",
      motivo: "OUTRO_CHAT",
    });
  });

  it("texto vazio/só espaço → SEM_TEXTO", () => {
    const p = fixtureEvolution("texto-grupo");
    (p.data as { message: { conversation: string } }).message.conversation = "   ";
    expect(interpretarPayload(p, GRUPO_FIXTURE)).toEqual({ tipo: "IGNORAR", motivo: "SEM_TEXTO" });
  });

  it.each([null, "texto", 42, {}, { event: "messages.upsert" }, { event: "messages.upsert", data: { key: {} } }])(
    "payload sem forma (%j) → PAYLOAD_INVALIDO",
    (p) => {
      expect(interpretarPayload(p, GRUPO_FIXTURE)).toEqual({ tipo: "IGNORAR", motivo: "PAYLOAD_INVALIDO" });
    },
  );
});

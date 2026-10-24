import { describe, expect, it } from "vitest";
import { fixtureEvolution, GRUPO_FIXTURE } from "@/test/fixtures/evolution";
import { desembrulharConteudo, identificarParticipante, interpretarPayload, temTagCrm } from "./payload";

describe("temTagCrm", () => {
  it.each([
    "#crm falei com o Gustavo",
    "falei com o Gustavo #crm",
    "falei #CRM com o Gustavo",
    "resumo:\n#Crm proposta enviada",
    "#crm.",
    "#crm,",
    "fechou! #crm!",
    "_#crm_ em itálico",
    "*#crm* em negrito",
    "~#crm~ riscado",
    "\t#crm com tab",
  ])("reconhece em %j", (t) => {
    expect(temTagCrm(t)).toBe(true);
  });

  it.each([
    "#crmx",
    "#crm2",
    "#crm-leads",
    "email#crm",
    "foo#crm",
    "crm sem cerquilha",
    "##crm",
    "#cr m",
    "https://x.com/#crm-leads",
    "https://x.com/#crm",
    "https://x.com/?x#crm",
    "(#crm)",
    "",
  ])("rejeita %j", (t) => {
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

describe("desembrulharConteudo", () => {
  it("efêmera, view-once e edição → conteúdo interno", () => {
    expect(desembrulharConteudo({ ephemeralMessage: { message: { conversation: "a" } } })).toEqual({ conversation: "a" });
    expect(desembrulharConteudo({ viewOnceMessageV2: { message: { imageMessage: {} } } })).toEqual({ imageMessage: {} });
    expect(
      desembrulharConteudo({
        editedMessage: { message: { protocolMessage: { type: "MESSAGE_EDIT", editedMessage: { conversation: "b" } } } },
      }),
    ).toEqual({ conversation: "b" });
  });

  it("envelopes aninhados e sem envelope", () => {
    expect(desembrulharConteudo({ ephemeralMessage: { message: { viewOnceMessage: { message: { conversation: "c" } } } } })).toEqual({
      conversation: "c",
    });
    expect(desembrulharConteudo({ conversation: "d" })).toEqual({ conversation: "d" });
    expect(desembrulharConteudo(undefined)).toBeUndefined();
  });

  it("documentWithCaptionMessage → documentMessage (mídia, sem texto)", () => {
    expect(desembrulharConteudo({ documentWithCaptionMessage: { message: { documentMessage: { caption: "#crm" } } } })).toEqual({
      documentMessage: { caption: "#crm" },
    });
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

  it("participantAlt → lid e telefone; participantJid continua sendo o @lid", () => {
    const r = interpretarPayload(fixtureEvolution("participant-alt"), GRUPO_FIXTURE);
    expect(r.tipo).toBe("PROCESSAR");
    if (r.tipo !== "PROCESSAR") return;
    expect(r.mensagem.remetente).toEqual({ telefone: "+5511999998888", lid: "123456789012345@lid" });
    expect(r.mensagem.participantJid).toBe("123456789012345@lid");
  });

  it("mensagem efêmera → texto do envelope interno (com stanzaId)", () => {
    const r = interpretarPayload(fixtureEvolution("efemera"), GRUPO_FIXTURE);
    expect(r.tipo).toBe("PROCESSAR");
    if (r.tipo !== "PROCESSAR") return;
    expect(r.mensagem.texto).toBe("#crm reunião com a Padaria Central confirmada (mensagem temporária)");
    expect(r.mensagem.respondendoEventoId).toBe("3EB0A1B2C3D4E5F60003");
  });

  it("mensagem editada → texto novo, key.id da edição", () => {
    const r = interpretarPayload(fixtureEvolution("editada"), GRUPO_FIXTURE);
    expect(r.tipo).toBe("PROCESSAR");
    if (r.tipo !== "PROCESSAR") return;
    expect(r.mensagem.texto).toBe("#crm falei com o Gustavo da Economia Sensata, mando proposta QUINTA");
    expect(r.mensagem.eventoId).toBe("3EB0A1B2C3D4E5F60009");
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

  it("documento com legenda → SEM_TEXTO (mídia)", () => {
    const p = fixtureEvolution("texto-grupo");
    (p.data as { message: unknown }).message = {
      documentWithCaptionMessage: { message: { documentMessage: { caption: "#crm proposta.pdf", mimetype: "application/pdf" } } },
    };
    expect(interpretarPayload(p, GRUPO_FIXTURE)).toEqual({ tipo: "IGNORAR", motivo: "SEM_TEXTO" });
  });

  it.each([null, "texto", 42, {}, { event: "messages.upsert" }, { event: "messages.upsert", data: { key: {} } }])(
    "payload sem forma (%j) → PAYLOAD_INVALIDO com caminhos, sem valores",
    (p) => {
      const r = interpretarPayload(p, GRUPO_FIXTURE);
      expect(r).toMatchObject({ tipo: "IGNORAR", motivo: "PAYLOAD_INVALIDO" });
      if (r.tipo === "IGNORAR" && r.motivo === "PAYLOAD_INVALIDO") expect(r.caminhos.length).toBeGreaterThan(0);
    },
  );

  it("caminhos apontam o campo errado (ex.: key.id ausente) e nunca o conteúdo", () => {
    const p = fixtureEvolution("texto-grupo");
    delete (p.data as { key: { id?: string } }).key.id;
    const r = interpretarPayload(p, GRUPO_FIXTURE);
    expect(r).toEqual({ tipo: "IGNORAR", motivo: "PAYLOAD_INVALIDO", caminhos: ["data.key.id"] });
  });

  it("conversation com tipo errado → PAYLOAD_INVALIDO em data.message.conversation", () => {
    const p = fixtureEvolution("texto-grupo");
    (p.data as { message: { conversation: unknown } }).message.conversation = 42;
    expect(interpretarPayload(p, GRUPO_FIXTURE)).toEqual({
      tipo: "IGNORAR",
      motivo: "PAYLOAD_INVALIDO",
      caminhos: ["data.message.conversation"],
    });
  });
});

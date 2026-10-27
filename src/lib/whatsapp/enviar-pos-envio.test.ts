// @vitest-environment node
// GAB-46: falha DEPOIS da Evolution confirmar a entrega vira ErroPosEnvio
// (subclasse de ErroEnvioWhatsApp: quem já trata o genérico continua igual).
import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const criar = vi.fn();
vi.mock("@/lib/db", () => ({ db: { mensagemEnviada: { create: (...a: unknown[]) => criar(...a) } } }));

const { enviarWhatsApp, ErroEnvioWhatsApp, ErroPosEnvio } = await import("./enviar");

const envOriginal = { ...process.env };

beforeEach(() => {
  process.env.NOTIFICATIONS_ENABLED = "true";
  process.env.EVOLUTION_API_URL = "http://evolution.test:8080";
  process.env.EVOLUTION_API_KEY = "chave-evolution-de-teste-0123456789abcdef";
  process.env.EVOLUTION_INSTANCE = "ij-crm";
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ key: { id: "OUT1" } }), { status: 200 })));
  vi.spyOn(console, "info").mockImplementation(() => {});
  criar.mockReset();
});

afterEach(() => {
  process.env = { ...envOriginal };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("enviarWhatsApp: falha depois da entrega", () => {
  it("gravar MensagemEnviada falhou → ErroPosEnvio com eventoId, causa sanitizada (sem texto)", async () => {
    criar.mockRejectedValue(new Prisma.PrismaClientValidationError("Argument texto: 'segredo do grupo'", { clientVersion: "6" }));
    const e = await enviarWhatsApp({ para: "120363000000000001@g.us", texto: "segredo do grupo" }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErroPosEnvio);
    expect(e).toBeInstanceOf(ErroEnvioWhatsApp);
    const p = e as InstanceType<typeof ErroPosEnvio>;
    expect(p.name).toBe("ErroPosEnvio");
    expect(p.eventoId).toBe("OUT1");
    expect(p.message).toContain("entregue");
    expect(p.message).toContain("PrismaClientValidationError");
    expect(p.message).not.toContain("segredo");
  });

  it("sem falha na gravação → resultado normal", async () => {
    criar.mockResolvedValue({});
    await expect(enviarWhatsApp({ para: "120363000000000001@g.us", texto: "oi" })).resolves.toEqual({ eventoId: "OUT1", enviada: true });
  });

  it("falha HTTP continua ErroEnvioWhatsApp genérico (não pós-envio)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    const e = await enviarWhatsApp({ para: "120363000000000001@g.us", texto: "oi" }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErroEnvioWhatsApp);
    expect(e).not.toBeInstanceOf(ErroPosEnvio);
  });
});

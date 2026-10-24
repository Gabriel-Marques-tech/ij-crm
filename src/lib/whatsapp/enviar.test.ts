// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enviarWhatsApp, TIMEOUT_ENVIO_MS } from "./enviar";

/**
 * Safe mode não toca banco nem rede — dá pra testar como unitário. O caminho
 * feliz com NOTIFICATIONS_ENABLED=true (persiste MensagemEnviada) fica no teste
 * de integração do webhook; aqui só o timeout, que falha antes do banco.
 */
const envOriginal = { ...process.env };
const CHAVE = "chave-evolution-de-teste-0123456789abcdef";

beforeEach(() => {
  delete process.env.NOTIFICATIONS_ENABLED;
  process.env.EVOLUTION_API_URL = "http://evolution.test:8080";
  process.env.EVOLUTION_API_KEY = CHAVE;
  process.env.EVOLUTION_INSTANCE = "ij-crm";
});

afterEach(() => {
  process.env = { ...envOriginal };
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("enviarWhatsApp em safe mode", () => {
  it.each([undefined, "false", "1", "TRUE", "yes"])("NOTIFICATIONS_ENABLED=%j → não chama a Evolution", async (v) => {
    if (v === undefined) delete process.env.NOTIFICATIONS_ENABLED;
    else process.env.NOTIFICATIONS_ENABLED = v;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const r = await enviarWhatsApp({ para: "120363000000000001@g.us", texto: "📥 recebido" });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r.eventoId).toMatch(/^safe-[0-9a-f-]+$/);
    expect(r.enviada).toBe(false);
    const linhas = info.mock.calls.map((c) => c.join(" "));
    expect(linhas.some((l) => l.includes("[SAFE MODE]") && l.includes("12**************01@g.us"))).toBe(true);
    // Nem o JID em claro nem o conteúdo da mensagem vão para o log.
    expect(linhas.join("\n")).not.toContain("120363000000000001");
    expect(linhas.join("\n")).not.toContain("recebido");
  });
});

describe("enviarWhatsApp com envio real (fetch mockado)", () => {
  it("corpo que nunca chega → rejeita por timeout dentro de 60s", async () => {
    process.env.NOTIFICATIONS_ENABLED = "true";
    vi.useFakeTimers();
    // Resposta 201 cuja stream de corpo nunca termina: `json()` fica pendurado.
    const pendurado = new Response(new ReadableStream({ start() {} }), { status: 201 });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(pendurado);

    const promessa = enviarWhatsApp({ para: "120363000000000001@g.us", texto: "📥 recebido" });
    const resultado = promessa.then(
      () => "resolveu",
      (e: Error) => e,
    );

    await vi.advanceTimersByTimeAsync(TIMEOUT_ENVIO_MS - 1);
    // Antes do prazo ainda está pendente; o abort só dispara em 60s.
    await vi.advanceTimersByTimeAsync(2);
    const r = await resultado;
    expect(r).toBeInstanceOf(Error);
    expect((r as Error).name).toBe("ErroEnvioWhatsApp");
    expect((r as Error).message).toMatch(/timeout após 60000ms/);
  });

  it("chave da Evolution fraca → falha antes de qualquer request", async () => {
    process.env.NOTIFICATIONS_ENABLED = "true";
    process.env.EVOLUTION_API_KEY = "troque-me-openssl-rand-hex-32-xxxxxxxxxx";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(enviarWhatsApp({ para: "120363000000000001@g.us", texto: "x" })).rejects.toThrow(/EVOLUTION_API_KEY/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

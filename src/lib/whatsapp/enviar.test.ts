import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enviarWhatsApp } from "./enviar";

/**
 * Safe mode não toca banco nem rede — dá pra testar como unitário. O caminho
 * com NOTIFICATIONS_ENABLED=true (persiste MensagemEnviada) fica no teste de
 * integração do webhook.
 */
describe("enviarWhatsApp em safe mode", () => {
  const envOriginal = { ...process.env };

  beforeEach(() => {
    delete process.env.NOTIFICATIONS_ENABLED;
    process.env.EVOLUTION_API_URL = "http://evolution.test:8080";
    process.env.EVOLUTION_API_KEY = "chave";
    process.env.EVOLUTION_INSTANCE = "ij-crm";
  });

  afterEach(() => {
    process.env = { ...envOriginal };
    vi.restoreAllMocks();
  });

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

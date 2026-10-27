import { describe, expect, it, vi } from "vitest";

const { exigirPapel, listarFila, carregarPainel, opcoesDoPainel } = vi.hoisted(() => ({
  exigirPapel: vi.fn(async () => {
    throw new Error("NEXT_REDIRECT /403");
  }),
  listarFila: vi.fn(),
  carregarPainel: vi.fn(),
  opcoesDoPainel: vi.fn(),
}));

vi.mock("@/lib/auth/atual", () => ({ exigirPapel }));
vi.mock("@/lib/whatsapp/painel", () => ({ listarFila, carregarPainel, opcoesDoPainel }));
vi.mock("./actions", () => ({}));

const { default: WhatsappPage } = await import("./page");

describe("Gestão → WhatsApp", () => {
  it("exige GESTOR: vendedor cai no /403 antes de qualquer leitura (texto de mensagem)", async () => {
    await expect(WhatsappPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("/403");
    expect(exigirPapel).toHaveBeenCalledWith("GESTOR");
    expect(listarFila).not.toHaveBeenCalled();
    expect(carregarPainel).not.toHaveBeenCalled();
  });
});

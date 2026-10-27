import { beforeEach, describe, expect, it, vi } from "vitest";

const { exigirPapel, confirmarPrevia, remapearPrevia, revalidatePath } = vi.hoisted(() => ({
  exigirPapel: vi.fn<(papel: string) => Promise<{ id: string; papel: string }>>(async () => ({ id: "u1", papel: "GESTOR" })),
  confirmarPrevia: vi.fn(),
  remapearPrevia: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/auth/atual", () => ({ exigirPapel }));
vi.mock("@/lib/importacao/pipefy/servico", () => ({ confirmarPrevia, remapearPrevia }));

const { confirmarImportAction, remapearImportAction } = await import("./actions");

const HEX = "a".repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("confirmarImportAction", () => {
  it("exige GESTOR; token ou hash malformado não chega no serviço", async () => {
    expect(await confirmarImportAction("x", HEX)).toEqual({ ok: false, erro: "Dados inválidos. Recarregue a página." });
    expect(await confirmarImportAction(HEX, "../")).toEqual({ ok: false, erro: "Dados inválidos. Recarregue a página." });
    expect(exigirPapel).toHaveBeenCalledWith("GESTOR");
    expect(confirmarPrevia).not.toHaveBeenCalled();
  });

  it("repassa token + hash e devolve o relatório (inclusive parcial, com a ref)", async () => {
    const parcial = { criados: 2, interrompido: { ref: "abcd1234", naoProcessados: 3 } };
    confirmarPrevia.mockResolvedValue({ ok: true, relatorio: parcial });
    expect(await confirmarImportAction(HEX, HEX)).toEqual({ ok: true, relatorio: parcial });
    expect(confirmarPrevia).toHaveBeenCalledWith(HEX, HEX, { id: "u1", papel: "GESTOR" });
    expect(revalidatePath).toHaveBeenCalledWith("/kanban");
  });

  it("exceção no meio: revalida mesmo assim (finally) e devolve INESPERADO com ref", async () => {
    confirmarPrevia.mockRejectedValue(new Error("db caiu"));
    const r = await confirmarImportAction(HEX, HEX);
    expect(r).toMatchObject({ ok: false, erro: "INESPERADO", ref: expect.stringMatching(/^[0-9a-f]{8}$/) });
    expect(revalidatePath).toHaveBeenCalledWith("/kanban");
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });
});

describe("remapearImportAction", () => {
  it("valida token, mapa e opções; repassa as opções", async () => {
    expect(await remapearImportAction(HEX, "nao-e-objeto")).toEqual({ ok: false, erro: "Dados inválidos. Recarregue a página." });
    expect(await remapearImportAction(HEX, {}, { outra: 1 })).toEqual({ ok: false, erro: "Dados inválidos. Recarregue a página." });
    expect(remapearPrevia).not.toHaveBeenCalled();
    const expiraEm = new Date("2026-10-26T12:30:00Z");
    remapearPrevia.mockResolvedValue({ ok: true, token: HEX, expiraEm, previa: { cards: 1 } });
    expect(await remapearImportAction(HEX, { lead: null }, { motivoPerdaPadrao: "preco" })).toEqual({ ok: true, token: HEX, expiraEm: expiraEm.toISOString(), previa: { cards: 1 } });
    expect(remapearPrevia).toHaveBeenCalledWith(HEX, { lead: null }, { id: "u1", papel: "GESTOR" }, expect.any(Date), { motivoPerdaPadrao: "preco" });
  });
});

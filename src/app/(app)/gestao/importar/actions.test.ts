import { beforeEach, describe, expect, it, vi } from "vitest";

const exigirPapel = vi.fn<(papel: string) => Promise<{ id: string; papel: string }>>(async () => ({ id: "u1", papel: "GESTOR" }));
const criarPrevia = vi.fn();
const confirmarPrevia = vi.fn();
const remapearPrevia = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/atual", () => ({ exigirPapel: (p: string) => exigirPapel(p) }));
vi.mock("@/lib/importacao/pipefy/servico", () => ({
  LIMITE_BYTES: 1024,
  criarPrevia: (...a: unknown[]) => criarPrevia(...a),
  confirmarPrevia: (...a: unknown[]) => confirmarPrevia(...a),
  remapearPrevia: (...a: unknown[]) => remapearPrevia(...a),
}));

const { previsualizarImportAction, confirmarImportAction, remapearImportAction } = await import("./actions");

function form(arquivo?: File) {
  const f = new FormData();
  if (arquivo) f.set("arquivo", arquivo);
  return f;
}

const HEX = "a".repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("previsualizarImportAction", () => {
  it("exige GESTOR", async () => {
    await previsualizarImportAction(form());
    expect(exigirPapel).toHaveBeenCalledWith("GESTOR");
  });

  it("sem arquivo, .xlsx, extensão estranha e arquivo grande → mensagens específicas, sem prévia", async () => {
    expect(await previsualizarImportAction(form())).toEqual({ ok: false, erro: "Escolha o arquivo CSV exportado do Pipefy." });
    const xlsx = await previsualizarImportAction(form(new File(["x"], "export.xlsx")));
    expect(xlsx.ok === false && xlsx.erro).toMatch(/salve como CSV/);
    const pdf = await previsualizarImportAction(form(new File(["x"], "export.pdf")));
    expect(pdf.ok === false && pdf.erro).toBe("Envie o export em CSV (.csv).");
    const grande = await previsualizarImportAction(form(new File(["x".repeat(2048)], "export.csv")));
    expect(grande.ok === false && grande.erro).toMatch(/limite é/);
    expect(criarPrevia).not.toHaveBeenCalled();
  });

  it("CSV válido → decodifica (BOM) e devolve token + prévia", async () => {
    const expiraEm = new Date("2026-10-26T12:30:00Z");
    criarPrevia.mockResolvedValue({ ok: true, token: HEX, expiraEm, previa: { cards: 1 } });
    const r = await previsualizarImportAction(form(new File(["﻿ID,Title\n1,A\n"], "export.csv")));
    expect(r).toEqual({ ok: true, token: HEX, expiraEm: expiraEm.toISOString(), previa: { cards: 1 } });
    expect(criarPrevia).toHaveBeenCalledWith({ conteudo: expect.stringContaining("ID,Title"), nomeArquivo: "export.csv" }, { id: "u1", papel: "GESTOR" });
  });

  it("exceção inesperada vira INESPERADO com ref", async () => {
    criarPrevia.mockRejectedValue(new Error("db caiu"));
    const r = await previsualizarImportAction(form(new File(["ID\n1\n"], "a.csv")));
    expect(r).toMatchObject({ ok: false, erro: "INESPERADO", ref: expect.any(String) });
  });
});

describe("confirmar/remapear", () => {
  it("token ou hash malformado não chega no serviço", async () => {
    expect(await confirmarImportAction("x", HEX)).toEqual({ ok: false, erro: "Dados inválidos. Recarregue a página." });
    expect(await confirmarImportAction(HEX, "../")).toEqual({ ok: false, erro: "Dados inválidos. Recarregue a página." });
    expect(await remapearImportAction(HEX, "nao-e-objeto")).toEqual({ ok: false, erro: "Dados inválidos. Recarregue a página." });
    expect(confirmarPrevia).not.toHaveBeenCalled();
    expect(remapearPrevia).not.toHaveBeenCalled();
  });

  it("repassa token + hash ao serviço com o usuário da sessão", async () => {
    confirmarPrevia.mockResolvedValue({ ok: true, relatorio: { criados: 2 } });
    expect(await confirmarImportAction(HEX, HEX)).toEqual({ ok: true, relatorio: { criados: 2 } });
    expect(confirmarPrevia).toHaveBeenCalledWith(HEX, HEX, { id: "u1", papel: "GESTOR" });
  });
});

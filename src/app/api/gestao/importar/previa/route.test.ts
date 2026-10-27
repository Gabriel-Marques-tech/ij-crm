// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { usuarioAtual, criarPrevia } = vi.hoisted(() => ({ usuarioAtual: vi.fn(), criarPrevia: vi.fn() }));
vi.mock("@/lib/auth/atual", () => ({ usuarioAtual }));
vi.mock("@/lib/importacao/pipefy/servico", () => ({ LIMITE_BYTES: 100, criarPrevia }));

import { POST } from "./route";

const URL_ = "http://localhost:3037/api/gestao/importar/previa";
const GESTOR = { id: "g1", papel: "GESTOR" };

function req(corpo: BodyInit | null, headers: Record<string, string> = {}, init: RequestInit = {}) {
  return new Request(URL_, { method: "POST", body: corpo, headers: { "content-type": "text/csv", "x-nome-arquivo": encodeURIComponent("export.csv"), ...headers }, ...init });
}

/** Corpo em pedaços, sem Content-Length (como um upload chunked). */
function emPedacos(pedacos: string[]) {
  const enc = new TextEncoder();
  let lidos = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (lidos < pedacos.length) c.enqueue(enc.encode(pedacos[lidos++]));
      else c.close();
    },
  });
  return { stream, lidos: () => lidos };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/gestao/importar/previa", () => {
  it("sem sessão → 401 JSON; VENDEDOR → 403 JSON (sem redirect, sem ler o corpo)", async () => {
    usuarioAtual.mockResolvedValueOnce(null);
    let r = await POST(req("ID\n1\n"));
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ ok: false, erro: "Sessão expirada. Entre de novo." });
    usuarioAtual.mockResolvedValueOnce({ id: "v", papel: "VENDEDOR" });
    r = await POST(req("ID\n1\n"));
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ ok: false, erro: "Só gestor ou admin importa do Pipefy." });
    expect(criarPrevia).not.toHaveBeenCalled();
  });

  it("origem de outro site → 403", async () => {
    usuarioAtual.mockResolvedValue(GESTOR);
    const r = await POST(req("ID\n1\n", { origin: "https://malicioso.example" }));
    expect(r.status).toBe(403);
    expect(criarPrevia).not.toHaveBeenCalled();
  });

  it("Content-Length acima do limite → 413 antes de ler", async () => {
    usuarioAtual.mockResolvedValue(GESTOR);
    const r = await POST(req("x".repeat(10), { "content-length": "101" }));
    expect(r.status).toBe(413);
    expect((await r.json()).erro).toMatch(/limite é/);
    expect(criarPrevia).not.toHaveBeenCalled();
  });

  it("sem Content-Length: conta os bytes no streaming e aborta ao passar do limite", async () => {
    usuarioAtual.mockResolvedValue(GESTOR);
    const { stream, lidos } = emPedacos(Array.from({ length: 20 }, () => "x".repeat(30)));
    const r = await POST(req(stream, {}, { duplex: "half" } as RequestInit));
    expect(r.status).toBe(413);
    expect(lidos()).toBeLessThan(20); // não leu o arquivo inteiro
    expect(criarPrevia).not.toHaveBeenCalled();
  });

  it("xlsx ou extensão estranha → 400 com a instrução", async () => {
    usuarioAtual.mockResolvedValue(GESTOR);
    let r = await POST(req("x", { "x-nome-arquivo": "export.xlsx" }));
    expect(r.status).toBe(400);
    expect((await r.json()).erro).toMatch(/salve como CSV/);
    r = await POST(req("x", { "x-nome-arquivo": "foto.png" }));
    expect((await r.json()).erro).toBe("Envie o export em CSV (.csv).");
    r = await POST(req(""));
    expect((await r.json()).erro).toBe("Escolha o arquivo CSV exportado do Pipefy.");
  });

  it("CSV dentro do limite → decodifica (BOM) e devolve token + prévia", async () => {
    usuarioAtual.mockResolvedValue(GESTOR);
    const expiraEm = new Date("2026-10-26T12:30:00Z");
    criarPrevia.mockResolvedValue({ ok: true, token: "t".repeat(64), expiraEm, previa: { cards: 1 } });
    const r = await POST(req("﻿ID;Title\n1;A\n", { "x-nome-arquivo": encodeURIComponent("exportação.csv"), origin: "http://localhost:3037" }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, token: "t".repeat(64), expiraEm: expiraEm.toISOString(), previa: { cards: 1 } });
    expect(criarPrevia).toHaveBeenCalledWith({ conteudo: "ID;Title\n1;A\n", nomeArquivo: "exportação.csv" }, GESTOR);
  });

  it("erro de regra do serviço → 422 com a mensagem; exceção → 500 com ref", async () => {
    usuarioAtual.mockResolvedValue(GESTOR);
    criarPrevia.mockResolvedValueOnce({ ok: false, erro: "Colunas obrigatórias não encontradas" });
    let r = await POST(req("a\n"));
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({ ok: false, erro: "Colunas obrigatórias não encontradas" });
    criarPrevia.mockRejectedValueOnce(new Error("db caiu"));
    r = await POST(req("a\n"));
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ ok: false, erro: "INESPERADO", ref: expect.stringMatching(/^[0-9a-f]{8}$/) });
  });
});

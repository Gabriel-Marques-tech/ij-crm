// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { removerFoto, salvarFoto } from "@/lib/perfil/foto";

const sessao = vi.hoisted(() => ({ atual: null as null | { id: string; nome: string; email: string; papel: "VENDEDOR" } }));
vi.mock("@/lib/auth/atual", () => ({ usuarioAtual: async () => sessao.atual }));

const { GET } = await import("./route");
const db = dbTeste();
const WEBP = new Uint8Array(readFileSync(path.join(import.meta.dirname, "../../../../../test/fixtures/fotos/real-256.webp")));
const PNG_RENOMEADO = new Uint8Array(readFileSync(path.join(import.meta.dirname, "../../../../../test/fixtures/fotos/png-renomeado.webp")));

function chamar(id: string, headers: Record<string, string> = {}) {
  return GET(new Request(`http://localhost/api/usuarios/${id}/foto`, { headers }), { params: Promise.resolve({ id }) });
}

beforeEach(async () => {
  await limparBanco(["sessao", "usuario_foto", "usuario"]);
  sessao.atual = null;
});

async function semear() {
  const ana = await db.usuario.create({ data: { nome: "Ana", email: "ana@ij.test" } });
  const bruno = await db.usuario.create({ data: { nome: "Bruno", email: "bruno@ij.test" } });
  sessao.atual = { id: bruno.id, nome: "Bruno", email: "bruno@ij.test", papel: "VENDEDOR" };
  return { ana, bruno };
}

describe("GET /api/usuarios/[id]/foto", () => {
  it("sem sessão → 401", async () => {
    const { ana } = await semear();
    sessao.atual = null;
    expect((await chamar(ana.id)).status).toBe(401);
  });

  it("sem foto → 404 (cliente cai para iniciais)", async () => {
    const { ana } = await semear();
    expect((await chamar(ana.id)).status).toBe(404);
  });

  it("serve a foto com mime validado, nosniff, cache privado e ETag; If-None-Match → 304", async () => {
    const { ana } = await semear();
    expect((await salvarFoto(ana.id, WEBP)).ok).toBe(true);
    const r = await chamar(ana.id);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/webp");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("cache-control")).toMatch(/^private, max-age=\d+/);
    const etag = r.headers.get("etag")!;
    expect(etag).toMatch(/^"f[0-9a-z]+"$/);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(WEBP);
    const r304 = await chamar(ana.id, { "if-none-match": etag });
    expect(r304.status).toBe(304);
    expect(await r304.text()).toBe("");
    expect((await chamar(ana.id, { "if-none-match": '"outro"' })).status).toBe(200);
  });

  it("trocar a foto muda o ETag; remover → 404", async () => {
    const { ana } = await semear();
    await salvarFoto(ana.id, WEBP, new Date("2026-10-25T10:00:00Z"));
    const e1 = (await chamar(ana.id)).headers.get("etag");
    await salvarFoto(ana.id, WEBP, new Date("2026-10-25T11:00:00Z"));
    const e2 = (await chamar(ana.id)).headers.get("etag");
    expect(e1).not.toBe(e2);
    await removerFoto(ana.id);
    expect((await chamar(ana.id)).status).toBe(404);
  });
});

describe("salvarFoto", () => {
  it("recusa arquivo forjado sem gravar", async () => {
    const { ana } = await semear();
    expect(await salvarFoto(ana.id, PNG_RENOMEADO)).toEqual({ ok: false, erro: "TIPO_INVALIDO" });
    expect(await db.usuarioFoto.count()).toBe(0);
  });

  it("o banco recusa mime fora da lista mesmo por fora do serviço (CHECK)", async () => {
    const { ana } = await semear();
    await expect(db.usuarioFoto.create({ data: { usuarioId: ana.id, bytes: Buffer.from(WEBP), mime: "text/html" } })).rejects.toThrow();
  });
});

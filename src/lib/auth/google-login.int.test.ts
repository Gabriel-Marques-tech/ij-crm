import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { desligarGoogle, entrarComGoogle } from "./google-login";
import { reemitirConvite } from "./usuarios";

const db = dbTeste();

beforeEach(async () => {
  await limparBanco(["sessao", "usuario"]);
});

const criar = (email: string, papel: "ADMIN" | "GESTOR" | "VENDEDOR", googleSub: string | null = null) =>
  db.usuario.create({ data: { nome: email, email, papel, senhaHash: googleSub ? null : "x", googleSub } });

describe("desligarGoogle (Gestão)", () => {
  it("gestor desliga o Google de um vendedor; auditoria; o próximo login amarra a conta nova", async () => {
    const g = await criar("gestor@ij.test", "GESTOR");
    const v = await criar("vend@ij.test", "VENDEDOR", "sub-antigo");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await desligarGoogle(v.id, g)).toEqual({ ok: true });
    expect((await db.usuario.findUniqueOrThrow({ where: { id: v.id } })).googleSub).toBeNull();
    expect(log.mock.calls.map((c) => String(c[0]))).toContain(`[auditoria] usuario.google_desligado usuario=${v.id} por=${g.id}`);
    // conta Google recriada (sub novo) volta a entrar
    expect(await entrarComGoogle({ sub: "sub-novo", email: "vend@ij.test" })).toMatchObject({ ok: true, vinculou: true });
    log.mockRestore();
  });

  it("gestor não desliga de outro gestor nem de admin; ninguém de si mesmo; admin desliga de qualquer um", async () => {
    const a = await criar("admin@ij.test", "ADMIN", "sub-a");
    const g = await criar("gestor@ij.test", "GESTOR", "sub-g");
    const g2 = await criar("gestor2@ij.test", "GESTOR", "sub-g2");
    vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await desligarGoogle(g2.id, g)).toEqual({ ok: false, erro: "PAPEL_NAO_PERMITIDO" });
    expect(await desligarGoogle(a.id, g)).toEqual({ ok: false, erro: "PAPEL_NAO_PERMITIDO" });
    expect(await desligarGoogle(g.id, g)).toEqual({ ok: false, erro: "NAO_PODE_ALTERAR_A_SI" });
    expect(await desligarGoogle(a.id, a)).toEqual({ ok: false, erro: "NAO_PODE_ALTERAR_A_SI" });
    expect(await desligarGoogle(g2.id, a)).toEqual({ ok: true });
    expect((await db.usuario.findUniqueOrThrow({ where: { id: g.id } })).googleSub).toBe("sub-g");
    vi.restoreAllMocks();
  });

  it("sem Google ligado / inexistente", async () => {
    const a = await criar("admin@ij.test", "ADMIN");
    const v = await criar("vend@ij.test", "VENDEDOR");
    expect(await desligarGoogle(v.id, a)).toEqual({ ok: false, erro: "SEM_GOOGLE" });
    expect(await desligarGoogle("nao-existe", a)).toEqual({ ok: false, erro: "USUARIO_NAO_ENCONTRADO" });
  });
});

describe("saída por senha de quem só entra com Google", () => {
  it("reemitir convite funciona com googleSub (define senha) e o link sobrevive aos logins com Google seguintes", async () => {
    const a = await criar("admin@ij.test", "ADMIN");
    const v = await criar("vend@ij.test", "VENDEDOR", "sub-v");
    const r = await reemitirConvite(v.id, a);
    expect(r.ok).toBe(true);
    expect((await db.usuario.findUniqueOrThrow({ where: { id: v.id } })).conviteTokenHash).not.toBeNull();
    vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await entrarComGoogle({ sub: "sub-v", email: "vend@ij.test" })).toMatchObject({ ok: true, vinculou: false, conviteResolvido: false });
    expect((await db.usuario.findUniqueOrThrow({ where: { id: v.id } })).conviteTokenHash).not.toBeNull();
    vi.restoreAllMocks();
  });
});

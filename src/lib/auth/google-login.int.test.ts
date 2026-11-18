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
  it("gestor desliga o Google de um vendedor; sessões dele caem; auditoria; o próximo login amarra a conta nova", async () => {
    const g = await criar("gestor@ij.test", "GESTOR");
    const v = await criar("vend@ij.test", "VENDEDOR", "sub-antigo");
    const futuro = new Date(Date.now() + 86_400_000);
    await db.sessao.createMany({ data: [{ id: "s1", usuarioId: v.id, expiraEm: futuro }, { id: "s2", usuarioId: v.id, expiraEm: futuro }, { id: "s3", usuarioId: g.id, expiraEm: futuro }] });
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await desligarGoogle(v.id, g)).toEqual({ ok: true });
    const depois = await db.usuario.findUniqueOrThrow({ where: { id: v.id } });
    expect(depois.googleSub).toBeNull();
    expect(depois.googleDesligadoEm).toBeInstanceOf(Date);
    expect(await db.sessao.count({ where: { usuarioId: v.id } })).toBe(0);
    expect(await db.sessao.count({ where: { usuarioId: g.id } })).toBe(1);
    expect(log.mock.calls.map((c) => String(c[0]))).toContain(`[auditoria] usuario.google_desligado usuario=${v.id} por=${g.id} sessoes_encerradas=2`);
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
    await db.sessao.create({ data: { id: "s-g", usuarioId: g.id, expiraEm: new Date(Date.now() + 86_400_000) } });
    expect(await desligarGoogle(g2.id, a)).toEqual({ ok: true });
    expect(await db.sessao.count({ where: { usuarioId: g.id } })).toBe(1); // recusas não derrubam sessão
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

  it("link de senha gerado depois de Desligar Google sobrevive ao novo vínculo", async () => {
    const a = await criar("admin@ij.test", "ADMIN");
    const v = await criar("vend@ij.test", "VENDEDOR", "sub-antigo");
    vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await desligarGoogle(v.id, a)).toEqual({ ok: true });
    expect((await reemitirConvite(v.id, a)).ok).toBe(true);
    expect(await entrarComGoogle({ sub: "sub-novo", email: "vend@ij.test" })).toMatchObject({ ok: true, vinculou: true, conviteResolvido: false });
    expect((await db.usuario.findUniqueOrThrow({ where: { id: v.id } })).conviteTokenHash).not.toBeNull();
    vi.restoreAllMocks();
  });

  it("convite reemitido antes de qualquer vínculo ainda é resolvido no 1º login", async () => {
    const a = await criar("admin@ij.test", "ADMIN");
    const v = await db.usuario.create({ data: { nome: "n", email: "novo@ij.test", papel: "VENDEDOR" } });
    expect((await reemitirConvite(v.id, a)).ok).toBe(true);
    vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await entrarComGoogle({ sub: "sub-n", email: "novo@ij.test" })).toMatchObject({ ok: true, vinculou: true, conviteResolvido: true });
    expect((await db.usuario.findUniqueOrThrow({ where: { id: v.id } })).conviteTokenHash).toBeNull();
    vi.restoreAllMocks();
  });
});

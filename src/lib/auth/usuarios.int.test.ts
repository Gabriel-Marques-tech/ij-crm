import { beforeEach, describe, expect, it } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { gerarHashSenha } from "./senha";
import { aceitarConvite, atualizarUsuario, autenticar, criarConvite } from "./usuarios";
import { criarSessao, encerrarSessao, obterUsuarioDaSessao } from "./sessao";

const db = dbTeste();

async function admin() {
  return db.usuario.create({
    data: { nome: "Admin", email: "admin@ij.test", papel: "ADMIN", senhaHash: await gerarHashSenha("admin-12345") },
  });
}

async function gestor() {
  return db.usuario.create({
    data: { nome: "Gestora", email: "gestora@ij.test", papel: "GESTOR", senhaHash: await gerarHashSenha("gestora-123") },
  });
}

beforeEach(async () => {
  await limparBanco(["sessao", "usuario"]);
});

describe("criarConvite", () => {
  it("cria usuário inativo-para-login com token hasheado e devolve o token em claro", async () => {
    const a = await admin();
    const r = await criarConvite(
      { nome: "João", email: " Joao@IJ.test ", papel: "VENDEDOR", telefone: "(11) 99999-8888" },
      a,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const u = await db.usuario.findUniqueOrThrow({ where: { id: r.usuarioId } });
    expect(u.email).toBe("joao@ij.test");
    expect(u.telefoneWhatsapp).toBe("+5511999998888");
    expect(u.senhaHash).toBeNull();
    expect(u.conviteTokenHash).not.toBe(r.token);
    expect(r.token).toHaveLength(64);
  });

  it("gestor não convida admin", async () => {
    const g = await gestor();
    const r = await criarConvite({ nome: "X", email: "x@ij.test", papel: "ADMIN" }, g);
    expect(r).toEqual({ ok: false, erro: "PAPEL_NAO_PERMITIDO" });
  });

  it("vendedor não convida ninguém", async () => {
    const v = await db.usuario.create({ data: { nome: "V", email: "v@ij.test", papel: "VENDEDOR" } });
    const r = await criarConvite({ nome: "X", email: "x@ij.test", papel: "VENDEDOR" }, v);
    expect(r).toEqual({ ok: false, erro: "PAPEL_NAO_PERMITIDO" });
  });

  it("email já cadastrado (mesmo com caixa diferente) → EMAIL_EM_USO", async () => {
    const a = await admin();
    const r = await criarConvite({ nome: "Dup", email: "ADMIN@ij.test", papel: "VENDEDOR" }, a);
    expect(r).toEqual({ ok: false, erro: "EMAIL_EM_USO" });
  });

  it("telefone inválido → TELEFONE_INVALIDO", async () => {
    const a = await admin();
    const r = await criarConvite({ nome: "T", email: "t@ij.test", papel: "VENDEDOR", telefone: "123" }, a);
    expect(r).toEqual({ ok: false, erro: "TELEFONE_INVALIDO" });
  });
});

describe("aceitarConvite", () => {
  it("define senha, invalida o token e permite login", async () => {
    const a = await admin();
    const c = await criarConvite({ nome: "João", email: "joao@ij.test", papel: "VENDEDOR" }, a);
    if (!c.ok) throw new Error("setup");
    const r = await aceitarConvite(c.token, "senha-forte-1");
    expect(r.ok).toBe(true);
    const u = await db.usuario.findUniqueOrThrow({ where: { email: "joao@ij.test" } });
    expect(u.conviteTokenHash).toBeNull();
    expect(u.conviteExpiraEm).toBeNull();
    expect(u.senhaHash).not.toBeNull();
    const login = await autenticar("joao@ij.test", "senha-forte-1");
    expect(login.ok).toBe(true);
  });

  it("token já usado é rejeitado", async () => {
    const a = await admin();
    const c = await criarConvite({ nome: "João", email: "joao@ij.test", papel: "VENDEDOR" }, a);
    if (!c.ok) throw new Error("setup");
    await aceitarConvite(c.token, "senha-forte-1");
    expect(await aceitarConvite(c.token, "outra-senha-1")).toEqual({ ok: false, erro: "CONVITE_INVALIDO" });
  });

  it("token expirado é rejeitado", async () => {
    const a = await admin();
    const c = await criarConvite({ nome: "João", email: "joao@ij.test", papel: "VENDEDOR" }, a);
    if (!c.ok) throw new Error("setup");
    await db.usuario.update({ where: { id: c.usuarioId }, data: { conviteExpiraEm: new Date(Date.now() - 1000) } });
    expect(await aceitarConvite(c.token, "senha-forte-1")).toEqual({ ok: false, erro: "CONVITE_INVALIDO" });
  });

  it("token desconhecido é rejeitado", async () => {
    expect(await aceitarConvite("a".repeat(64), "senha-forte-1")).toEqual({ ok: false, erro: "CONVITE_INVALIDO" });
  });

  it("senha fraca é rejeitada sem consumir o token", async () => {
    const a = await admin();
    const c = await criarConvite({ nome: "João", email: "joao@ij.test", papel: "VENDEDOR" }, a);
    if (!c.ok) throw new Error("setup");
    expect(await aceitarConvite(c.token, "curta")).toEqual({ ok: false, erro: "SENHA_FRACA" });
    expect(await aceitarConvite(c.token, "senha-forte-1")).toEqual({ ok: true, usuarioId: c.usuarioId });
  });
});

describe("autenticar", () => {
  it("mesmo erro genérico para email inexistente e senha errada", async () => {
    await admin();
    const a = await autenticar("ninguem@ij.test", "x");
    const b = await autenticar("admin@ij.test", "errada-123");
    expect(a).toEqual({ ok: false, erro: "CREDENCIAIS_INVALIDAS" });
    expect(b).toEqual(a);
  });

  it("email é normalizado no login", async () => {
    await admin();
    expect((await autenticar("  ADMIN@ij.test", "admin-12345")).ok).toBe(true);
  });

  it("usuário desativado não loga", async () => {
    const a = await admin();
    await db.usuario.update({ where: { id: a.id }, data: { ativo: false } });
    expect(await autenticar("admin@ij.test", "admin-12345")).toEqual({ ok: false, erro: "CREDENCIAIS_INVALIDAS" });
  });
});

describe("sessão", () => {
  it("cria, resolve o usuário e encerra", async () => {
    const a = await admin();
    const id = await criarSessao(a.id);
    expect(id).toHaveLength(64);
    const u = await obterUsuarioDaSessao(id);
    expect(u?.id).toBe(a.id);
    await encerrarSessao(id);
    expect(await obterUsuarioDaSessao(id)).toBeNull();
  });

  it("sessão expirada ou de usuário desativado não resolve", async () => {
    const a = await admin();
    const expirada = await criarSessao(a.id, new Date(Date.now() - 1000));
    expect(await obterUsuarioDaSessao(expirada)).toBeNull();
    const viva = await criarSessao(a.id);
    await db.usuario.update({ where: { id: a.id }, data: { ativo: false } });
    expect(await obterUsuarioDaSessao(viva)).toBeNull();
  });

  it("sessão desconhecida não resolve", async () => {
    expect(await obterUsuarioDaSessao("b".repeat(64))).toBeNull();
  });
});

describe("atualizarUsuario", () => {
  it("gestor altera telefone e papel até gestor, não promove a admin", async () => {
    const g = await gestor();
    const v = await db.usuario.create({ data: { nome: "V", email: "v@ij.test", papel: "VENDEDOR" } });
    expect(await atualizarUsuario(v.id, { telefone: "11 98888-7777", papel: "GESTOR" }, g)).toEqual({ ok: true });
    const u1 = await db.usuario.findUniqueOrThrow({ where: { id: v.id } });
    expect(u1.telefoneWhatsapp).toBe("+5511988887777");
    expect(u1.papel).toBe("GESTOR");
    expect(await atualizarUsuario(v.id, { papel: "ADMIN" }, g)).toEqual({ ok: false, erro: "PAPEL_NAO_PERMITIDO" });
  });

  it("gestor não mexe em admin", async () => {
    const g = await gestor();
    const a = await admin();
    expect(await atualizarUsuario(a.id, { ativo: false }, g)).toEqual({ ok: false, erro: "PAPEL_NAO_PERMITIDO" });
  });

  it("desativar derruba as sessões abertas", async () => {
    const a = await admin();
    const v = await db.usuario.create({ data: { nome: "V", email: "v@ij.test", papel: "VENDEDOR" } });
    const s = await criarSessao(v.id);
    expect(await atualizarUsuario(v.id, { ativo: false }, a)).toEqual({ ok: true });
    expect(await db.sessao.count({ where: { id: s } })).toBe(0);
  });

  it("ninguém desativa a si mesmo", async () => {
    const a = await admin();
    expect(await atualizarUsuario(a.id, { ativo: false }, a)).toEqual({ ok: false, erro: "NAO_PODE_ALTERAR_A_SI" });
  });

  it("telefone já usado por outro usuário → TELEFONE_EM_USO", async () => {
    const a = await admin();
    await db.usuario.create({ data: { nome: "V", email: "v@ij.test", papel: "VENDEDOR", telefoneWhatsapp: "+5511977776666" } });
    const w = await db.usuario.create({ data: { nome: "W", email: "w@ij.test", papel: "VENDEDOR" } });
    expect(await atualizarUsuario(w.id, { telefone: "11977776666" }, a)).toEqual({ ok: false, erro: "TELEFONE_EM_USO" });
  });
});

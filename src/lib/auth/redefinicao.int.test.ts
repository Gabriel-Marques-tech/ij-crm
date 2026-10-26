import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Papel } from "@prisma/client";
import { dbTeste, limparBanco } from "@/test/db";
import { buscarRedefinicao, gerarLinkRedefinicao, listarPedidosRedefinicao, pedirRedefinicao, redefinirSenha, REDEFINICAO_VALIDADE_MS } from "./redefinicao";
import { gerarHashSenha } from "./senha";
import { criarSessao, obterUsuarioDaSessao } from "./sessao";
import { autenticar } from "./usuarios";

const db = dbTeste();

async function criar(nome: string, papel: Papel, extra: { senha?: string | null; ativo?: boolean } = {}) {
  const senha = extra.senha === undefined ? "senha-antiga-1" : extra.senha;
  return db.usuario.create({
    data: {
      nome,
      email: `${nome.toLowerCase()}@ij.test`,
      papel,
      ativo: extra.ativo ?? true,
      senhaHash: senha === null ? null : await gerarHashSenha(senha),
    },
  });
}

beforeEach(async () => {
  await limparBanco(["sessao", "usuario_foto", "usuario"]);
  vi.useRealTimers();
});

describe("pedirRedefinicao", () => {
  it("email existente marca o pedido; inexistente não grava nada; mesma resposta (void)", async () => {
    const v = await criar("Vera", "VENDEDOR");
    expect(await pedirRedefinicao("  VERA@ij.test ")).toBeUndefined();
    expect(await pedirRedefinicao("ninguem@ij.test")).toBeUndefined();
    expect(await pedirRedefinicao("lixo")).toBeUndefined();
    const u = await db.usuario.findUniqueOrThrow({ where: { id: v.id } });
    expect(u.redefinicaoPedidaEm).not.toBeNull();
    expect(await db.usuario.count({ where: { redefinicaoPedidaEm: { not: null } } })).toBe(1);
  });

  it("usuário desativado ou com convite pendente não gera pedido", async () => {
    await criar("Inativo", "VENDEDOR", { ativo: false });
    await criar("Pendente", "VENDEDOR", { senha: null });
    await pedirRedefinicao("inativo@ij.test");
    await pedirRedefinicao("pendente@ij.test");
    expect(await db.usuario.count({ where: { redefinicaoPedidaEm: { not: null } } })).toBe(0);
  });

  it("pedido aparece para o gestor", async () => {
    const v = await criar("Vera", "VENDEDOR");
    await pedirRedefinicao("vera@ij.test");
    expect((await listarPedidosRedefinicao()).map((p) => p.id)).toEqual([v.id]);
  });
});

describe("gerarLinkRedefinicao", () => {
  it("gestor gera para vendedor: guarda só o hash, expira em 1 h, limpa o pedido", async () => {
    const g = await criar("Gestora", "GESTOR");
    const v = await criar("Vera", "VENDEDOR");
    await pedirRedefinicao("vera@ij.test");
    const antes = Date.now();
    const r = await gerarLinkRedefinicao(v.id, g);
    if (!r.ok) throw new Error(r.erro);
    expect(r.token).toMatch(/^[0-9a-f]{64}$/);
    const u = await db.usuario.findUniqueOrThrow({ where: { id: v.id } });
    expect(u.redefinicaoTokenHash).not.toBe(r.token);
    expect(u.redefinicaoTokenHash).toHaveLength(64);
    expect(u.redefinicaoPedidaEm).toBeNull();
    expect(u.redefinicaoExpiraEm!.getTime() - antes).toBeGreaterThanOrEqual(REDEFINICAO_VALIDADE_MS - 1000);
    expect(u.redefinicaoExpiraEm!.getTime() - antes).toBeLessThanOrEqual(REDEFINICAO_VALIDADE_MS + 1000);
  });

  it("gestor NÃO gera para admin; admin gera para admin; vendedor não gera para ninguém", async () => {
    const g = await criar("Gestora", "GESTOR");
    const a = await criar("Admin", "ADMIN");
    const a2 = await criar("Admin2", "ADMIN");
    const v = await criar("Vera", "VENDEDOR");
    const w = await criar("Wil", "VENDEDOR");
    expect(await gerarLinkRedefinicao(a.id, g)).toEqual({ ok: false, erro: "PAPEL_NAO_PERMITIDO" });
    expect((await gerarLinkRedefinicao(a2.id, a)).ok).toBe(true);
    expect(await gerarLinkRedefinicao(w.id, v)).toEqual({ ok: false, erro: "PAPEL_NAO_PERMITIDO" });
    expect((await db.usuario.findUniqueOrThrow({ where: { id: a.id } })).redefinicaoTokenHash).toBeNull();
  });

  it("não gera para si mesmo, para inativo, nem para convite pendente", async () => {
    const a = await criar("Admin", "ADMIN");
    const i = await criar("Inativo", "VENDEDOR", { ativo: false });
    const p = await criar("Pendente", "VENDEDOR", { senha: null });
    expect(await gerarLinkRedefinicao(a.id, a)).toEqual({ ok: false, erro: "NAO_PODE_ALTERAR_A_SI" });
    expect(await gerarLinkRedefinicao(i.id, a)).toEqual({ ok: false, erro: "USUARIO_INATIVO" });
    expect(await gerarLinkRedefinicao(p.id, a)).toEqual({ ok: false, erro: "CONVITE_PENDENTE" });
  });

  it("gerar de novo invalida o link anterior", async () => {
    const a = await criar("Admin", "ADMIN");
    const v = await criar("Vera", "VENDEDOR");
    const r1 = await gerarLinkRedefinicao(v.id, a);
    const r2 = await gerarLinkRedefinicao(v.id, a);
    if (!r1.ok || !r2.ok) throw new Error("setup");
    expect(await buscarRedefinicao(r1.token)).toBeNull();
    expect(await buscarRedefinicao(r2.token)).not.toBeNull();
  });
});

describe("redefinirSenha", () => {
  async function comLink() {
    const a = await criar("Admin", "ADMIN");
    const v = await criar("Vera", "VENDEDOR");
    const r = await gerarLinkRedefinicao(v.id, a);
    if (!r.ok) throw new Error("setup");
    return { v, token: r.token };
  }

  it("define a nova senha, consome o token e derruba TODAS as sessões do usuário", async () => {
    const { v, token } = await comLink();
    const s1 = await criarSessao(v.id);
    const s2 = await criarSessao(v.id);
    expect(await redefinirSenha(token, "senha-nova-12", "senha-nova-12")).toEqual({ ok: true, usuarioId: v.id });
    expect(await obterUsuarioDaSessao(s1)).toBeNull();
    expect(await obterUsuarioDaSessao(s2)).toBeNull();
    expect((await autenticar("vera@ij.test", "senha-nova-12")).ok).toBe(true);
    const u = await db.usuario.findUniqueOrThrow({ where: { id: v.id } });
    expect(u.redefinicaoTokenHash).toBeNull();
    expect(u.redefinicaoExpiraEm).toBeNull();
  });

  it("uso único: segunda vez é recusada", async () => {
    const { token } = await comLink();
    await redefinirSenha(token, "senha-nova-12", "senha-nova-12");
    expect(await redefinirSenha(token, "outra-senha-1", "outra-senha-1")).toEqual({ ok: false, erro: "TOKEN_INVALIDO" });
    expect((await autenticar("vera@ij.test", "senha-nova-12")).ok).toBe(true);
  });

  it("expirado é recusado", async () => {
    const { v, token } = await comLink();
    await db.usuario.update({ where: { id: v.id }, data: { redefinicaoExpiraEm: new Date(Date.now() - 1000) } });
    expect(await buscarRedefinicao(token)).toBeNull();
    expect(await redefinirSenha(token, "senha-nova-12", "senha-nova-12")).toEqual({ ok: false, erro: "TOKEN_INVALIDO" });
    expect((await autenticar("vera@ij.test", "senha-antiga-1")).ok).toBe(true);
  });

  it("corrida: dois usos simultâneos do mesmo token → só um vence", async () => {
    const { token } = await comLink();
    const rs = await Promise.all([
      redefinirSenha(token, "senha-de-a-12", "senha-de-a-12"),
      redefinirSenha(token, "senha-de-b-12", "senha-de-b-12"),
      redefinirSenha(token, "senha-de-c-12", "senha-de-c-12"),
    ]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.filter((r) => !r.ok)).toEqual([
      { ok: false, erro: "TOKEN_INVALIDO" },
      { ok: false, erro: "TOKEN_INVALIDO" },
    ]);
  });

  it("senha fraca ou confirmação diferente não consomem o token", async () => {
    const { token } = await comLink();
    expect(await redefinirSenha(token, "curta", "curta")).toEqual({ ok: false, erro: "SENHA_FRACA" });
    expect(await redefinirSenha(token, "senha-nova-12", "senha-nova-13")).toEqual({ ok: false, erro: "CONFIRMACAO_DIFERENTE" });
    expect((await redefinirSenha(token, "senha-nova-12", "senha-nova-12")).ok).toBe(true);
  });

  it("token malformado ou desconhecido", async () => {
    expect(await redefinirSenha("abc", "senha-nova-12", "senha-nova-12")).toEqual({ ok: false, erro: "TOKEN_INVALIDO" });
    expect(await redefinirSenha("a".repeat(64), "senha-nova-12", "senha-nova-12")).toEqual({ ok: false, erro: "TOKEN_INVALIDO" });
  });

  it("usuário desativado depois do link → recusado", async () => {
    const { v, token } = await comLink();
    await db.usuario.update({ where: { id: v.id }, data: { ativo: false } });
    expect(await redefinirSenha(token, "senha-nova-12", "senha-nova-12")).toEqual({ ok: false, erro: "TOKEN_INVALIDO" });
  });
});

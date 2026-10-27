import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { trocarEmail, trocarSenha } from "./conta";
import { gerarHashSenha } from "./senha";
import {
  SESSAO_TOQUE_MINUTOS,
  criarSessao,
  encerrarOutrasSessoes,
  encerrarSessaoDoUsuario,
  hashSessao,
  listarSessoes,
  obterUsuarioDaSessao,
} from "./sessao";
import { autenticar } from "./usuarios";

const db = dbTeste();

async function usuario(email = "ana@ij.test", senha = "senha-antiga-1") {
  return db.usuario.create({ data: { nome: "Ana", email, papel: "VENDEDOR", senhaHash: await gerarHashSenha(senha) } });
}

beforeEach(async () => {
  await limparBanco(["sessao", "usuario_foto", "usuario"]);
});

describe("trocarSenha", () => {
  it("exige a senha atual, troca e derruba as OUTRAS sessões (a atual fica)", async () => {
    const u = await usuario();
    const atual = await criarSessao(u.id);
    const outra = await criarSessao(u.id);
    const r = await trocarSenha(u.id, hashSessao(atual), { atual: "senha-antiga-1", nova: "senha-nova-12", confirmacao: "senha-nova-12" });
    expect(r).toEqual({ ok: true, encerradas: 1 });
    expect(await obterUsuarioDaSessao(atual)).not.toBeNull();
    expect(await obterUsuarioDaSessao(outra)).toBeNull();
    expect((await autenticar("ana@ij.test", "senha-nova-12")).ok).toBe(true);
    expect((await autenticar("ana@ij.test", "senha-antiga-1")).ok).toBe(false);
  });

  it("senha atual errada → recusa, nada muda", async () => {
    const u = await usuario();
    const outra = await criarSessao(u.id);
    expect(await trocarSenha(u.id, null, { atual: "errada-123", nova: "senha-nova-12", confirmacao: "senha-nova-12" })).toEqual({
      ok: false,
      erro: "SENHA_ATUAL_INCORRETA",
    });
    expect(await obterUsuarioDaSessao(outra)).not.toBeNull();
    expect((await autenticar("ana@ij.test", "senha-antiga-1")).ok).toBe(true);
  });

  it("regras: mínimo 8, confirmação igual, diferente da atual", async () => {
    const u = await usuario();
    const base = { atual: "senha-antiga-1" };
    expect(await trocarSenha(u.id, null, { ...base, nova: "curta", confirmacao: "curta" })).toEqual({ ok: false, erro: "SENHA_FRACA" });
    expect(await trocarSenha(u.id, null, { ...base, nova: "senha-nova-12", confirmacao: "senha-nova-13" })).toEqual({
      ok: false,
      erro: "CONFIRMACAO_DIFERENTE",
    });
    expect(await trocarSenha(u.id, null, { ...base, nova: "senha-antiga-1", confirmacao: "senha-antiga-1" })).toEqual({
      ok: false,
      erro: "SENHA_IGUAL",
    });
  });

  it("muitas tentativas com a senha atual errada → bloqueia por um tempo", async () => {
    const u = await usuario();
    const errada = { atual: "errada-123", nova: "senha-nova-12", confirmacao: "senha-nova-12" };
    for (let i = 0; i < 5; i++) await trocarSenha(u.id, null, errada);
    expect(await trocarSenha(u.id, null, { ...errada, atual: "senha-antiga-1" })).toEqual({ ok: false, erro: "MUITAS_TENTATIVAS" });
  });

  it("invalida um link de redefinição pendente", async () => {
    const u = await usuario();
    await db.usuario.update({
      where: { id: u.id },
      data: { redefinicaoTokenHash: "x".repeat(64), redefinicaoExpiraEm: new Date(Date.now() + 60_000), redefinicaoPedidaEm: new Date() },
    });
    await trocarSenha(u.id, null, { atual: "senha-antiga-1", nova: "senha-nova-12", confirmacao: "senha-nova-12" });
    const depois = await db.usuario.findUniqueOrThrow({ where: { id: u.id } });
    expect(depois.redefinicaoTokenHash).toBeNull();
    expect(depois.redefinicaoPedidaEm).toBeNull();
  });
});

describe("trocarEmail", () => {
  it("exige senha, normaliza e grava; loga sem segredo", async () => {
    const u = await usuario();
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await trocarEmail(u.id, { senha: "senha-antiga-1", email: "  Ana.Nova@IJ.test " })).toEqual({ ok: true, email: "ana.nova@ij.test" });
    expect((await db.usuario.findUniqueOrThrow({ where: { id: u.id } })).email).toBe("ana.nova@ij.test");
    const linha = log.mock.calls.map((c) => String(c[0])).find((l) => l.includes("email_alterado"));
    expect(linha).toContain(`usuario=${u.id}`);
    expect(linha).not.toContain("senha-antiga-1");
    expect(linha).not.toContain("ana.nova@ij.test");
    log.mockRestore();
  });

  it("senha errada → recusa", async () => {
    const u = await usuario();
    expect(await trocarEmail(u.id, { senha: "errada-123", email: "outro@ij.test" })).toEqual({ ok: false, erro: "SENHA_ATUAL_INCORRETA" });
  });

  it("email inválido / já em uso (com caixa diferente)", async () => {
    const u = await usuario();
    await usuario("bruno@ij.test");
    expect(await trocarEmail(u.id, { senha: "senha-antiga-1", email: "sem-arroba" })).toEqual({ ok: false, erro: "EMAIL_INVALIDO" });
    expect(await trocarEmail(u.id, { senha: "senha-antiga-1", email: "BRUNO@ij.test" })).toEqual({ ok: false, erro: "EMAIL_EM_USO" });
    expect((await db.usuario.findUniqueOrThrow({ where: { id: u.id } })).email).toBe("ana@ij.test");
  });
});

describe("sessões ativas", () => {
  it("lista as próprias, marca a atual, guarda o user-agent", async () => {
    const u = await usuario();
    const outro = await usuario("bruno@ij.test");
    const atual = await criarSessao(u.id, undefined, "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0");
    await criarSessao(u.id, undefined, "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1");
    await criarSessao(outro.id);
    await criarSessao(u.id, new Date(Date.now() - 1000)); // expirada: fora da lista
    const lista = await listarSessoes(u.id, hashSessao(atual));
    expect(lista).toHaveLength(2);
    expect(lista.filter((s) => s.atual)).toHaveLength(1);
    expect(lista.find((s) => s.atual)?.userAgent).toContain("Linux");
  });

  it("encerra uma; id de sessão de OUTRO usuário não tem efeito", async () => {
    const u = await usuario();
    const outro = await usuario("bruno@ij.test");
    const minha = await criarSessao(u.id);
    const dele = await criarSessao(outro.id);
    expect(await encerrarSessaoDoUsuario(u.id, hashSessao(dele))).toBe(false);
    expect(await obterUsuarioDaSessao(dele)).not.toBeNull();
    expect(await encerrarSessaoDoUsuario(u.id, hashSessao(minha))).toBe(true);
    expect(await obterUsuarioDaSessao(minha)).toBeNull();
  });

  it("encerrar todas as outras mantém a atual e não toca nas de outro usuário", async () => {
    const u = await usuario();
    const outro = await usuario("bruno@ij.test");
    const atual = await criarSessao(u.id);
    await criarSessao(u.id);
    await criarSessao(u.id);
    const dele = await criarSessao(outro.id);
    expect(await encerrarOutrasSessoes(u.id, hashSessao(atual))).toBe(2);
    expect(await obterUsuarioDaSessao(atual)).not.toBeNull();
    expect(await obterUsuarioDaSessao(dele)).not.toBeNull();
  });

  it(`último uso só é regravado depois de ${SESSAO_TOQUE_MINUTOS} min`, async () => {
    const u = await usuario();
    const s = await criarSessao(u.id);
    const id = hashSessao(s);
    const inicio = (await db.sessao.findUniqueOrThrow({ where: { id } })).ultimoUsoEm;
    await obterUsuarioDaSessao(s, new Date(inicio.getTime() + 60_000));
    expect((await db.sessao.findUniqueOrThrow({ where: { id } })).ultimoUsoEm).toEqual(inicio);
    const depois = new Date(inicio.getTime() + (SESSAO_TOQUE_MINUTOS + 1) * 60_000);
    await obterUsuarioDaSessao(s, depois);
    expect((await db.sessao.findUniqueOrThrow({ where: { id } })).ultimoUsoEm).toEqual(depois);
  });

  it("sessão devolve a versão da foto (cache-bust do avatar)", async () => {
    const u = await usuario();
    const s = await criarSessao(u.id);
    expect((await obterUsuarioDaSessao(s))?.fotoEm).toBeNull();
    const em = new Date("2026-10-25T12:00:00Z");
    await db.usuarioFoto.create({ data: { usuarioId: u.id, bytes: Buffer.from([1]), mime: "image/webp", atualizadoEm: em } });
    expect((await obterUsuarioDaSessao(s))?.fotoEm).toBe(em.getTime());
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { ehGpDoLado, ladoDe } from "./areas";
import { gerarHashSenha } from "./senha";
import { aceitarConvite, atualizarUsuario, autenticar, criarConvite, listarUsuarios, reemitirConvite } from "./usuarios";
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
  await limparBanco(["sessao", "usuario_foto", "usuario"]);
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

  it("reemitir depois de aceito é rejeitado (não reabre conta ativa)", async () => {
    const a = await admin();
    const c = await criarConvite({ nome: "João", email: "joao@ij.test", papel: "VENDEDOR" }, a);
    if (!c.ok) throw new Error("setup");
    await aceitarConvite(c.token, "senha-forte-1");
    expect(await reemitirConvite(c.usuarioId, a)).toEqual({ ok: false, erro: "CONVITE_INVALIDO" });
    const u = await db.usuario.findUniqueOrThrow({ where: { id: c.usuarioId } });
    expect(u.conviteTokenHash).toBeNull();
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

  it("banco guarda só o hash do cookie, nunca o valor em claro", async () => {
    const a = await admin();
    const id = await criarSessao(a.id);
    expect(await db.sessao.findUnique({ where: { id } })).toBeNull();
    expect(await db.sessao.count({ where: { usuarioId: a.id } })).toBe(1);
    expect(await obterUsuarioDaSessao(id)).not.toBeNull();
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

  it("vendedor edita o próprio nome e telefone", async () => {
    const v = await db.usuario.create({ data: { nome: "V", email: "v@ij.test", papel: "VENDEDOR" } });
    expect(await atualizarUsuario(v.id, { nome: "Vera", telefone: "11 97777-6666" }, v)).toEqual({ ok: true });
    const u = await db.usuario.findUniqueOrThrow({ where: { id: v.id } });
    expect(u.nome).toBe("Vera");
    expect(u.telefoneWhatsapp).toBe("+5511977776666");
  });

  it("vendedor não muda o próprio papel nem se desativa, nem edita outro usuário", async () => {
    const v = await db.usuario.create({ data: { nome: "V", email: "v@ij.test", papel: "VENDEDOR" } });
    const w = await db.usuario.create({ data: { nome: "W", email: "w@ij.test", papel: "VENDEDOR" } });
    expect(await atualizarUsuario(v.id, { papel: "GESTOR" }, v)).toEqual({ ok: false, erro: "PAPEL_NAO_PERMITIDO" });
    expect(await atualizarUsuario(v.id, { ativo: false }, v)).toEqual({ ok: false, erro: "PAPEL_NAO_PERMITIDO" });
    expect(await atualizarUsuario(w.id, { nome: "X" }, v)).toEqual({ ok: false, erro: "PAPEL_NAO_PERMITIDO" });
  });

  it("telefone já usado por outro usuário → TELEFONE_EM_USO", async () => {
    const a = await admin();
    await db.usuario.create({ data: { nome: "V", email: "v@ij.test", papel: "VENDEDOR", telefoneWhatsapp: "+5511977776666" } });
    const w = await db.usuario.create({ data: { nome: "W", email: "w@ij.test", papel: "VENDEDOR" } });
    expect(await atualizarUsuario(w.id, { telefone: "11977776666" }, a)).toEqual({ ok: false, erro: "TELEFONE_EM_USO" });
  });
});

describe("listarUsuarios (GAB-43)", () => {
  it("expõe pedido de nova senha, link ativo/expirado e versão da foto — sem hashes", async () => {
    const a = await admin();
    const agora = Date.now();
    const pediu = await db.usuario.create({
      data: { nome: "Pediu", email: "pediu@ij.test", papel: "VENDEDOR", senhaHash: "x", redefinicaoPedidaEm: new Date(agora - 1000) },
    });
    const ativo = await db.usuario.create({
      data: { nome: "Ativo", email: "ativo@ij.test", papel: "VENDEDOR", senhaHash: "x", redefinicaoTokenHash: "h1", redefinicaoExpiraEm: new Date(agora + 60_000) },
    });
    const vencido = await db.usuario.create({
      data: { nome: "Vencido", email: "vencido@ij.test", papel: "VENDEDOR", senhaHash: "x", redefinicaoTokenHash: "h2", redefinicaoExpiraEm: new Date(agora - 60_000) },
    });
    const fotoEm = new Date("2026-10-26T12:00:00Z");
    await db.usuarioFoto.create({ data: { usuarioId: a.id, bytes: Buffer.from([1, 2, 3]), mime: "image/webp", atualizadoEm: fotoEm } });

    const lista = await listarUsuarios();
    const por = (id: string) => lista.find((u) => u.id === id)!;
    expect(por(pediu.id).redefinicaoPedidaEm).toBeInstanceOf(Date);
    expect(por(pediu.id).redefinicaoLinkAtivo).toBe(false);
    expect(por(ativo.id).redefinicaoLinkAtivo).toBe(true);
    expect(por(vencido.id).redefinicaoLinkAtivo).toBe(false);
    expect(por(a.id).fotoEm).toBe(fotoEm.getTime());
    expect(por(pediu.id).fotoEm).toBeNull();
    for (const u of lista) {
      expect(u).not.toHaveProperty("senhaHash");
      expect(u).not.toHaveProperty("redefinicaoTokenHash");
      expect(u).not.toHaveProperty("foto");
    }
  });
});

describe("área e cargos (GAB-82)", () => {
  let info: MockInstance<typeof console.info>;
  beforeEach(() => {
    info = vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => info.mockRestore());
  const auditoria = () => info.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("[auditoria]"));

  it("convite de projetos com GP grava área PROJETOS e cargo; registra auditoria", async () => {
    const g = await gestor();
    const r = await criarConvite({ nome: "P", email: "p@ij.test", papel: "PROJETOS", area: "VENDAS", cargos: ["GP"] }, g);
    if (!r.ok) throw new Error("setup");
    const u = await db.usuario.findUniqueOrThrow({ where: { id: r.usuarioId } });
    expect(u.papel).toBe("PROJETOS");
    expect(u.area).toBe("PROJETOS"); // área pedida é ignorada: vem do papel
    expect(u.cargos).toEqual(["GP"]);
    expect(auditoria()).toContainEqual(expect.stringMatching(new RegExp(`usuario\\.convidado usuario=${r.usuarioId} por=${g.id} papel=PROJETOS lado=PROJETOS\\[GP\\]`)));
  });

  it("convite de vendedor sem área explícita → VENDAS; visualizador nunca tem lado", async () => {
    const g = await gestor();
    const v = await criarConvite({ nome: "V", email: "v@ij.test", papel: "VENDEDOR" }, g);
    const vis = await criarConvite({ nome: "W", email: "w@ij.test", papel: "VISUALIZADOR", area: "VENDAS", cargos: ["GP"] }, g);
    if (!v.ok || !vis.ok) throw new Error("setup");
    expect(await db.usuario.findUniqueOrThrow({ where: { id: v.usuarioId }, select: { area: true, cargos: true } })).toEqual({ area: "VENDAS", cargos: [] });
    expect(await db.usuario.findUniqueOrThrow({ where: { id: vis.usuarioId }, select: { area: true, cargos: true } })).toEqual({ area: null, cargos: [] });
  });

  it("gestor dá GP a um vendedor; a sessão expõe área/cargos e o log registra de→para", async () => {
    const g = await gestor();
    const v = await db.usuario.create({ data: { nome: "V", email: "v@ij.test", papel: "VENDEDOR", area: "VENDAS" } });
    expect(await atualizarUsuario(v.id, { area: "VENDAS", cargos: ["GP"] }, g)).toEqual({ ok: true });
    const s = await criarSessao(v.id);
    expect(await obterUsuarioDaSessao(s)).toMatchObject({ papel: "VENDEDOR", area: "VENDAS", cargos: ["GP"] });
    expect(auditoria()).toContainEqual(`[auditoria] usuario.lado_alterado usuario=${v.id} por=${g.id} de=VENDAS[] para=VENDAS[GP]`);
  });

  it("vendedor → projetos: área acompanha o papel e o GP de vendas não vira GP de projetos sozinho", async () => {
    const g = await gestor();
    const v = await db.usuario.create({ data: { nome: "V", email: "v@ij.test", papel: "VENDEDOR", area: "VENDAS", cargos: ["GP"] } });
    expect(await atualizarUsuario(v.id, { papel: "PROJETOS" }, g)).toEqual({ ok: true });
    expect(await db.usuario.findUniqueOrThrow({ where: { id: v.id }, select: { papel: true, area: true, cargos: true } })).toEqual({
      papel: "PROJETOS",
      area: "PROJETOS",
      cargos: [],
    });
    expect(auditoria()).toContainEqual(`[auditoria] usuario.papel_alterado usuario=${v.id} por=${g.id} de=VENDEDOR para=PROJETOS`);
    expect(auditoria()).toContainEqual(`[auditoria] usuario.lado_alterado usuario=${v.id} por=${g.id} de=VENDAS[GP] para=PROJETOS[]`);
  });

  it("rebaixar a visualizador limpa área e cargos", async () => {
    const a = await admin();
    const p = await db.usuario.create({ data: { nome: "P", email: "p@ij.test", papel: "PROJETOS", area: "PROJETOS", cargos: ["GP"] } });
    expect(await atualizarUsuario(p.id, { papel: "VISUALIZADOR" }, a)).toEqual({ ok: true });
    expect(await db.usuario.findUniqueOrThrow({ where: { id: p.id }, select: { area: true, cargos: true } })).toEqual({ area: null, cargos: [] });
  });

  it("gestor pode ter lado (ex.: diretor que é GP de vendas) e voltar a nenhum", async () => {
    const a = await admin();
    const g = await gestor();
    expect(await atualizarUsuario(g.id, { area: "VENDAS", cargos: ["GP"] }, a)).toEqual({ ok: true });
    expect(await db.usuario.findUniqueOrThrow({ where: { id: g.id }, select: { area: true, cargos: true } })).toEqual({ area: "VENDAS", cargos: ["GP"] });
    expect(await atualizarUsuario(g.id, { area: null, cargos: ["GP"] }, a)).toEqual({ ok: true });
    expect(await db.usuario.findUniqueOrThrow({ where: { id: g.id }, select: { area: true, cargos: true } })).toEqual({ area: null, cargos: [] });
  });

  it("ninguém se dá cargo nem muda o próprio lado; vendedor/projetos não mexem no lado de ninguém", async () => {
    const g = await gestor();
    const v = await db.usuario.create({ data: { nome: "V", email: "v@ij.test", papel: "VENDEDOR", area: "VENDAS" } });
    const p = await db.usuario.create({ data: { nome: "P", email: "p@ij.test", papel: "PROJETOS", area: "PROJETOS" } });
    expect(await atualizarUsuario(g.id, { area: "VENDAS", cargos: ["GP"] }, g)).toEqual({ ok: false, erro: "NAO_PODE_ALTERAR_A_SI" });
    expect(await atualizarUsuario(v.id, { cargos: ["GP"] }, v)).toEqual({ ok: false, erro: "PAPEL_NAO_PERMITIDO" });
    expect(await atualizarUsuario(v.id, { cargos: ["GP"] }, p)).toEqual({ ok: false, erro: "PAPEL_NAO_PERMITIDO" });
    // mesmo lado reenviado (sem mudança) não bloqueia editar o próprio nome
    expect(await atualizarUsuario(v.id, { nome: "Vera", area: "VENDAS", cargos: [] }, v)).toEqual({ ok: true });
    expect(await db.usuario.count({ where: { cargos: { has: "GP" } } })).toBe(0);
  });

  it("projetos edita o próprio perfil como o vendedor", async () => {
    const p = await db.usuario.create({ data: { nome: "P", email: "p@ij.test", papel: "PROJETOS", area: "PROJETOS" } });
    expect(await atualizarUsuario(p.id, { nome: "Paula" }, p)).toEqual({ ok: true });
    expect(await atualizarUsuario(p.id, { papel: "GESTOR" }, p)).toEqual({ ok: false, erro: "PAPEL_NAO_PERMITIDO" });
  });

  describe("review PR #47: gestor/admin só têm lado quando escolhido explicitamente", () => {
    const ladoDb = (id: string) => db.usuario.findUniqueOrThrow({ where: { id }, select: { papel: true, area: true, cargos: true } });

    it("convite de gestor ou admin sem área → sem lado e sem cargo", async () => {
      const a = await admin();
      const g = await criarConvite({ nome: "G", email: "g2@ij.test", papel: "GESTOR", cargos: ["GP"] }, a);
      const ad = await criarConvite({ nome: "A", email: "a2@ij.test", papel: "ADMIN" }, a);
      if (!g.ok || !ad.ok) throw new Error("setup");
      expect(await ladoDb(g.usuarioId)).toMatchObject({ area: null, cargos: [] });
      expect(await ladoDb(ad.usuarioId)).toMatchObject({ area: null, cargos: [] });
    });

    it("promoção VENDEDOR(GP) → GESTOR sem área no pedido → área null e cargos []", async () => {
      const a = await admin();
      const v = await db.usuario.create({ data: { nome: "V", email: "v@ij.test", papel: "VENDEDOR", area: "VENDAS", cargos: ["GP"] } });
      expect(await atualizarUsuario(v.id, { papel: "GESTOR" }, a)).toEqual({ ok: true });
      const u = await ladoDb(v.id);
      expect(u).toEqual({ papel: "GESTOR", area: null, cargos: [] });
      expect(ehGpDoLado(u, "VENDAS")).toBe(false);
      expect(auditoria()).toContainEqual(`[auditoria] usuario.lado_alterado usuario=${v.id} por=${a.id} de=VENDAS[GP] para=nenhuma[]`);
    });

    it("promoção a GESTOR com área VENDAS + GP explícitos → respeita; GP só se marcado", async () => {
      const a = await admin();
      const v = await db.usuario.create({ data: { nome: "V", email: "v@ij.test", papel: "VENDEDOR", area: "VENDAS", cargos: ["GP"] } });
      const w = await db.usuario.create({ data: { nome: "W", email: "w@ij.test", papel: "VENDEDOR", area: "VENDAS", cargos: ["GP"] } });
      expect(await atualizarUsuario(v.id, { papel: "GESTOR", area: "VENDAS", cargos: ["GP"] }, a)).toEqual({ ok: true });
      expect(await atualizarUsuario(w.id, { papel: "GESTOR", area: "VENDAS", cargos: [] }, a)).toEqual({ ok: true });
      const gv = await ladoDb(v.id);
      expect(gv).toEqual({ papel: "GESTOR", area: "VENDAS", cargos: ["GP"] });
      expect(ladoDe(gv)).toBe("VENDAS");
      expect(ehGpDoLado(gv, "VENDAS")).toBe(true);
      expect(ehGpDoLado(gv, "PROJETOS")).toBe(false);
      expect(await ladoDb(w.id)).toEqual({ papel: "GESTOR", area: "VENDAS", cargos: [] });
    });

    it("admin pode ter lado vendas: definido por outro admin ou por ele mesmo (sem deadlock do único admin), com auditoria", async () => {
      const a = await admin();
      const b = await db.usuario.create({ data: { nome: "B", email: "b@ij.test", papel: "ADMIN" } });
      expect(await atualizarUsuario(b.id, { area: "VENDAS", cargos: ["GP"] }, a)).toEqual({ ok: true });
      expect(ehGpDoLado(await ladoDb(b.id), "VENDAS")).toBe(true);

      // único admin atuando como vendedor: define o próprio lado
      expect(await atualizarUsuario(a.id, { area: "VENDAS", cargos: [] }, a)).toEqual({ ok: true });
      const ua = await ladoDb(a.id);
      expect(ua).toEqual({ papel: "ADMIN", area: "VENDAS", cargos: [] });
      expect(ladoDe(ua)).toBe("VENDAS");
      expect(auditoria()).toContainEqual(`[auditoria] usuario.lado_alterado usuario=${a.id} por=${a.id} proprio=1 de=nenhuma[] para=VENDAS[]`);
      // a exceção é só de lado: admin continua sem poder mudar o próprio papel nem se desativar
      expect(await atualizarUsuario(a.id, { papel: "GESTOR" }, a)).toEqual({ ok: false, erro: "NAO_PODE_ALTERAR_A_SI" });
      expect(await atualizarUsuario(a.id, { ativo: false }, a)).toEqual({ ok: false, erro: "NAO_PODE_ALTERAR_A_SI" });
    });

    it("gestor não define o próprio lado nem o de um admin", async () => {
      const a = await admin();
      const g = await gestor();
      expect(await atualizarUsuario(g.id, { area: "VENDAS" }, g)).toEqual({ ok: false, erro: "NAO_PODE_ALTERAR_A_SI" });
      expect(await atualizarUsuario(a.id, { area: "VENDAS" }, g)).toEqual({ ok: false, erro: "PAPEL_NAO_PERMITIDO" });
    });
  });

  it("listarUsuarios traz área e cargos", async () => {
    await db.usuario.create({ data: { nome: "P", email: "p@ij.test", papel: "PROJETOS", area: "PROJETOS", cargos: ["GP"] } });
    const [u] = await listarUsuarios();
    expect(u).toMatchObject({ papel: "PROJETOS", area: "PROJETOS", cargos: ["GP"] });
  });
});

describe("migração 20261030120000_areas_cargos (backfill)", () => {
  const sql = readFileSync(path.join(process.cwd(), "prisma/migrations/20261030120000_areas_cargos/migration.sql"), "utf8");
  const backfill = sql.split("\n").find((l) => l.startsWith("UPDATE"))!;

  it("vendedor → VENDAS; gestor/admin/visualizador sem área; idempotente e não sobrescreve área já definida", async () => {
    const v = await db.usuario.create({ data: { nome: "V", email: "v@ij.test", papel: "VENDEDOR" } });
    const g = await db.usuario.create({ data: { nome: "G", email: "g@ij.test", papel: "GESTOR" } });
    const a = await db.usuario.create({ data: { nome: "A", email: "a@ij.test", papel: "ADMIN" } });
    const vis = await db.usuario.create({ data: { nome: "W", email: "w@ij.test", papel: "VISUALIZADOR" } });
    const gv = await db.usuario.create({ data: { nome: "GV", email: "gv@ij.test", papel: "GESTOR", area: "PROJETOS" } });
    expect(backfill).toBeDefined();
    await db.$executeRawUnsafe(backfill);
    await db.$executeRawUnsafe(backfill);
    const area = async (id: string) => (await db.usuario.findUniqueOrThrow({ where: { id }, select: { area: true } })).area;
    expect(await area(v.id)).toBe("VENDAS");
    expect(await area(g.id)).toBeNull();
    expect(await area(a.id)).toBeNull();
    expect(await area(vis.id)).toBeNull();
    expect(await area(gv.id)).toBe("PROJETOS");
  });
});

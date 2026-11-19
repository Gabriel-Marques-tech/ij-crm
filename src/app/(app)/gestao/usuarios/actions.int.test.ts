// @vitest-environment node
/**
 * Server actions da Gestão → Usuários com FormData de verdade (inclusive forjado). GAB-107: papel,
 * lado e área de entrada nunca vêm de form; só nome, telefone e, do admin, "Administrador".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";

const { exigirPapel } = vi.hoisted(() => ({ exigirPapel: vi.fn() }));
vi.mock("@/lib/auth/atual", () => ({ exigirPapel }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { adicionarPosicaoUsuarioAction, alternarAtivoAction, criarConviteAction, editarUsuarioAction, encerrarOcupacaoUsuarioAction } = await import("./actions");

const db = dbTeste();

function form(campos: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}

beforeEach(async () => {
  await limparBanco(["sessao", "usuario_foto", "usuario"]);
  exigirPapel.mockReset();
});

describe("editarUsuarioAction (GAB-107): nome, telefone e Administrador; papel/lado nunca à mão", () => {
  const conta = (id: string) => db.usuario.findUniqueOrThrow({ where: { id }, select: { nome: true, papel: true, ativo: true, area: true, cargos: true, areaEntrada: true } });

  async function comAdmin() {
    const a = await db.usuario.create({ data: { nome: "Admin", email: "admin@ij.test", papel: "ADMIN" } });
    exigirPapel.mockResolvedValue({ id: a.id, papel: "ADMIN" });
    return a;
  }

  beforeEach(async () => {
    await limparBanco(["historico_org", "ocupacao", "vinculo_ij", "membro", "posicao", "cargo_org", "area_org"]);
  });

  it("papel, área, cargos, área de entrada e ativo forjados são ignorados para todos (admin e gestor); nome passa", async () => {
    const a = await comAdmin();
    const v = await db.usuario.create({ data: { nome: "Vini", email: "vini@ij.test", papel: "VENDEDOR", area: "VENDAS" } });
    const forjado = { papel: "GESTOR", ativo: "false", ladoNoForm: "1", area: "PROJETOS", cargos: ["DIRETOR"], areaEntrada: "PROJETOS" };
    expect(await editarUsuarioAction(undefined, form({ usuarioId: v.id, nome: "Vini Novo", ...forjado }))).toEqual({ ok: true });
    expect(await conta(v.id)).toEqual({ nome: "Vini Novo", papel: "VENDEDOR", ativo: true, area: "VENDAS", cargos: [], areaEntrada: null });
    // Admin na própria conta: idem (nada de lado à mão).
    expect(await editarUsuarioAction(undefined, form({ usuarioId: a.id, nome: "Admin", ...forjado, papel: "ADMIN" }))).toEqual({ ok: true });
    expect(await conta(a.id)).toMatchObject({ papel: "ADMIN", ativo: true, area: null, cargos: [] });
    const g = await db.usuario.create({ data: { nome: "Gestor", email: "g@ij.test", papel: "GESTOR" } });
    exigirPapel.mockResolvedValue({ id: g.id, papel: "GESTOR" });
    expect(await editarUsuarioAction(undefined, form({ usuarioId: v.id, nome: "Vini", ...forjado }))).toEqual({ ok: true });
    expect(await conta(v.id)).toMatchObject({ nome: "Vini", papel: "VENDEDOR", area: "VENDAS" });
  });

  it("desativar a si mesmo pela action própria continua bloqueado", async () => {
    const a = await comAdmin();
    expect(await alternarAtivoAction(a.id, false)).toEqual({ erro: "Você não pode alterar seu próprio papel ou se desativar." });
    expect((await conta(a.id)).ativo).toBe(true);
  });

  it("Administrador vindo de gestor é ignorado", async () => {
    const g = await db.usuario.create({ data: { nome: "Gestor", email: "g@ij.test", papel: "GESTOR" } });
    exigirPapel.mockResolvedValue({ id: g.id, papel: "GESTOR" });
    const v = await db.usuario.create({ data: { nome: "Vini", email: "vini@ij.test", papel: "VENDEDOR", area: "VENDAS" } });
    expect(await editarUsuarioAction(undefined, form({ usuarioId: v.id, nome: "Vini", adminNoForm: "1", administrador: "1" }))).toEqual({ ok: true });
    expect((await conta(v.id)).papel).toBe("VENDEDOR");
  });

  it("admin marca Administrador (mantém o lado); desmarcar volta às posições só com confirmação da conta resultante", async () => {
    await comAdmin();
    await db.areaOrg.create({ data: { id: "vend", nome: "Vendas", ladoCrm: "VENDAS" } });
    await db.cargoOrg.create({ data: { id: "gpv", nome: "GP", categoria: "LIDERANCA", ehGp: true } });
    await db.posicao.create({ data: { id: "p_gpv", nome: "GP de Vendas", areaId: "vend", cargoId: "gpv" } });
    const v = await db.usuario.create({ data: { nome: "Vini", email: "vini@ij.test", papel: "VENDEDOR", area: "VENDAS", cargos: ["GP"] } });
    const m = await db.membro.create({ data: { nome: "Vini", email: "vini@ij.test", status: "ATIVO", usuarioId: v.id } });
    await db.ocupacao.create({ data: { membroId: m.id, posicaoId: "p_gpv", principal: true } });

    expect(await editarUsuarioAction(undefined, form({ usuarioId: v.id, nome: "Vini", adminNoForm: "1", administrador: "1" }))).toEqual({ ok: true, conta: "Administrador · Vendas · GP" });
    expect(await conta(v.id)).toMatchObject({ papel: "ADMIN", area: "VENDAS", cargos: ["GP"], areaEntrada: "VENDAS" });

    // Desmarcar: pede confirmação mostrando a conta que sai das posições; sem ela, continua admin.
    // Pedido de confirmação não grava nada, nem o nome que veio junto.
    expect(await editarUsuarioAction(undefined, form({ usuarioId: v.id, nome: "Vini Novo", adminNoForm: "1" }))).toMatchObject({
      confirmarConta: { atual: "Administrador · Vendas · GP", conta: "Membro de Vendas · GP", posicoes: ["Vendas · GP"] },
    });
    expect(await conta(v.id)).toMatchObject({ papel: "ADMIN", nome: "Vini" });
    expect(await editarUsuarioAction(undefined, form({ usuarioId: v.id, nome: "Vini", adminNoForm: "1", confirmarConta: "Visualizador (só leitura)" }))).toHaveProperty("confirmarConta");
    expect(await editarUsuarioAction(undefined, form({ usuarioId: v.id, nome: "Vini", adminNoForm: "1", confirmarConta: "Membro de Vendas · GP" }))).toEqual({ ok: true, conta: "Membro de Vendas · GP" });
    expect(await conta(v.id)).toMatchObject({ papel: "VENDEDOR", area: "VENDAS", cargos: ["GP"] });
  });

  it("admin não tira o próprio Administrador", async () => {
    const a = await comAdmin();
    expect(await editarUsuarioAction(undefined, form({ usuarioId: a.id, nome: "Admin", adminNoForm: "1" }))).toEqual({ erro: "Você não pode alterar seu próprio papel ou se desativar." });
    expect((await conta(a.id)).papel).toBe("ADMIN");
  });
});

describe("área de entrada (GAB-97): não é mais perguntada", () => {
  it("GAB-107: convite não pergunta área de entrada; o valor forjado é ignorado e vale a derivada (sem lado = Geral)", async () => {
    const a = await db.usuario.create({ data: { nome: "Admin", email: "admin@ij.test", papel: "ADMIN" } });
    exigirPapel.mockResolvedValue({ id: a.id, papel: "ADMIN" });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await criarConviteAction(undefined, form({ nome: "Vis", email: "vis@ij.test", areaEntrada: "PROJETOS" }))).toHaveProperty("link");
    expect((await db.usuario.findUniqueOrThrow({ where: { email: "vis@ij.test" }, select: { areaEntrada: true } })).areaEntrada).toBe("GERAL");
    const logs = info.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("usuario.convidado"));
    expect(logs[0]).toContain("entrada=GERAL");
    expect(logs[0]).toContain("papel=VISUALIZADOR");
    info.mockRestore();
  });
});

describe("cadastro pela action (GAB-107)", () => {
  const porEmail = (email: string) => db.usuario.findUniqueOrThrow({ where: { email }, select: { papel: true, area: true, cargos: true, areaEntrada: true } });

  async function comGestor() {
    const g = await db.usuario.create({ data: { nome: "Gestor", email: "gestor@ij.test", papel: "GESTOR" } });
    exigirPapel.mockResolvedValue({ id: g.id, papel: "GESTOR" });
    return g;
  }

  it("papel, área, cargos e área de entrada forjados no convite são ignorados (sem posição = Visualizador, Geral)", async () => {
    await comGestor();
    expect(await criarConviteAction(undefined, form({ nome: "Dora", email: "dora@ij.test", papel: "GESTOR", ladoNoForm: "1", area: "PROJETOS", cargos: ["DIRETOR"], areaEntrada: "PROJETOS" }))).toHaveProperty("link");
    expect(await porEmail("dora@ij.test")).toEqual({ papel: "VISUALIZADOR", area: null, cargos: [], areaEntrada: "GERAL" });
  });

  it("Administrador só vale de quem é admin", async () => {
    await comGestor();
    expect(await criarConviteAction(undefined, form({ nome: "Ari", email: "ari@ij.test", administrador: "1" }))).toEqual({ erro: "Você não pode atribuir esse papel." });
    expect(await db.usuario.count({ where: { email: "ari@ij.test" } })).toBe(0);
    const a = await db.usuario.create({ data: { nome: "Admin", email: "admin@ij.test", papel: "ADMIN" } });
    exigirPapel.mockResolvedValue({ id: a.id, papel: "ADMIN" });
    expect(await criarConviteAction(undefined, form({ nome: "Ari", email: "ari@ij.test", administrador: "1" }))).toHaveProperty("link");
    expect(await porEmail("ari@ij.test")).toMatchObject({ papel: "ADMIN", area: null, cargos: [] });
  });

  it("prévia mandada pela tela diferente da conta resultante pede confirmação", async () => {
    await comGestor();
    expect(await criarConviteAction(undefined, form({ nome: "Bia", email: "bia@ij.test", previaConta: "Membro de Vendas" }))).toMatchObject({
      confirmarConta: { atual: "Membro de Vendas", conta: "Visualizador (só leitura)" },
    });
    expect(await db.usuario.count({ where: { email: "bia@ij.test" } })).toBe(0);
    expect(await criarConviteAction(undefined, form({ nome: "Bia", email: "bia@ij.test", previaConta: "Visualizador (só leitura)" }))).toMatchObject({ conta: "Visualizador (só leitura)" });
  });
});

describe("cadastro único pela action (GAB-105)", () => {
  beforeEach(async () => {
    await limparBanco(["historico_org", "ocupacao", "vinculo_ij", "membro", "posicao", "cargo_org", "area_org"]);
    await db.areaOrg.create({ data: { id: "gg", nome: "Gente & Gestão", ehGG: true } });
    await db.cargoOrg.create({ data: { id: "ana", nome: "Analista", categoria: "MEMBRO" } });
    await db.posicao.create({ data: { id: "p_agg", nome: "Analista de G&G", areaId: "gg", cargoId: "ana" } });
  });

  async function gestor() {
    const g = await db.usuario.create({ data: { nome: "Gestor", email: "gestor@ij.test", papel: "GESTOR" } });
    exigirPapel.mockResolvedValue({ id: g.id, nome: g.nome, papel: "GESTOR" });
    return g;
  }

  it("FormData com posicaoId cria conta, membro e ocupação; sem posição (campo vazio) cria conta e membro, sem ocupação", async () => {
    await gestor();
    expect(await criarConviteAction(undefined, form({ nome: "Gabi", email: "gabi@ij.test", papel: "VISUALIZADOR", ladoNoForm: "1", area: "", posicaoId: "p_agg" }))).toHaveProperty("link");
    const u = await db.usuario.findUniqueOrThrow({ where: { email: "gabi@ij.test" }, include: { membro: { include: { ocupacoes: true } } } });
    expect(u.membro?.ocupacoes.map((o) => o.posicaoId)).toEqual(["p_agg"]);
    // A tela de sucesso mostra a conta que o servidor gravou.
    expect(await criarConviteAction(undefined, form({ nome: "Gil", email: "gil@ij.test", posicaoId: "p_agg" }))).toMatchObject({ conta: "Visualizador (só leitura)" });
    expect(await criarConviteAction(undefined, form({ nome: "Nina", email: "nina@ij.test", posicaoId: "" }))).toHaveProperty("link");
    const n = await db.usuario.findUniqueOrThrow({ where: { email: "nina@ij.test" }, include: { membro: { include: { ocupacoes: true } } } });
    expect(n.membro).toMatchObject({ nome: "Nina", status: "ATIVO" });
    expect(n.membro!.ocupacoes).toEqual([]);
  });

  it("GAB-107: ficha que daria outra conta pede confirmação; confirmada, segue (a escolha volta no form)", async () => {
    await gestor();
    await db.areaOrg.create({ data: { id: "pres", nome: "Presidência", tipo: "INSTITUCIONAL" } });
    await db.cargoOrg.create({ data: { id: "presidente", nome: "Presidente", categoria: "DIRETORIA" } });
    await db.posicao.create({ data: { id: "p_pres", nome: "Presidência", areaId: "pres", cargoId: "presidente" } });
    const m = await db.membro.create({ data: { nome: "Pedro", email: "pedro@ij.test" } });
    await db.ocupacao.create({ data: { membroId: m.id, posicaoId: "p_pres", principal: true } });
    const r = await criarConviteAction(undefined, form({ nome: "Pedro", email: "pedro@ij.test" }));
    expect(r).toMatchObject({ confirmarConta: { atual: "Visualizador (só leitura)", conta: "Gestor de Vendas e Projetos", posicoes: ["Presidência · Presidente"] } });
    expect(await db.usuario.findUnique({ where: { email: "pedro@ij.test" } })).toBeNull();
    expect(await criarConviteAction(undefined, form({ nome: "Pedro", email: "pedro@ij.test", confirmarConta: "Gestor de Vendas e Projetos" }))).toMatchObject({ conta: "Gestor de Vendas e Projetos" });
    expect((await db.usuario.findUniqueOrThrow({ where: { email: "pedro@ij.test" } })).papel).toBe("GESTOR");
  });

  it("membro ligado a outra conta: mensagem clara e nada criado", async () => {
    const g = await gestor();
    await db.membro.create({ data: { nome: "Ana", email: "ana@ij.test", usuarioId: g.id } });
    const r = await criarConviteAction(undefined, form({ nome: "Ana", email: "ana@ij.test", papel: "VENDEDOR", posicaoId: "p_agg" }));
    expect(r?.erro).toMatch(/ligado a outra conta/);
    expect(await db.usuario.findUnique({ where: { email: "ana@ij.test" } })).toBeNull();
  });

  it("homônimo sem e-mail: a action pede confirmação e, com ligarMembroId no form, liga e mostra a ficha", async () => {
    await gestor();
    const ana = await db.membro.create({ data: { nome: "Ana Souza" } });
    const campos = { nome: "Ana Souza", email: "ana@ij.test", papel: "VISUALIZADOR", ladoNoForm: "1", area: "", posicaoId: "p_agg" };
    expect(await criarConviteAction(undefined, form(campos))).toEqual({ erro: 'Já existe "Ana Souza" sem e-mail no G&G. É a mesma pessoa?', homonimos: [{ id: ana.id, nome: "Ana Souza" }] });
    const r = await criarConviteAction(undefined, form({ ...campos, ligarMembroId: ana.id }));
    expect(r).toMatchObject({ fichaLigada: { nome: "Ana Souza", posicoes: ["Gente & Gestão · Analista"] } });
    expect(r).toHaveProperty("link");
  });

  it("ligarMembroId forjado (membro que não é homônimo) é recusado no cadastro e na edição", async () => {
    await gestor();
    const carlos = await db.membro.create({ data: { nome: "Carlos Diretor" } });
    const r = await criarConviteAction(undefined, form({ nome: "Zé", email: "ze@ij.test", papel: "VISUALIZADOR", ladoNoForm: "1", area: "", posicaoId: "p_agg", ligarMembroId: carlos.id }));
    expect(r?.erro).toMatch(/não é um homônimo/);
    expect(await db.usuario.findUnique({ where: { email: "ze@ij.test" } })).toBeNull();
    const u = await db.usuario.create({ data: { nome: "Edu", email: "edu@ij.test", papel: "VISUALIZADOR" } });
    expect((await adicionarPosicaoUsuarioAction(u.id, "p_agg", { ligarMembroId: carlos.id }))?.erro).toMatch(/não é um homônimo/);
    expect(await db.membro.findUniqueOrThrow({ where: { id: carlos.id } })).toMatchObject({ usuarioId: null, email: null });
  });

  it("edição: adiciona e encerra posição pela action", async () => {
    await gestor();
    const u = await db.usuario.create({ data: { nome: "Edu", email: "edu@ij.test", papel: "VISUALIZADOR" } });
    expect(await adicionarPosicaoUsuarioAction(u.id, "p_agg")).toEqual({ ok: true, conta: "Visualizador (só leitura)" });
    const o = await db.ocupacao.findFirstOrThrow({ where: { membro: { usuarioId: u.id } } });
    expect(await encerrarOcupacaoUsuarioAction(u.id, o.id)).toEqual({ ok: true, conta: "Visualizador (só leitura)" });
    expect((await db.ocupacao.findUniqueOrThrow({ where: { id: o.id } })).fim).not.toBeNull();
    expect(await encerrarOcupacaoUsuarioAction(u.id, o.id)).toEqual({ erro: expect.stringMatching(/não encontrada/) });
  });
});

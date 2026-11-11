// @vitest-environment node
/**
 * GAB-82 (revisão de segurança do PR #47): a exceção "admin define o próprio
 * lado" não abre brecha para o admin mudar o próprio papel ou se desativar
 * mandando um FormData forjado direto na server action.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";

const { exigirPapel } = vi.hoisted(() => ({ exigirPapel: vi.fn() }));
vi.mock("@/lib/auth/atual", () => ({ exigirPapel }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { alternarAtivoAction, criarConviteAction, editarUsuarioAction } = await import("./actions");

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

describe("editarUsuarioAction: admin editando a si mesmo", () => {
  it("FormData forjado com papel=GESTOR e ativo=false → bloqueado, nada muda", async () => {
    const a = await db.usuario.create({ data: { nome: "Admin", email: "admin@ij.test", papel: "ADMIN" } });
    exigirPapel.mockResolvedValue({ id: a.id, papel: "ADMIN" });
    const r = await editarUsuarioAction(
      undefined,
      form({ usuarioId: a.id, nome: "Admin", papel: "GESTOR", ativo: "false", ladoNoForm: "1", area: "VENDAS", cargos: ["GP"] }),
    );
    expect(r).toEqual({ erro: "Você não pode alterar seu próprio papel ou se desativar." });
    expect(await db.usuario.findUniqueOrThrow({ where: { id: a.id }, select: { papel: true, ativo: true, area: true, cargos: true } })).toEqual({
      papel: "ADMIN",
      ativo: true,
      area: null,
      cargos: [],
    });
  });

  it("`ativo` não é campo do form de edição (é ignorado); desativar a si mesmo pela action própria → bloqueado", async () => {
    const a = await db.usuario.create({ data: { nome: "Admin", email: "admin@ij.test", papel: "ADMIN", area: "VENDAS" } });
    exigirPapel.mockResolvedValue({ id: a.id, papel: "ADMIN" });
    expect(await editarUsuarioAction(undefined, form({ usuarioId: a.id, nome: "Admin", ativo: "false", ladoNoForm: "1", area: "" }))).toEqual({ ok: true });
    expect(await alternarAtivoAction(a.id, false)).toEqual({ erro: "Você não pode alterar seu próprio papel ou se desativar." });
    expect(await db.usuario.findUniqueOrThrow({ where: { id: a.id }, select: { ativo: true, area: true } })).toEqual({ ativo: true, area: null });
  });

  it("form da tela (só lado, sem papel) → admin passa a ter lado vendas", async () => {
    const a = await db.usuario.create({ data: { nome: "Admin", email: "admin@ij.test", papel: "ADMIN" } });
    exigirPapel.mockResolvedValue({ id: a.id, papel: "ADMIN" });
    expect(await editarUsuarioAction(undefined, form({ usuarioId: a.id, nome: "Admin", ladoNoForm: "1", area: "VENDAS" }))).toEqual({ ok: true });
    expect(await db.usuario.findUniqueOrThrow({ where: { id: a.id }, select: { area: true, cargos: true } })).toEqual({ area: "VENDAS", cargos: [] });
  });
});

describe("cargos de Projetos (PM, PO, Diretor) pela server action", () => {
  const ladoDe = (id: string) => db.usuario.findUniqueOrThrow({ where: { id }, select: { papel: true, area: true, cargos: true } });
  const porEmail = (email: string) => db.usuario.findUniqueOrThrow({ where: { email }, select: { papel: true, area: true, cargos: true } });

  async function comGestor() {
    const g = await db.usuario.create({ data: { nome: "Gestor", email: "gestor@ij.test", papel: "GESTOR" } });
    exigirPapel.mockResolvedValue({ id: g.id, papel: "GESTOR" });
    return g;
  }

  it("convite de projetos grava PM e PO; GP pedido para Projetos vira PM", async () => {
    await comGestor();
    expect(await criarConviteAction(undefined, form({ nome: "Paula", email: "paula@ij.test", papel: "PROJETOS", ladoNoForm: "1", area: "PROJETOS", cargos: ["PO", "PM"] }))).toHaveProperty("link");
    expect(await porEmail("paula@ij.test")).toEqual({ papel: "PROJETOS", area: "PROJETOS", cargos: ["PM", "PO"] });
    expect(await criarConviteAction(undefined, form({ nome: "Lia", email: "lia@ij.test", papel: "PROJETOS", ladoNoForm: "1", area: "PROJETOS", cargos: ["GP"] }))).toHaveProperty("link");
    expect(await porEmail("lia@ij.test")).toEqual({ papel: "PROJETOS", area: "PROJETOS", cargos: ["PM"] });
  });

  it("Diretor com papel PROJETOS forjado direto na action não passa; com Gestor e lado Projetos, grava", async () => {
    await comGestor();
    expect(await criarConviteAction(undefined, form({ nome: "Dani", email: "dani@ij.test", papel: "PROJETOS", ladoNoForm: "1", area: "PROJETOS", cargos: ["DIRETOR", "PO"] }))).toHaveProperty("link");
    expect(await porEmail("dani@ij.test")).toEqual({ papel: "PROJETOS", area: "PROJETOS", cargos: ["PO"] });
    expect(await criarConviteAction(undefined, form({ nome: "Dora", email: "dora@ij.test", papel: "GESTOR", ladoNoForm: "1", area: "PROJETOS", cargos: ["DIRETOR"] }))).toHaveProperty("link");
    expect(await porEmail("dora@ij.test")).toEqual({ papel: "GESTOR", area: "PROJETOS", cargos: ["DIRETOR"] });
  });

  it("cargo fora da área é descartado (PM/PO/Diretor em Vendas; GP de vendas segue); valor fora do enum é recusado", async () => {
    await comGestor();
    expect(await criarConviteAction(undefined, form({ nome: "Vini", email: "vini@ij.test", papel: "VENDEDOR", ladoNoForm: "1", area: "VENDAS", cargos: ["PM", "PO", "DIRETOR"] }))).toHaveProperty("link");
    expect(await porEmail("vini@ij.test")).toEqual({ papel: "VENDEDOR", area: "VENDAS", cargos: [] });
    expect(await criarConviteAction(undefined, form({ nome: "Gabi", email: "gabi@ij.test", papel: "GESTOR", ladoNoForm: "1", area: "VENDAS", cargos: ["GP", "DIRETOR"] }))).toHaveProperty("link");
    expect(await porEmail("gabi@ij.test")).toEqual({ papel: "GESTOR", area: "VENDAS", cargos: ["GP"] });
    const r = await criarConviteAction(undefined, form({ nome: "Ceo", email: "ceo@ij.test", papel: "PROJETOS", ladoNoForm: "1", area: "PROJETOS", cargos: ["CEO"] }));
    expect(r).toHaveProperty("erro");
    expect(await db.usuario.count({ where: { email: "ceo@ij.test" } })).toBe(0);
  });

  it("edição: conta antiga com GP em Projetos reeditada pelo form grava PM; marcar Diretor com papel Gestor grava; rebaixar tira", async () => {
    await comGestor();
    const p = await db.usuario.create({ data: { nome: "Pat", email: "pat@ij.test", papel: "PROJETOS", area: "PROJETOS", cargos: ["GP"] } });
    // O form mostra PM marcado (sinônimo) e manda PM.
    expect(await editarUsuarioAction(undefined, form({ usuarioId: p.id, nome: "Pat", papel: "PROJETOS", ladoNoForm: "1", area: "PROJETOS", cargos: ["PM"] }))).toEqual({ ok: true });
    expect(await ladoDe(p.id)).toEqual({ papel: "PROJETOS", area: "PROJETOS", cargos: ["PM"] });
    // Marcar Diretor: o form já trocou o papel para Gestor; o servidor confere de novo.
    expect(await editarUsuarioAction(undefined, form({ usuarioId: p.id, nome: "Pat", papel: "GESTOR", ladoNoForm: "1", area: "PROJETOS", cargos: ["PM", "DIRETOR"] }))).toEqual({ ok: true });
    expect(await ladoDe(p.id)).toEqual({ papel: "GESTOR", area: "PROJETOS", cargos: ["PM", "DIRETOR"] });
    // Form forjado: Diretor com papel PROJETOS não eleva nada.
    expect(await editarUsuarioAction(undefined, form({ usuarioId: p.id, nome: "Pat", papel: "PROJETOS", ladoNoForm: "1", area: "PROJETOS", cargos: ["DIRETOR"] }))).toEqual({ ok: true });
    expect(await ladoDe(p.id)).toEqual({ papel: "PROJETOS", area: "PROJETOS", cargos: [] });
  });
});

describe("área de entrada (GAB-97)", () => {
  const entradaDe = async (id: string) => (await db.usuario.findUniqueOrThrow({ where: { id }, select: { areaEntrada: true } })).areaEntrada;

  async function comAdmin() {
    const a = await db.usuario.create({ data: { nome: "Admin", email: "admin@ij.test", papel: "ADMIN" } });
    exigirPapel.mockResolvedValue({ id: a.id, papel: "ADMIN" });
    return a;
  }

  it("convite de visualizador grava a área escolhida; de vendedor ignora o valor forjado", async () => {
    await comAdmin();
    const base = { ladoNoForm: "1", area: "" };
    expect(await criarConviteAction(undefined, form({ nome: "Vis", email: "vis@ij.test", papel: "VISUALIZADOR", areaEntrada: "PROJETOS", ...base }))).toHaveProperty("link");
    expect(await criarConviteAction(undefined, form({ nome: "Ven", email: "ven@ij.test", papel: "VENDEDOR", areaEntrada: "PROJETOS", ...base }))).toHaveProperty("link");
    const lista = await db.usuario.findMany({ where: { email: { in: ["vis@ij.test", "ven@ij.test"] } }, select: { email: true, areaEntrada: true }, orderBy: { email: "asc" } });
    expect(lista).toEqual([{ email: "ven@ij.test", areaEntrada: null }, { email: "vis@ij.test", areaEntrada: "PROJETOS" }]);
  });

  it("edição grava; valor fora da lista é recusado sem mudar nada", async () => {
    await comAdmin();
    const g = await db.usuario.create({ data: { nome: "Gestor", email: "g@ij.test", papel: "GESTOR" } });
    expect(await editarUsuarioAction(undefined, form({ usuarioId: g.id, nome: "Gestor", ladoNoForm: "1", area: "", areaEntrada: "VENDAS" }))).toEqual({ ok: true });
    expect(await entradaDe(g.id)).toBe("VENDAS");
    expect(await editarUsuarioAction(undefined, form({ usuarioId: g.id, nome: "Gestor", ladoNoForm: "1", area: "", areaEntrada: "TABELA" }))).toEqual({ erro: "Dados inválidos." });
    expect(await entradaDe(g.id)).toBe("VENDAS");
  });

  it("não mexe em usuario.area nem no lado", async () => {
    await comAdmin();
    const v = await db.usuario.create({ data: { nome: "Vis", email: "v@ij.test", papel: "VISUALIZADOR" } });
    await editarUsuarioAction(undefined, form({ usuarioId: v.id, nome: "Vis", ladoNoForm: "1", area: "", areaEntrada: "PROJETOS" }));
    expect(await db.usuario.findUniqueOrThrow({ where: { id: v.id }, select: { area: true, cargos: true, areaEntrada: true } })).toEqual({ area: null, cargos: [], areaEntrada: "PROJETOS" });
  });

  it("gestor sem área que ganha área perde o valor: passa a entrar na própria", async () => {
    await comAdmin();
    const g = await db.usuario.create({ data: { nome: "Gestor", email: "g@ij.test", papel: "GESTOR", areaEntrada: "PROJETOS" } });
    expect(await editarUsuarioAction(undefined, form({ usuarioId: g.id, nome: "Gestor", ladoNoForm: "1", area: "VENDAS", areaEntrada: "" }))).toEqual({ ok: true });
    expect(await entradaDe(g.id)).toBeNull();
  });

  it("mudar o papel para vendedor zera", async () => {
    await comAdmin();
    const v = await db.usuario.create({ data: { nome: "Vis", email: "v@ij.test", papel: "VISUALIZADOR", areaEntrada: "PROJETOS" } });
    expect(await editarUsuarioAction(undefined, form({ usuarioId: v.id, nome: "Vis", papel: "VENDEDOR", ladoNoForm: "1", area: "VENDAS" }))).toEqual({ ok: true });
    expect(await entradaDe(v.id)).toBeNull();
  });

  it("admin define a própria", async () => {
    const a = await comAdmin();
    expect(await editarUsuarioAction(undefined, form({ usuarioId: a.id, nome: "Admin", ladoNoForm: "1", area: "", areaEntrada: "PROJETOS" }))).toEqual({ ok: true });
    expect(await entradaDe(a.id)).toBe("PROJETOS");
  });

  it("gestor sem área não muda a própria com FormData forjado; admin é quem define", async () => {
    const g = await db.usuario.create({ data: { nome: "Gestor", email: "g@ij.test", papel: "GESTOR" } });
    exigirPapel.mockResolvedValue({ id: g.id, papel: "GESTOR" });
    expect(await editarUsuarioAction(undefined, form({ usuarioId: g.id, nome: "Gestor", ladoNoForm: "1", area: "", areaEntrada: "VENDAS" }))).toEqual({
      erro: "Você não pode alterar seu próprio papel ou se desativar.",
    });
    expect(await entradaDe(g.id)).toBeNull();
  });

  it("editar nome sem os campos de lado mantém o valor", async () => {
    await comAdmin();
    const g = await db.usuario.create({ data: { nome: "Gestor", email: "g@ij.test", papel: "GESTOR", areaEntrada: "VENDAS" } });
    expect(await editarUsuarioAction(undefined, form({ usuarioId: g.id, nome: "Gestor Novo" }))).toEqual({ ok: true });
    expect(await entradaDe(g.id)).toBe("VENDAS");
  });

  describe("auditoria", () => {
    const logsDeEntrada = (espiao: { mock: { calls: unknown[][] } }, evento: string) => espiao.mock.calls.map((c) => String(c[0])).filter((l) => l.includes(evento));

    it("editar só o nome reenvia GERAL do form sobre null: sem log, sem gravar e sem barrar", async () => {
      await comAdmin();
      const g = await db.usuario.create({ data: { nome: "Gestor", email: "g@ij.test", papel: "GESTOR" } });
      const info = vi.spyOn(console, "info").mockImplementation(() => {});
      expect(await editarUsuarioAction(undefined, form({ usuarioId: g.id, nome: "Gestor Novo", ladoNoForm: "1", area: "", areaEntrada: "GERAL" }))).toEqual({ ok: true });
      expect(logsDeEntrada(info, "usuario.area_entrada_alterada")).toEqual([]);
      expect(await entradaDe(g.id)).toBeNull();
      info.mockRestore();
    });

    it("gestor sem área salvando o próprio form com GERAL não é barrado", async () => {
      const g = await db.usuario.create({ data: { nome: "Gestor", email: "g@ij.test", papel: "GESTOR" } });
      exigirPapel.mockResolvedValue({ id: g.id, papel: "GESTOR" });
      expect(await editarUsuarioAction(undefined, form({ usuarioId: g.id, nome: "Gestor", ladoNoForm: "1", area: "", areaEntrada: "GERAL" }))).toEqual({ ok: true });
    });

    it("mudança real gera log", async () => {
      await comAdmin();
      const g = await db.usuario.create({ data: { nome: "Gestor", email: "g@ij.test", papel: "GESTOR" } });
      const info = vi.spyOn(console, "info").mockImplementation(() => {});
      await editarUsuarioAction(undefined, form({ usuarioId: g.id, nome: "Gestor", ladoNoForm: "1", area: "", areaEntrada: "PROJETOS" }));
      expect(logsDeEntrada(info, "usuario.area_entrada_alterada")).toEqual([expect.stringContaining("de=nenhuma para=PROJETOS")]);
      info.mockRestore();
    });

    it("quem deixa de usar a coluna fica sem valor, mesmo com GERAL, sem log", async () => {
      await comAdmin();
      const v = await db.usuario.create({ data: { nome: "Vis", email: "v@ij.test", papel: "VISUALIZADOR", areaEntrada: "GERAL" } });
      const info = vi.spyOn(console, "info").mockImplementation(() => {});
      await editarUsuarioAction(undefined, form({ usuarioId: v.id, nome: "Vis", papel: "VENDEDOR", ladoNoForm: "1", area: "VENDAS" }));
      expect(await entradaDe(v.id)).toBeNull();
      expect(logsDeEntrada(info, "usuario.area_entrada_alterada")).toEqual([]);
      info.mockRestore();
    });

    it("usuario.convidado traz entrada=", async () => {
      await comAdmin();
      const info = vi.spyOn(console, "info").mockImplementation(() => {});
      await criarConviteAction(undefined, form({ nome: "Vis", email: "vis@ij.test", papel: "VISUALIZADOR", ladoNoForm: "1", area: "", areaEntrada: "PROJETOS" }));
      await criarConviteAction(undefined, form({ nome: "Ven", email: "ven@ij.test", papel: "VENDEDOR", ladoNoForm: "1", area: "", areaEntrada: "PROJETOS" }));
      const logs = logsDeEntrada(info, "usuario.convidado");
      expect(logs[0]).toContain("entrada=PROJETOS");
      expect(logs[1]).toContain("entrada=nenhuma");
      info.mockRestore();
    });
  });
});

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

class Redirecionou extends Error {
  constructor(readonly para: string) {
    super(`NEXT_REDIRECT ${para}`);
  }
}

const m = vi.hoisted(() => ({
  papel: "ADMIN" as string,
  exigirPapel: vi.fn(),
  salvarConfigTecnica: vi.fn(),
  restaurarConfigTecnica: vi.fn(),
  listarGrupos: vi.fn(),
  obterQr: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));
vi.mock("next/navigation", () => ({ unstable_rethrow: (e: unknown) => { if (e instanceof Error && e.message.startsWith("NEXT_REDIRECT")) throw e; } }));
vi.mock("@/lib/auth/atual", () => ({ exigirPapel: m.exigirPapel }));
vi.mock("@/lib/config/tecnica", () => ({ salvarConfigTecnica: m.salvarConfigTecnica, restaurarConfigTecnica: m.restaurarConfigTecnica }));
vi.mock("@/lib/whatsapp/evolution-admin", async (orig) => ({ ...(await orig()), listarGrupos: m.listarGrupos, obterQr: m.obterQr }));

const { listarGruposAction, mostrarQrAction, restaurarConfigTecnicaAction, salvarConfigTecnicaAction } = await import("./actions");
const { default: AdminLayout } = await import("./layout");
const { ErroEvolutionAdmin } = await import("@/lib/whatsapp/evolution-admin");

function form(campos: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.papel = "ADMIN";
  m.exigirPapel.mockImplementation(async (minimo: string) => {
    if (minimo === "ADMIN" && m.papel !== "ADMIN") throw new Redirecionou("/403");
    return { id: "u1", papel: m.papel };
  });
});

describe("Admin: gestor recebe 403", () => {
  it("layout e todas as actions exigem ADMIN; gestor é redirecionado e nada roda", async () => {
    m.papel = "GESTOR";
    await expect(AdminLayout({ children: null })).rejects.toThrow("/403");
    await expect(salvarConfigTecnicaAction(undefined, form({ grupoJid: "1@g.us" }))).rejects.toThrow("/403");
    await expect(restaurarConfigTecnicaAction(undefined, form({ versao: "1" }))).rejects.toThrow("/403");
    await expect(listarGruposAction()).rejects.toThrow("/403");
    await expect(mostrarQrAction()).rejects.toThrow("/403");
    expect(m.exigirPapel.mock.calls.every(([p]) => p === "ADMIN")).toBe(true);
    expect(m.salvarConfigTecnica).not.toHaveBeenCalled();
    expect(m.listarGrupos).not.toHaveBeenCalled();
    expect(m.obterQr).not.toHaveBeenCalled();
  });
});

describe("salvarConfigTecnicaAction", () => {
  it("campo vazio = herdar do env; números com vírgula; timeout em segundos → ms", async () => {
    m.salvarConfigTecnica.mockResolvedValue({ ok: true, valor: {} });
    const r = await salvarConfigTecnicaAction(
      undefined,
      form({ grupoJid: " 120@g.us ", provedor: "", modeloExtracao: "", modeloClassificacao: "", limiarConfianca: "0,6", limiarSemTag: "", limiarClassificador: "0.5", timeoutEnvioS: "30", versao: "1700000000000" }),
    );
    expect(r).toEqual({ ok: true });
    expect(m.salvarConfigTecnica).toHaveBeenCalledWith(
      { grupoJid: "120@g.us", limiarConfianca: 0.6, limiarClassificador: 0.5, timeoutEnvioMs: 30000 },
      { id: "u1", papel: "ADMIN" },
      new Date(1700000000000),
      { confirmarSemEvolution: false },
    );
    expect(m.revalidatePath).toHaveBeenCalledWith("/gestao/admin");
  });

  it("repassa a mensagem de regra e o conflito", async () => {
    m.salvarConfigTecnica.mockResolvedValueOnce({ ok: false, erro: "DADOS_INVALIDOS", mensagem: "O limiar sem #crm (0.5) precisa…" });
    expect(await salvarConfigTecnicaAction(undefined, form({}))).toEqual({ erro: "O limiar sem #crm (0.5) precisa…" });
    m.salvarConfigTecnica.mockResolvedValueOnce({ ok: false, erro: "CONFLITO" });
    expect(await salvarConfigTecnicaAction(undefined, form({}))).toEqual({ erro: expect.stringMatching(/Outra pessoa alterou/) });
  });

  it("Evolution fora com grupo novo: pede confirmação; com \"salvar mesmo assim\" repassa", async () => {
    m.salvarConfigTecnica.mockResolvedValueOnce({ ok: false, erro: "EVOLUTION_INDISPONIVEL", mensagem: "Não deu para conferir…" });
    expect(await salvarConfigTecnicaAction(undefined, form({ grupoJid: "9@g.us" }))).toEqual({ erro: "Não deu para conferir…", pedirConfirmacao: true });
    m.salvarConfigTecnica.mockResolvedValueOnce({ ok: true, valor: {} });
    await salvarConfigTecnicaAction(undefined, form({ grupoJid: "9@g.us", salvarMesmoAssim: "on" }));
    expect(m.salvarConfigTecnica).toHaveBeenLastCalledWith({ grupoJid: "9@g.us" }, expect.anything(), null, { confirmarSemEvolution: true });
  });

  it("restaurar manda a versão carregada (conflito se mudou)", async () => {
    m.restaurarConfigTecnica.mockResolvedValueOnce({ ok: false, erro: "CONFLITO" });
    expect(await restaurarConfigTecnicaAction(undefined, form({ versao: "1700000000000" }))).toEqual({ erro: expect.stringMatching(/Outra pessoa alterou/) });
    expect(m.restaurarConfigTecnica).toHaveBeenCalledWith({ id: "u1", papel: "ADMIN" }, new Date(1700000000000));
  });

  it("erro inesperado → mensagem com ref", async () => {
    m.salvarConfigTecnica.mockRejectedValue(new Error("db caiu"));
    expect(await salvarConfigTecnicaAction(undefined, form({}))).toMatchObject({ erro: expect.stringMatching(/ref: [0-9a-f]{8}/) });
  });
});

describe("Evolution pelo Admin", () => {
  it("lista grupos; erro da Evolution vira mensagem legível (sem ref)", async () => {
    m.listarGrupos.mockResolvedValueOnce([{ jid: "1@g.us", nome: "IJ", membros: 3 }]);
    expect(await listarGruposAction()).toEqual({ ok: true, grupos: [{ jid: "1@g.us", nome: "IJ", membros: 3 }] });
    m.listarGrupos.mockRejectedValueOnce(new ErroEvolutionAdmin("Evolution group/fetchAllGroups: timeout após 20s"));
    expect(await listarGruposAction()).toEqual({ ok: false, erro: "Evolution group/fetchAllGroups: timeout após 20s" });
  });

  it("QR: devolve o base64 sem logar", async () => {
    m.obterQr.mockResolvedValueOnce({ base64: "data:image/png;base64,SEGREDO" });
    expect(await mostrarQrAction()).toEqual({ ok: true, qr: "data:image/png;base64,SEGREDO" });
    m.obterQr.mockResolvedValueOnce(null);
    expect(await mostrarQrAction()).toEqual({ ok: true, qr: null });
    expect(JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls)).not.toContain("SEGREDO");
  });
});

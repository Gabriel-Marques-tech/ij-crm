import { beforeEach, describe, expect, it, vi } from "vitest";

const { exigirPapel, reprocessarMensagem, resolverManualmente, vincularRemetente, buscarCardsParaVincular, revalidatePath } = vi.hoisted(() => ({
  exigirPapel: vi.fn<(papel: string) => Promise<{ id: string; papel: string }>>(async () => ({ id: "g1", papel: "GESTOR" })),
  reprocessarMensagem: vi.fn(),
  resolverManualmente: vi.fn(),
  vincularRemetente: vi.fn(),
  buscarCardsParaVincular: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/auth/atual", () => ({ exigirPapel }));
vi.mock("@/lib/whatsapp/reprocessar", () => ({ reprocessarMensagem }));
vi.mock("@/lib/whatsapp/painel", () => ({ resolverManualmente, vincularRemetente, buscarCardsParaVincular }));

const { reprocessarAction, resolverAction, vincularRemetenteAction, buscarCardsAction } = await import("./actions");

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("permissão", () => {
  it("toda action exige GESTOR (vendedor → /403 pelo exigirPapel)", async () => {
    const proibido = new Error("NEXT_REDIRECT /403");
    exigirPapel.mockRejectedValue(proibido);
    for (const chamar of [
      () => reprocessarAction("m1"),
      () => resolverAction("m1", { tipo: "VINCULAR", projetoId: "o1" }),
      () => vincularRemetenteAction("r1", "u1"),
      () => buscarCardsAction("x"),
    ]) {
      await chamar().catch(() => {});
    }
    expect(exigirPapel).toHaveBeenCalledTimes(4);
    for (const c of exigirPapel.mock.calls) expect(c[0]).toBe("GESTOR");
    expect(reprocessarMensagem).not.toHaveBeenCalled();
    expect(resolverManualmente).not.toHaveBeenCalled();
    expect(vincularRemetente).not.toHaveBeenCalled();
    expect(buscarCardsParaVincular).not.toHaveBeenCalled();
    exigirPapel.mockResolvedValue({ id: "g1", papel: "GESTOR" });
  });
});

describe("reprocessarAction", () => {
  it("usa a função compartilhada com FALHA e PENDENTE_REVISAO e descreve o desfecho", async () => {
    reprocessarMensagem.mockResolvedValue({ tipo: "PROCESSADA", projetoId: "o1", confirmacao: "✅" });
    expect(await reprocessarAction("m1")).toEqual({ ok: true, aviso: "Processada: card criado/atualizado.", projetoId: "o1" });
    expect(reprocessarMensagem).toHaveBeenCalledWith("m1", ["FALHA", "PENDENTE_REVISAO"]);
    expect(revalidatePath).toHaveBeenCalledWith("/gestao/whatsapp");
  });

  it("falhou de novo → aviso com a ref; fora da fila → erro de regra; erro de banco → INESPERADO com ref", async () => {
    reprocessarMensagem.mockResolvedValue({ tipo: "FALHA", ref: "abcd1234", codigo: "LLM_HTTP", confirmacao: "" });
    expect(await reprocessarAction("m1")).toEqual({ ok: true, aviso: "Falhou de novo (LLM_HTTP, ref: abcd1234)." });
    reprocessarMensagem.mockResolvedValue({ tipo: "NAO_REPROCESSAVEL" });
    expect(await reprocessarAction("m1")).toEqual({ erro: expect.stringContaining("não está mais na fila") });
    reprocessarMensagem.mockResolvedValue({ tipo: "ERRO", ref: "ffff0000" });
    expect(await reprocessarAction("m1")).toEqual({ ok: false, erro: "INESPERADO", ref: "ffff0000" });
  });

  it("id malformado não chega no serviço", async () => {
    expect(await reprocessarAction("")).toEqual({ erro: "Dados inválidos." });
    expect(reprocessarMensagem).not.toHaveBeenCalled();
  });
});

describe("resolverAction", () => {
  it("valida o alvo e traduz erro de regra", async () => {
    expect(await resolverAction("m1", { tipo: "OUTRO" } as never)).toEqual({ erro: "Dados inválidos." });
    resolverManualmente.mockResolvedValue({ ok: false, erro: "MENSAGEM_JA_RESOLVIDA" });
    expect(await resolverAction("m1", { tipo: "CRIAR", titulo: "A", faseId: "f1" })).toEqual({ erro: expect.stringContaining("já foi resolvida") });
    resolverManualmente.mockResolvedValue({ ok: true, projetoId: "o9" });
    expect(await resolverAction("m1", { tipo: "VINCULAR", projetoId: "o9" })).toEqual({ ok: true, projetoId: "o9" });
    expect(resolverManualmente).toHaveBeenLastCalledWith("m1", { tipo: "VINCULAR", projetoId: "o9" }, { id: "g1", papel: "GESTOR" });
  });

  it("exceção → INESPERADO com ref logada", async () => {
    resolverManualmente.mockRejectedValue(new Error("db caiu"));
    expect(await resolverAction("m1", { tipo: "VINCULAR", projetoId: "o9" })).toMatchObject({ ok: false, erro: "INESPERADO", ref: expect.stringMatching(/^[0-9a-f]{8}$/) });
  });
});

describe("vincularRemetenteAction", () => {
  it("traduz erros e revalida usuários", async () => {
    vincularRemetente.mockResolvedValue({ ok: false, erro: "IDENTIFICADOR_EM_USO" });
    expect(await vincularRemetenteAction("r1", "u1")).toEqual({ erro: expect.stringContaining("outro usuário") });
    vincularRemetente.mockResolvedValue({ ok: true });
    expect(await vincularRemetenteAction("r1", "u1")).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith("/gestao/usuarios");
  });
});

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

const { alternarAtivoAction, editarUsuarioAction } = await import("./actions");

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

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Papel } from "@prisma/client";
import { dbTeste, limparBanco } from "@/test/db";

const { exigirUsuario } = vi.hoisted(() => ({ exigirUsuario: vi.fn() }));
vi.mock("@/lib/auth/atual", () => ({ exigirUsuario }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { adicionarOcupanteAction, aplicarNoCrmAction, criarMembroAction, registrarSaidaAction } from "./actions";

const db = dbTeste();
const HOJE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

async function semear() {
  await db.areaOrg.createMany({ data: [{ id: "gg", nome: "Gente & Gestão", ehGG: true }, { id: "rh", nome: "RH", tipo: "FRENTE", superiorId: "gg" }, { id: "proj", nome: "Projetos", ladoCrm: "PROJETOS" }] });
  await db.cargoOrg.createMany({ data: [{ id: "dir", nome: "Diretor", categoria: "DIRETORIA" }, { id: "ger", nome: "Gerente", categoria: "LIDERANCA" }, { id: "mem", nome: "Membro regular", categoria: "MEMBRO" }] });
  await db.posicao.createMany({ data: [{ id: "p_grh", nome: "Gerência de RH", areaId: "rh", cargoId: "ger" }, { id: "p_dproj", nome: "Diretoria de Projetos", areaId: "proj", cargoId: "dir" }, { id: "p_mproj", nome: "Membro de Projetos", areaId: "proj", cargoId: "mem" }] });
  const usuario = async (nome: string, papel: Papel) => {
    const u = await db.usuario.create({ data: { nome, email: `${nome.toLowerCase()}@ij.test`, papel } });
    return { id: u.id, nome, papel };
  };
  return { usuario, alice: await usuario("Alice", "ADMIN") };
}
const como = (u: { id: string; nome: string; papel: Papel }) => exigirUsuario.mockResolvedValue(u);
async function membro(nome: string, email: string | null = null): Promise<string> {
  const r = await criarMembroAction({ nome, email, status: "ATIVO" });
  if (!("ok" in r) || r.ok !== true || !r.id) throw new Error(JSON.stringify(r));
  return r.id;
}

beforeEach(async () => {
  await limparBanco(["historico_org", "importacao_membros", "ocupacao", "vinculo_ij", "membro", "posicao", "cargo_org", "area_org", "sessao", "usuario"]);
  exigirUsuario.mockReset();
});

describe("autorização das actions de G&G", () => {
  it("quem saiu da IJ deixa de editar G&G, mesmo com a ocupação em G&G ainda aberta", async () => {
    const { usuario, alice } = await semear();
    const rita = await usuario("Rita", "VISUALIZADOR");
    como(alice);
    const m = await membro("Rita", "rita@ij.test");
    await adicionarOcupanteAction("p_grh", m, null);
    como(rita);
    expect(await criarMembroAction({ nome: "X", email: null, status: "ATIVO" })).toMatchObject({ ok: true }); // editora hoje
    como(alice);
    expect(await registrarSaidaAction(m, HOJE)).toEqual({ ok: true }); // saída não fecha as ocupações (a ficha pede revisão)
    como(rita);
    expect(await criarMembroAction({ nome: "Y", email: null, status: "ATIVO" })).toEqual({ erro: expect.stringContaining("Gente & Gestão") });
  });

  it("aplicar no CRM: editor de G&G sem gestão não muda conta; gestor não muda a própria; admin não é rebaixado pela sugestão", async () => {
    const { usuario, alice } = await semear();
    const rita = await usuario("Rita", "VISUALIZADOR"); // editora de G&G
    const julia = await usuario("Julia", "GESTOR");
    const bruno = await usuario("Bruno", "ADMIN");
    const caio = await usuario("Caio", "VISUALIZADOR");
    como(alice);
    const mr = await membro("Rita", "rita@ij.test");
    await adicionarOcupanteAction("p_grh", mr, null);
    const mj = await membro("Julia", "julia@ij.test");
    await adicionarOcupanteAction("p_mproj", mj, null);
    const mb = await membro("Bruno", "bruno@ij.test");
    await adicionarOcupanteAction("p_mproj", mb, null);
    const mc = await membro("Caio", "caio@ij.test");
    await adicionarOcupanteAction("p_dproj", mc, null);

    como(rita); // põe alguém (ou a si) na diretoria e tenta aplicar GESTOR
    expect(await aplicarNoCrmAction(mc)).toEqual({ erro: "Só a gestão muda o papel de uma conta." });
    como(julia);
    expect(await aplicarNoCrmAction(mj)).toEqual({ erro: "Você não pode mudar o próprio papel." });
    como(alice);
    expect(await aplicarNoCrmAction(mb)).toEqual({ erro: "Nada a aplicar para este membro." });
    expect((await db.usuario.findUniqueOrThrow({ where: { id: bruno.id } })).papel).toBe("ADMIN");
    expect((await db.usuario.findUniqueOrThrow({ where: { id: caio.id } })).papel).toBe("VISUALIZADOR");
    como(julia); // a gestão aplica normalmente
    expect(await aplicarNoCrmAction(mc)).toEqual({ ok: true });
    expect((await db.usuario.findUniqueOrThrow({ where: { id: caio.id } })).papel).toBe("GESTOR");
  });
});

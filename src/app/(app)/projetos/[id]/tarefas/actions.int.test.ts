// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Area, Cargo, Papel } from "@prisma/client";
import { dbTeste, limparBanco } from "@/test/db";
import { invalidarCachePipelines } from "@/lib/fases/cache";

// `exigirTarefas` (real) usa `exigirUsuario` (mock) e `redirect` (mock que lança como o Next).
const { exigirUsuario, redirect } = vi.hoisted(() => ({ exigirUsuario: vi.fn(), redirect: vi.fn() }));
vi.mock("@/lib/auth/atual", () => ({ exigirUsuario }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", async (orig) => ({ ...(await orig<typeof import("next/navigation")>()), redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { criarTarefaAction, editarTarefaAction, excluirTarefaAction, moverTarefaAction, salvarExibicaoTarefasAction } from "./actions";
import { EXIBICAO_PADRAO } from "@/lib/tarefas/exibicao";
import { lerPreferencias } from "@/lib/preferencias/preferencias";

const db = dbTeste();
const proibido = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/403;307;" });

async function semear() {
  const projetos = await db.pipeline.create({ data: { chave: "projetos", nome: "Projetos", ordem: 1, fases: { create: [{ chave: "exec", nome: "Execução", ordem: 0 }] } }, include: { fases: true } });
  const pessoa = async (nome: string, papel: Papel, area: Area | null = null, cargos: Cargo[] = []) => {
    const u = await db.usuario.create({ data: { nome, email: `${nome.toLowerCase()}@ij.test`, papel, area, cargos } });
    return { id: u.id, nome, email: u.email, papel, area, cargos };
  };
  const paula = await pessoa("Paula", "PROJETOS", "PROJETOS");
  const projeto = await db.projeto.create({ data: { pipelineId: projetos.id, faseId: projetos.fases[0].id, titulo: "Portal do aluno", responsavelId: paula.id, criadoVia: "UI" } });
  return { pessoa, paula, projeto };
}

beforeEach(async () => {
  await limparBanco(["aviso", "tarefa", "transicao_fase", "timeline", "oportunidade", "fase", "pipeline", "sessao", "usuario"]);
  invalidarCachePipelines();
  exigirUsuario.mockReset();
  redirect.mockReset();
  redirect.mockImplementation(() => {
    throw proibido;
  });
});

describe("actions do kanban interno", () => {
  it("quem não é do time de projetos cai em /403 em cada action, sem tocar no banco", async () => {
    const { pessoa, paula, projeto } = await semear();
    const t = await db.tarefa.create({ data: { projetoId: projeto.id, numero: 1, titulo: "X", posicao: 1, criadoPorId: paula.id } });
    const recusados = [
      await pessoa("Ana", "VENDEDOR", "VENDAS"),
      await pessoa("Gabi", "GESTOR", "VENDAS"),
      await pessoa("Vera", "VISUALIZADOR"),
    ];
    for (const quem of recusados) {
      exigirUsuario.mockResolvedValue(quem);
      await expect(criarTarefaAction(projeto.id, { titulo: "Y" })).rejects.toBe(proibido);
      await expect(editarTarefaAction(projeto.id, t.id, { titulo: "Z" })).rejects.toBe(proibido);
      await expect(moverTarefaAction(projeto.id, t.id, { status: "FEITA", posicao: 1 })).rejects.toBe(proibido);
      await expect(excluirTarefaAction(projeto.id, t.id)).rejects.toBe(proibido);
    }
    expect(redirect).toHaveBeenCalledTimes(12);
    expect(redirect).toHaveBeenCalledWith("/403");
    expect(await db.tarefa.findMany()).toEqual([expect.objectContaining({ titulo: "X", status: "A_FAZER", deletadoEm: null })]);
  });

  it("time de projetos: cria, edita, move e exclui; dados inválidos são recusados antes do serviço", async () => {
    const { paula, projeto } = await semear();
    exigirUsuario.mockResolvedValue(paula);
    const criada = await criarTarefaAction(projeto.id, { titulo: "Modelar tabela", prazo: "2026-11-10" });
    expect(criada).toEqual({ ok: true, id: expect.any(String), numero: 1 });
    if (!("ok" in criada) || criada.ok !== true || !criada.id) throw new Error();

    expect(await editarTarefaAction(projeto.id, criada.id, { descricao: "Turmas e matrículas", status: "EM_ANDAMENTO" })).toEqual({ ok: true });
    expect(await moverTarefaAction(projeto.id, criada.id, { status: "EM_REVISAO", posicao: 0.5 })).toEqual({ ok: true });
    expect(await db.tarefa.findUniqueOrThrow({ where: { id: criada.id } })).toMatchObject({ status: "EM_REVISAO", posicao: 0.5, descricao: "Turmas e matrículas" });

    expect(await criarTarefaAction(projeto.id, { titulo: "" })).toEqual({ erro: "Dados inválidos." });
    expect(await criarTarefaAction(projeto.id, { titulo: "X", prazo: "10/11/2026" })).toEqual({ erro: "Dados inválidos." });
    expect(await moverTarefaAction(projeto.id, criada.id, { status: "FEITA", posicao: Number.NaN })).toEqual({ erro: "Dados inválidos." });
    expect(await moverTarefaAction(projeto.id, criada.id, { status: "INVENTADO", posicao: 1 })).toEqual({ erro: "Dados inválidos." });
    expect(await editarTarefaAction(projeto.id, "outra", { titulo: "Z" })).toEqual({ erro: "Tarefa não encontrada neste projeto." });

    expect(await excluirTarefaAction(projeto.id, criada.id)).toEqual({ ok: true });
    expect((await db.tarefa.findUniqueOrThrow({ where: { id: criada.id } })).deletadoEm).toBeInstanceOf(Date);
    expect(await db.timeline.count()).toBe(0);
  });
});

describe("exibição por pessoa", () => {
  it("salva o bloco validado nas preferências do usuário da sessão; inválido é recusado", async () => {
    const { paula } = await semear();
    exigirUsuario.mockResolvedValue(paula);
    expect(await salvarExibicaoTarefasAction({ ...EXIBICAO_PADRAO, vista: "lista", dens: "compacta" })).toEqual({ ok: true });
    const u = await db.usuario.findUniqueOrThrow({ where: { id: paula.id } });
    expect(lerPreferencias(u.preferencias).tarefas).toMatchObject({ vista: "lista", dens: "compacta" });
    expect(await salvarExibicaoTarefasAction({ vista: "mapa" })).toEqual({ erro: "Dados inválidos." });
  });
});

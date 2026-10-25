import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { obterPreferencias, salvarVisualizacaoKanban } from "./servico";

// A action pega o usuário da sessão; aqui a sessão é quem o teste disser.
const sessao = vi.hoisted(() => ({ atual: { id: "", nome: "", email: "", papel: "VENDEDOR" as const } }));
vi.mock("@/lib/auth/atual", () => ({ exigirUsuario: async () => sessao.atual }));

const db = dbTeste();

async function semear() {
  await db.pipeline.create({
    data: {
      chave: "vendas",
      nome: "Vendas",
      ordem: 0,
      fases: { create: [{ chave: "primeiro_contato", nome: "Primeiro Contato", ordem: 0 }, { chave: "perdido", nome: "Perdido", ordem: 1, isTerminal: true, tipoTerminal: "PERDIDO" }] },
    },
  });
  const ana = await db.usuario.create({ data: { nome: "Ana", email: "ana@ij.test" } });
  const bruno = await db.usuario.create({ data: { nome: "Bruno", email: "bruno@ij.test" } });
  return { ana, bruno };
}

beforeEach(async () => {
  await limparBanco(["transicao_fase", "timeline", "oportunidade", "fase", "pipeline", "sessao", "usuario"]);
  invalidarCachePipelines();
});

describe("preferências de visualização (integração)", () => {
  it("sem nada gravado → padrão", async () => {
    const { ana } = await semear();
    expect(await obterPreferencias(ana.id)).toEqual({ v: 1, kanban: {} });
  });

  it("salva e lê as próprias; chave de fase inexistente é descartada ao gravar", async () => {
    const { ana } = await semear();
    const r = await salvarVisualizacaoKanban(ana.id, "vendas", { mostrarVazias: true, abertas: ["perdido", "nao_existe"] });
    expect(r).toEqual({ ok: true });
    expect(await obterPreferencias(ana.id)).toEqual({ v: 1, kanban: { vendas: { mostrarVazias: true, abertas: ["perdido"] } } });
  });

  it("não mexe nas preferências de outro usuário", async () => {
    const { ana, bruno } = await semear();
    await salvarVisualizacaoKanban(bruno.id, "vendas", { mostrarVazias: false, abertas: ["perdido"] });
    await salvarVisualizacaoKanban(ana.id, "vendas", { mostrarVazias: true, abertas: [] });
    expect((await obterPreferencias(bruno.id)).kanban.vendas).toEqual({ mostrarVazias: false, abertas: ["perdido"] });
  });

  it("recusa quadro inexistente e entrada inválida, sem gravar", async () => {
    const { ana } = await semear();
    expect(await salvarVisualizacaoKanban(ana.id, "xpto", { mostrarVazias: true, abertas: [] })).toEqual({ ok: false, erro: "QUADRO_INEXISTENTE" });
    expect(await salvarVisualizacaoKanban(ana.id, "vendas", { mostrarVazias: "sim", abertas: [] })).toEqual({ ok: false, erro: "DADOS_INVALIDOS" });
    expect((await db.usuario.findUniqueOrThrow({ where: { id: ana.id } })).preferencias).toBeNull();
  });

  it("JSON corrompido no banco → padrão na leitura, e gravar por cima conserta", async () => {
    const { ana } = await semear();
    await db.usuario.update({ where: { id: ana.id }, data: { preferencias: { v: 9, lixo: true } } });
    expect(await obterPreferencias(ana.id)).toEqual({ v: 1, kanban: {} });
    await salvarVisualizacaoKanban(ana.id, "vendas", { mostrarVazias: true, abertas: [] });
    expect(await obterPreferencias(ana.id)).toEqual({ v: 1, kanban: { vendas: { mostrarVazias: true, abertas: [] } } });
  });

  it("action grava só no usuário da sessão (não aceita id de outro)", async () => {
    const { ana, bruno } = await semear();
    const { salvarVisualizacaoKanbanAction } = await import("@/app/(app)/kanban/actions");
    sessao.atual = { id: ana.id, nome: ana.nome, email: ana.email, papel: "VENDEDOR" };
    // Mesmo que o cliente tente mandar um usuarioId, a assinatura não o tem e ele é ignorado.
    const r = await salvarVisualizacaoKanbanAction("vendas", { mostrarVazias: true, abertas: [], usuarioId: bruno.id } as never);
    expect(r).toEqual({ ok: true });
    expect((await obterPreferencias(ana.id)).kanban.vendas?.mostrarVazias).toBe(true);
    expect((await db.usuario.findUniqueOrThrow({ where: { id: bruno.id } })).preferencias).toBeNull();
  });
});

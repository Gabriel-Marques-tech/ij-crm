// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import type { Area, Papel } from "@prisma/client";
import { dbTeste, limparBanco } from "@/test/db";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { criarTarefa, editarTarefa, listarQuadro, podeVerTarefasNoProjeto } from "@/lib/tarefas/tarefas";
import { adicionarAEquipe, cargaPorPessoa, escalaDoProjeto, listarEquipe, mudarFuncao, projetosDe, tirarDaEquipe } from "./equipe";

const db = dbTeste();

async function semear() {
  const quadro = (chave: string, ordem: number) =>
    db.pipeline.create({ data: { chave, nome: chave, ordem, fases: { create: [{ chave: `${chave}_1`, nome: "Fase", ordem: 0 }] } }, include: { fases: true } });
  const vendas = await quadro("vendas", 0);
  const projetos = await quadro("projetos", 1);
  const pessoa = async (nome: string, papel: Papel, area: Area | null = null) => {
    const u = await db.usuario.create({ data: { nome, email: `${nome.toLowerCase()}@ij.test`, papel, area } });
    return { id: u.id, nome, papel, area, cargos: [] as never[] };
  };
  const paula = await pessoa("Paula", "PROJETOS", "PROJETOS");
  const pedro = await pessoa("Pedro", "PROJETOS", "PROJETOS");
  const lucas = await pessoa("Lucas", "PROJETOS", "PROJETOS");
  const guto = await pessoa("Guto", "GESTOR", "PROJETOS");
  const ana = await pessoa("Ana", "VENDEDOR", "VENDAS");
  const projeto = await db.projeto.create({ data: { pipelineId: projetos.id, faseId: projetos.fases[0].id, titulo: "Portal", responsavelId: paula.id, criadoVia: "UI" } });
  const outro = await db.projeto.create({ data: { pipelineId: projetos.id, faseId: projetos.fases[0].id, titulo: "App", responsavelId: paula.id, criadoVia: "UI" } });
  const venda = await db.projeto.create({ data: { pipelineId: vendas.id, faseId: vendas.fases[0].id, titulo: "Site", responsavelId: ana.id, criadoVia: "UI" } });
  return { paula, pedro, lucas, guto, ana, projeto, outro, venda };
}

beforeEach(async () => {
  await limparBanco(["aviso", "projeto_membro", "tarefa", "projeto_handoff", "oportunidade", "fase", "pipeline", "usuario"]);
  invalidarCachePipelines();
});

describe("equipe do projeto", () => {
  it("sem equipe, o time inteiro vê; com equipe, só quem está escalado vê e recebe tarefa", async () => {
    const { paula, pedro, lucas, guto, projeto } = await semear();
    expect(await podeVerTarefasNoProjeto(projeto.id, lucas)).toBe(true);
    expect(await adicionarAEquipe(projeto.id, pedro.id, "SCRUM_MASTER", paula)).toEqual({ ok: true }); // Paula é a responsável do card
    expect(await podeVerTarefasNoProjeto(projeto.id, lucas)).toBe(false);
    expect(await podeVerTarefasNoProjeto(projeto.id, pedro)).toBe(true);
    expect(await podeVerTarefasNoProjeto(projeto.id, paula)).toBe(true); // responsável do card conta como escalada
    expect(await podeVerTarefasNoProjeto(projeto.id, guto)).toBe(true); // diretoria

    expect(await listarQuadro(projeto.id, lucas)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await criarTarefa(projeto.id, { titulo: "X" }, lucas)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await criarTarefa(projeto.id, { titulo: "X", responsavelId: lucas.id }, pedro)).toEqual({ ok: false, erro: "RESPONSAVEL_INVALIDO" });
    const t = await criarTarefa(projeto.id, { titulo: "X", responsavelId: pedro.id }, guto);
    expect(t.ok).toBe(true);
    const q = await listarQuadro(projeto.id, pedro);
    if (!q.ok) throw new Error();
    expect(q.pessoas.map((p) => p.nome).sort()).toEqual(["Paula", "Pedro"]);
  });

  it("quem sai da equipe deixa de ver; a tarefa dele fica e pode ser mantida até reatribuir", async () => {
    const { paula, pedro, lucas, projeto } = await semear();
    await adicionarAEquipe(projeto.id, pedro.id, "MEMBRO", paula);
    await adicionarAEquipe(projeto.id, lucas.id, "PO", paula);
    const t = await criarTarefa(projeto.id, { titulo: "X", responsavelId: lucas.id }, paula);
    if (!t.ok) throw new Error();
    const { atuais } = await listarEquipe(projeto.id);
    const vagaLucas = atuais.find((m) => m.usuarioId === lucas.id)!;
    expect(vagaLucas.funcao).toBe("PO");
    expect(await mudarFuncao(projeto.id, vagaLucas.id, "PM", paula)).toEqual({ ok: true });
    expect(await tirarDaEquipe(projeto.id, vagaLucas.id, paula)).toEqual({ ok: true });
    expect(await podeVerTarefasNoProjeto(projeto.id, lucas)).toBe(false);
    // A tarefa continua dele, e editar outro campo não exige reatribuir.
    expect(await editarTarefa(projeto.id, t.id, { titulo: "Y" }, paula)).toEqual({ ok: true });
    const l = await listarEquipe(projeto.id);
    expect(l.atuais.map((m) => m.nome)).toEqual(["Pedro"]);
    expect(l.antigos.map((m) => m.nome)).toEqual(["Lucas"]);
    // Volta: nova vaga, histórico preservado.
    expect(await adicionarAEquipe(projeto.id, lucas.id, "MEMBRO", paula)).toEqual({ ok: true });
    expect(await adicionarAEquipe(projeto.id, lucas.id, "MEMBRO", paula)).toEqual({ ok: false, erro: "JA_NA_EQUIPE" });
  });

  it("quem monta: diretoria, GP e responsável do card; vendas e card fora de Projetos recusam", async () => {
    const { paula, pedro, lucas, guto, ana, projeto, venda } = await semear();
    expect(await adicionarAEquipe(projeto.id, lucas.id, "MEMBRO", pedro)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await adicionarAEquipe(projeto.id, lucas.id, "MEMBRO", guto)).toEqual({ ok: true });
    await db.projetoHandoff.create({ data: { projetoId: projeto.id, gpProjetoId: pedro.id } });
    expect((await escalaDoProjeto(projeto.id))?.gpId).toBe(pedro.id);
    expect(await adicionarAEquipe(projeto.id, paula.id, "PM", pedro)).toEqual({ ok: true }); // agora é o GP
    expect(await adicionarAEquipe(projeto.id, ana.id, "MEMBRO", guto)).toEqual({ ok: false, erro: "PESSOA_INVALIDA" });
    expect(await adicionarAEquipe(venda.id, lucas.id, "MEMBRO", guto)).toEqual({ ok: false, erro: "PROJETO_NAO_ENCONTRADO" });
  });

  it("aviso no sino para quem entra (não para quem se põe); projetos e carga da pessoa", async () => {
    const { paula, pedro, projeto, outro } = await semear();
    await adicionarAEquipe(projeto.id, pedro.id, "SCRUM_MASTER", paula);
    await adicionarAEquipe(outro.id, paula.id, "PM", paula);
    await adicionarAEquipe(outro.id, pedro.id, "MEMBRO", paula);
    const avisos = await db.aviso.findMany({ select: { usuarioId: true, tipo: true, titulo: true } });
    expect(avisos).toHaveLength(2);
    expect(avisos.every((a) => a.usuarioId === pedro.id && a.tipo === "EQUIPE_PROJETO")).toBe(true);
    expect(avisos[0].titulo).toMatch(/Paula te colocou na equipe de (Portal|App) como/);
    expect((await projetosDe(pedro.id)).map((p) => p.titulo).sort()).toEqual(["App", "Portal"]);
    await criarTarefa(projeto.id, { titulo: "X", responsavelId: pedro.id }, paula);
    expect((await cargaPorPessoa([pedro.id, paula.id])).get(pedro.id)).toEqual({ projetos: 2, tarefas: 1 });
    // Projeto concluído não é carga atual; projeto na lixeira leva as tarefas junto.
    const concluido = await db.fase.create({ data: { pipelineId: outro.pipelineId, chave: "concluido", nome: "Concluído", ordem: 1, isTerminal: true, tipoTerminal: "GANHO" } });
    await db.projeto.update({ where: { id: outro.id }, data: { faseId: concluido.id } });
    expect((await cargaPorPessoa([pedro.id])).get(pedro.id)).toEqual({ projetos: 1, tarefas: 1 });
    await db.projeto.update({ where: { id: projeto.id }, data: { deletadoEm: new Date() } });
    expect((await cargaPorPessoa([pedro.id])).get(pedro.id)).toEqual({ projetos: 0, tarefas: 0 });
  });
});

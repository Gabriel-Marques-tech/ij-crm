// @vitest-environment node
/**
 * Kanban interno × equipe do projeto (spec G&G no CRM §2): quem vê, quem recebe,
 * e o que acontece com o responsável que sai. Complementa `tarefas.int.test.ts`
 * (sem equipe) e `projetos/equipe.int.test.ts` (a equipe em si).
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Area, Cargo, Papel } from "@prisma/client";
import { dbTeste, limparBanco } from "@/test/db";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { adicionarAEquipe, listarEquipe, tirarDaEquipe } from "@/lib/projetos/equipe";
import { criarTarefa, editarTarefa, excluirTarefa, listarQuadro, moverTarefa, podeVerTarefasNoProjeto, type Ator } from "./tarefas";

const db = dbTeste();

async function semear() {
  const quadro = (chave: string, ordem: number) =>
    db.pipeline.create({ data: { chave, nome: chave, ordem, fases: { create: [{ chave: `${chave}_1`, nome: "Fase", ordem: 0 }] } }, include: { fases: true } });
  const vendas = await quadro("vendas", 0);
  const projetos = await quadro("projetos", 1);
  const pessoa = async (nome: string, papel: Papel, area: Area | null = null, cargos: Cargo[] = []): Promise<Ator> => {
    const u = await db.usuario.create({ data: { nome, email: `${nome.toLowerCase()}@ij.test`, papel, area, cargos } });
    return { id: u.id, nome, papel, area, cargos };
  };
  const paula = await pessoa("Paula", "PROJETOS", "PROJETOS"); // responsável do card
  const pedro = await pessoa("Pedro", "PROJETOS", "PROJETOS");
  const lucas = await pessoa("Lucas", "PROJETOS", "PROJETOS");
  const gil = await pessoa("Gil", "GESTOR"); // diretoria sem área
  const ana = await pessoa("Ana", "VENDEDOR", "VENDAS");
  const projeto = await db.projeto.create({ data: { pipelineId: projetos.id, faseId: projetos.fases[0].id, titulo: "Portal", responsavelId: paula.id, criadoVia: "UI" } });
  const outro = await db.projeto.create({ data: { pipelineId: projetos.id, faseId: projetos.fases[0].id, titulo: "App", responsavelId: paula.id, criadoVia: "UI" } });
  const venda = await db.projeto.create({ data: { pipelineId: vendas.id, faseId: vendas.fases[0].id, titulo: "Site", responsavelId: ana.id, criadoVia: "UI" } });
  return { paula, pedro, lucas, gil, ana, projeto, outro, venda };
}

beforeEach(async () => {
  await limparBanco(["aviso", "membro", "projeto_membro", "tarefa", "projeto_handoff", "timeline", "oportunidade", "fase", "pipeline", "usuario"]);
  invalidarCachePipelines();
});

const tarefa = (id: string) => db.tarefa.findUniqueOrThrow({ where: { id } });

describe("com equipe montada", () => {
  it("quem não está escalado é recusado em toda operação, sem tocar em nada; GP do handoff e diretoria passam", async () => {
    const { paula, pedro, lucas, gil, projeto } = await semear();
    const t = await criarTarefa(projeto.id, { titulo: "Antes da equipe" }, lucas); // sem equipe: aberto ao time
    if (!t.ok) throw new Error();
    await adicionarAEquipe(projeto.id, pedro.id, "MEMBRO", paula);

    expect(await listarQuadro(projeto.id, lucas)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await criarTarefa(projeto.id, { titulo: "Y" }, lucas)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await editarTarefa(projeto.id, t.id, { titulo: "Z" }, lucas)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await moverTarefa(projeto.id, t.id, { status: "FEITA", posicao: 9 }, lucas)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await excluirTarefa(projeto.id, t.id, lucas)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await tarefa(t.id)).toMatchObject({ titulo: "Antes da equipe", status: "A_FAZER", posicao: 1, deletadoEm: null });
    expect(await db.tarefa.count()).toBe(1);

    // GP do handoff conta como escalado mesmo fora da equipe; diretoria vê sempre.
    await db.projetoHandoff.create({ data: { projetoId: projeto.id, gpProjetoId: lucas.id } });
    expect(await podeVerTarefasNoProjeto(projeto.id, lucas)).toBe(true);
    expect((await listarQuadro(projeto.id, lucas)).ok).toBe(true);
    expect((await editarTarefa(projeto.id, t.id, { titulo: "Do GP" }, lucas)).ok).toBe(true);
    expect((await listarQuadro(projeto.id, gil)).ok).toBe(true);
  });

  it("projeto sem equipe fica aberto ao time inteiro, e só ao time", async () => {
    const { lucas, pedro, ana, projeto } = await semear();
    expect(await podeVerTarefasNoProjeto(projeto.id, lucas)).toBe(true);
    const t = await criarTarefa(projeto.id, { titulo: "X", responsavelId: pedro.id }, lucas);
    expect(t.ok).toBe(true);
    const q = await listarQuadro(projeto.id, lucas);
    if (!q.ok) throw new Error();
    // Sem equipe, quem pode receber = time de Projetos + diretoria; vendedor nunca.
    expect(q.pessoas.map((p) => p.nome)).toEqual(["Gil", "Lucas", "Paula", "Pedro"]);
    expect(q.pessoas.every((p) => p.podeReceber)).toBe(true);
    expect(await podeVerTarefasNoProjeto(projeto.id, ana)).toBe(false);
    expect(await criarTarefa(projeto.id, { titulo: "Y", responsavelId: ana.id }, lucas)).toEqual({ ok: false, erro: "RESPONSAVEL_INVALIDO" });
  });

  it("responsável que saiu continua listado (sem poder receber nova) e a tarefa dele anda sem reatribuir", async () => {
    const { paula, pedro, lucas, projeto } = await semear();
    await adicionarAEquipe(projeto.id, pedro.id, "MEMBRO", paula);
    await adicionarAEquipe(projeto.id, lucas.id, "MEMBRO", paula);
    const t = await criarTarefa(projeto.id, { titulo: "Do Lucas", responsavelId: lucas.id }, paula);
    if (!t.ok) throw new Error();
    const vaga = (await listarEquipe(projeto.id)).atuais.find((m) => m.usuarioId === lucas.id)!;
    expect(await tirarDaEquipe(projeto.id, vaga.id, paula)).toEqual({ ok: true });

    const q = await listarQuadro(projeto.id, paula);
    if (!q.ok) throw new Error();
    expect(q.tarefas.map((x) => x.responsavelId)).toEqual([lucas.id]);
    expect(q.pessoas.find((p) => p.id === lucas.id)).toMatchObject({ nome: "Lucas", ativo: true, podeReceber: false });
    expect(q.pessoas.find((p) => p.id === pedro.id)).toMatchObject({ podeReceber: true });

    // Mexer na tarefa dele (mover, editar, até reafirmar o mesmo responsável) não confere de novo.
    expect(await moverTarefa(projeto.id, t.id, { status: "EM_ANDAMENTO", posicao: 3 }, paula)).toEqual({ ok: true });
    expect(await moverTarefa(projeto.id, t.id, { status: "EM_REVISAO", posicao: 3, responsavelId: lucas.id }, paula)).toEqual({ ok: true });
    expect(await editarTarefa(projeto.id, t.id, { prioridade: "ALTA", responsavelId: lucas.id }, paula)).toEqual({ ok: true });
    // Mas não recebe tarefa nova nem volta a receber outra.
    expect(await criarTarefa(projeto.id, { titulo: "Nova", responsavelId: lucas.id }, paula)).toEqual({ ok: false, erro: "RESPONSAVEL_INVALIDO" });
    const outra = await criarTarefa(projeto.id, { titulo: "Do Pedro", responsavelId: pedro.id }, paula);
    if (!outra.ok) throw new Error();
    expect(await moverTarefa(projeto.id, outra.id, { status: "A_FAZER", posicao: 1, responsavelId: lucas.id }, paula)).toEqual({ ok: false, erro: "RESPONSAVEL_INVALIDO" });
    expect((await tarefa(outra.id)).responsavelId).toBe(pedro.id);

    // Reatribuir tira o Lucas da lista de pessoas.
    expect(await editarTarefa(projeto.id, t.id, { responsavelId: pedro.id }, paula)).toEqual({ ok: true });
    const q2 = await listarQuadro(projeto.id, paula);
    expect(q2.ok && q2.pessoas.some((p) => p.id === lucas.id)).toBe(false);
  });

  it("afastado no G&G vem marcado na lista de pessoas", async () => {
    const { paula, pedro, projeto } = await semear();
    await db.membro.create({ data: { nome: "Pedro", status: "AFASTADO", usuarioId: pedro.id } });
    const q = await listarQuadro(projeto.id, paula);
    if (!q.ok) throw new Error();
    expect(q.pessoas.find((p) => p.id === pedro.id)?.afastado).toBe(true);
    expect(q.pessoas.find((p) => p.id === paula.id)?.afastado).toBe(false);
  });
});

describe("portão da página", () => {
  it("null para card fora de Projetos, excluído ou inexistente; false para quem não é do time", async () => {
    const { paula, ana, projeto, venda } = await semear();
    expect(await podeVerTarefasNoProjeto(venda.id, paula)).toBeNull();
    expect(await podeVerTarefasNoProjeto("nao-existe", paula)).toBeNull();
    expect(await podeVerTarefasNoProjeto(projeto.id, ana)).toBe(false);
    await db.projeto.update({ where: { id: projeto.id }, data: { deletadoEm: new Date() } });
    expect(await podeVerTarefasNoProjeto(projeto.id, paula)).toBeNull();
    expect(await listarQuadro(projeto.id, paula)).toEqual({ ok: false, erro: "PROJETO_NAO_ENCONTRADO" });
  });
});

describe("arrastar e subtarefas", () => {
  it("ordem manual persiste: reordenar na coluna e mover para outra coluna", async () => {
    const { paula, projeto } = await semear();
    const ids: string[] = [];
    for (const titulo of ["A", "B", "C"]) {
      const r = await criarTarefa(projeto.id, { titulo }, paula);
      if (!r.ok) throw new Error();
      ids.push(r.id);
    }
    const ordem = async () => {
      const q = await listarQuadro(projeto.id, paula);
      if (!q.ok) throw new Error();
      return q.tarefas.map((t) => `${t.status}:${t.titulo}`);
    };
    // C entre A (1) e B (2).
    expect(await moverTarefa(projeto.id, ids[2], { status: "A_FAZER", posicao: 1.5 }, paula)).toEqual({ ok: true });
    expect(await ordem()).toEqual(["A_FAZER:A", "A_FAZER:C", "A_FAZER:B"]);
    // A para o topo de Em andamento (coluna vazia → 1).
    expect(await moverTarefa(projeto.id, ids[0], { status: "EM_ANDAMENTO", posicao: 1 }, paula)).toEqual({ ok: true });
    const q = await listarQuadro(projeto.id, paula);
    if (!q.ok) throw new Error();
    expect(q.tarefas.filter((t) => t.status === "A_FAZER").map((t) => t.titulo)).toEqual(["C", "B"]);
    expect(q.tarefas.filter((t) => t.status === "EM_ANDAMENTO").map((t) => t.titulo)).toEqual(["A"]);
    expect(await moverTarefa(projeto.id, ids[0], { status: "FEITA", posicao: Number.POSITIVE_INFINITY }, paula)).toEqual({ ok: false, erro: "DADOS_INVALIDOS" });
  });

  it("subtarefa não pode ter pai de outro projeto nem pai excluído", async () => {
    const { paula, projeto, outro } = await semear();
    const paiOutro = await criarTarefa(outro.id, { titulo: "Pai do App" }, paula);
    const paiExcluido = await criarTarefa(projeto.id, { titulo: "Pai excluído" }, paula);
    if (!paiOutro.ok || !paiExcluido.ok) throw new Error();
    await excluirTarefa(projeto.id, paiExcluido.id, paula);
    expect(await criarTarefa(projeto.id, { titulo: "Filha", paiId: paiOutro.id }, paula)).toEqual({ ok: false, erro: "DADOS_INVALIDOS" });
    expect(await criarTarefa(projeto.id, { titulo: "Filha", paiId: paiExcluido.id }, paula)).toEqual({ ok: false, erro: "DADOS_INVALIDOS" });
    expect(await db.tarefa.count({ where: { paiId: { not: null } } })).toBe(0);
  });
});

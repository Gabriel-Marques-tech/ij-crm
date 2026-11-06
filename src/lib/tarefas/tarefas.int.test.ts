// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import type { Area, Cargo, Papel } from "@prisma/client";
import { dbTeste, limparBanco } from "@/test/db";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { criarTarefa, editarTarefa, excluirTarefa, listarQuadro, moverTarefa, resumoTarefas, type Ator } from "./tarefas";

const db = dbTeste();

async function semear() {
  const quadro = (chave: string, nome: string, ordem: number) =>
    db.pipeline.create({ data: { chave, nome, ordem, fases: { create: [{ chave: `${chave}_1`, nome: "Fase", ordem: 0 }] } }, include: { fases: true } });
  const vendas = await quadro("vendas", "Vendas", 0);
  const projetos = await quadro("projetos", "Projetos", 1);
  const pessoa = async (nome: string, papel: Papel, area: Area | null = null, cargos: Cargo[] = []): Promise<Ator> => {
    const u = await db.usuario.create({ data: { nome, email: `${nome.toLowerCase()}@ij.test`, papel, area, cargos } });
    return { id: u.id, nome: u.nome, papel, area, cargos };
  };
  const paula = await pessoa("Paula", "PROJETOS", "PROJETOS");
  const pedro = await pessoa("Pedro", "PROJETOS", "PROJETOS");
  const gestorProj = await pessoa("Guto", "GESTOR", "PROJETOS", ["GP"]);
  const admin = await pessoa("Alice", "ADMIN");
  const ana = await pessoa("Ana", "VENDEDOR", "VENDAS");
  const gestorVendas = await pessoa("Gabi", "GESTOR", "VENDAS");
  const gestorSemArea = await pessoa("Gil", "GESTOR");
  const visual = await pessoa("Vera", "VISUALIZADOR");
  const projeto = await db.projeto.create({
    data: { pipelineId: projetos.id, faseId: projetos.fases[0].id, titulo: "Portal do aluno", responsavelId: paula.id, criadoVia: "UI" },
  });
  const venda = await db.projeto.create({
    data: { pipelineId: vendas.id, faseId: vendas.fases[0].id, titulo: "Site da Padaria", responsavelId: ana.id, criadoVia: "UI" },
  });
  return { vendas, projetos, paula, pedro, gestorProj, admin, ana, gestorVendas, gestorSemArea, visual, projeto, venda };
}

beforeEach(async () => {
  await limparBanco(["aviso", "tarefa", "transicao_fase", "timeline", "oportunidade", "fase", "pipeline", "sessao", "usuario"]);
  invalidarCachePipelines();
});

const tarefa = (id: string) => db.tarefa.findUniqueOrThrow({ where: { id } });

describe("numeração por projeto", () => {
  it("#1, #2… em sequência; criações simultâneas nunca repetem; número excluído não volta", async () => {
    const { projeto, paula } = await semear();
    const a = await criarTarefa(projeto.id, { titulo: "Modelar tabela" }, paula);
    const b = await criarTarefa(projeto.id, { titulo: "Tela de login" }, paula);
    expect(a).toMatchObject({ ok: true, numero: 1 });
    expect(b).toMatchObject({ ok: true, numero: 2 });

    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => criarTarefa(projeto.id, { titulo: `Paralela ${i}` }, paula)));
    const numeros = rs.map((r) => (r.ok ? r.numero : -1)).sort((x, y) => x - y);
    expect(numeros).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

    const ultima = rs.find((r) => r.ok && r.numero === 12);
    if (!ultima?.ok) throw new Error("sem #12");
    expect(await excluirTarefa(projeto.id, ultima.id, paula)).toEqual({ ok: true });
    expect(await criarTarefa(projeto.id, { titulo: "Depois da exclusão" }, paula)).toMatchObject({ ok: true, numero: 13 });
  });

  it("posição: nova tarefa vai para o fim da coluna", async () => {
    const { projeto, paula } = await semear();
    const a = await criarTarefa(projeto.id, { titulo: "A" }, paula);
    const b = await criarTarefa(projeto.id, { titulo: "B" }, paula);
    const c = await criarTarefa(projeto.id, { titulo: "C", status: "EM_ANDAMENTO" }, paula);
    if (!a.ok || !b.ok || !c.ok) throw new Error();
    expect([(await tarefa(a.id)).posicao, (await tarefa(b.id)).posicao, (await tarefa(c.id)).posicao]).toEqual([1, 2, 1]);
  });
});

describe("quem acessa (spec §5)", () => {
  it("vendedor, gestor de vendas e visualizador são recusados em toda operação", async () => {
    const { projeto, paula, ana, gestorVendas, visual } = await semear();
    const t = await criarTarefa(projeto.id, { titulo: "X" }, paula);
    if (!t.ok) throw new Error();
    for (const quem of [ana, gestorVendas, visual]) {
      expect(await listarQuadro(projeto.id, quem)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
      expect(await criarTarefa(projeto.id, { titulo: "Y" }, quem)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
      expect(await editarTarefa(projeto.id, t.id, { titulo: "Z" }, quem)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
      expect(await moverTarefa(projeto.id, t.id, { status: "FEITA", posicao: 1 }, quem)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
      expect(await excluirTarefa(projeto.id, t.id, quem)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    }
    expect((await tarefa(t.id)).titulo).toBe("X");
    expect(await db.tarefa.count()).toBe(1);
  });

  it("PROJETOS, gestor de projetos, diretoria sem área e admin passam", async () => {
    const { projeto, paula, gestorProj, gestorSemArea, admin } = await semear();
    for (const quem of [paula, gestorProj, gestorSemArea, admin]) {
      const t = await criarTarefa(projeto.id, { titulo: `De ${quem.nome}` }, quem);
      expect(t.ok).toBe(true);
      const q = await listarQuadro(projeto.id, quem);
      expect(q.ok).toBe(true);
    }
    const q = await listarQuadro(projeto.id, admin);
    if (!q.ok) throw new Error();
    expect(q.tarefas.map((t) => t.numero)).toEqual([1, 2, 3, 4]);
    // Pessoas que podem receber tarefa: só quem passa na regra (ordem por nome).
    expect(q.pessoas.map((p) => p.nome)).toEqual(["Alice", "Gil", "Guto", "Paula", "Pedro"]);
  });
});

describe("escopo do projeto", () => {
  it("card fora do quadro de Projetos não tem kanban interno; ao sair e voltar, as tarefas reaparecem", async () => {
    const { projeto, venda, vendas, projetos, paula } = await semear();
    expect(await criarTarefa(venda.id, { titulo: "X" }, paula)).toEqual({ ok: false, erro: "PROJETO_NAO_ENCONTRADO" });
    expect(await listarQuadro(venda.id, paula)).toEqual({ ok: false, erro: "PROJETO_NAO_ENCONTRADO" });

    const t = await criarTarefa(projeto.id, { titulo: "Fica no banco" }, paula);
    if (!t.ok) throw new Error();
    await db.projeto.update({ where: { id: projeto.id }, data: { pipelineId: vendas.id, faseId: vendas.fases[0].id } });
    expect(await listarQuadro(projeto.id, paula)).toEqual({ ok: false, erro: "PROJETO_NAO_ENCONTRADO" });
    expect(await editarTarefa(projeto.id, t.id, { titulo: "Nada" }, paula)).toEqual({ ok: false, erro: "PROJETO_NAO_ENCONTRADO" });
    expect(await db.tarefa.count({ where: { projetoId: projeto.id, deletadoEm: null } })).toBe(1);

    await db.projeto.update({ where: { id: projeto.id }, data: { pipelineId: projetos.id, faseId: projetos.fases[0].id } });
    const q = await listarQuadro(projeto.id, paula);
    expect(q.ok && q.tarefas.map((x) => x.titulo)).toEqual(["Fica no banco"]);
  });

  it("tarefa de outro projeto ou já excluída: recusa sem tocar em nada", async () => {
    const { projeto, projetos, paula } = await semear();
    const outro = await db.projeto.create({ data: { pipelineId: projetos.id, faseId: projetos.fases[0].id, titulo: "Outro", responsavelId: paula.id, criadoVia: "UI" } });
    const t = await criarTarefa(outro.id, { titulo: "Do outro" }, paula);
    if (!t.ok) throw new Error();
    expect(await editarTarefa(projeto.id, t.id, { titulo: "Roubada" }, paula)).toEqual({ ok: false, erro: "TAREFA_NAO_ENCONTRADA" });
    expect(await moverTarefa(projeto.id, t.id, { status: "FEITA", posicao: 1 }, paula)).toEqual({ ok: false, erro: "TAREFA_NAO_ENCONTRADA" });
    expect(await excluirTarefa(projeto.id, t.id, paula)).toEqual({ ok: false, erro: "TAREFA_NAO_ENCONTRADA" });
    expect(await tarefa(t.id)).toMatchObject({ titulo: "Do outro", status: "A_FAZER", deletadoEm: null });

    expect(await excluirTarefa(outro.id, t.id, paula)).toEqual({ ok: true });
    expect(await editarTarefa(outro.id, t.id, { titulo: "Zumbi" }, paula)).toEqual({ ok: false, erro: "TAREFA_NAO_ENCONTRADA" });
  });

  it("nada disso gera linha na Timeline do card", async () => {
    const { projeto, paula, pedro } = await semear();
    const t = await criarTarefa(projeto.id, { titulo: "X", responsavelId: pedro.id, prazo: "2026-11-10" }, paula);
    if (!t.ok) throw new Error();
    await editarTarefa(projeto.id, t.id, { descricao: "detalhe", status: "EM_ANDAMENTO" }, paula);
    await moverTarefa(projeto.id, t.id, { status: "FEITA", posicao: 2, responsavelId: paula.id }, pedro);
    await excluirTarefa(projeto.id, t.id, paula);
    expect(await db.timeline.count()).toBe(0);
  });
});

describe("campos", () => {
  it("entrar em FEITA/CANCELADA preenche concluidaEm; sair limpa; mover na mesma coluna não mexe", async () => {
    const { projeto, paula } = await semear();
    const t = await criarTarefa(projeto.id, { titulo: "X" }, paula);
    if (!t.ok) throw new Error();
    expect((await tarefa(t.id)).concluidaEm).toBeNull();
    await editarTarefa(projeto.id, t.id, { status: "FEITA" }, paula);
    const feita = (await tarefa(t.id)).concluidaEm;
    expect(feita).toBeInstanceOf(Date);
    await moverTarefa(projeto.id, t.id, { status: "CANCELADA", posicao: 5 }, paula);
    expect((await tarefa(t.id)).concluidaEm).toEqual(feita); // fechada → fechada: mantém
    await moverTarefa(projeto.id, t.id, { status: "A_FAZER", posicao: 1 }, paula);
    expect((await tarefa(t.id)).concluidaEm).toBeNull();
  });

  it("prazo é só dia (DATE); título vazio ou prazo inválido são recusados", async () => {
    const { projeto, paula } = await semear();
    const t = await criarTarefa(projeto.id, { titulo: "  Com prazo  ", prazo: "2026-11-10" }, paula);
    if (!t.ok) throw new Error();
    const q = await listarQuadro(projeto.id, paula);
    expect(q.ok && q.tarefas[0]).toMatchObject({ titulo: "Com prazo", prazo: "2026-11-10" });
    expect(await editarTarefa(projeto.id, t.id, { prazo: null }, paula)).toEqual({ ok: true });
    expect((await tarefa(t.id)).prazo).toBeNull();
    expect(await criarTarefa(projeto.id, { titulo: "   " }, paula)).toEqual({ ok: false, erro: "DADOS_INVALIDOS" });
    expect(await criarTarefa(projeto.id, { titulo: "X", prazo: "2026-02-30" }, paula)).toEqual({ ok: false, erro: "DADOS_INVALIDOS" });
    expect(await criarTarefa(projeto.id, { titulo: "X", prazo: "10/11/2026" }, paula)).toEqual({ ok: false, erro: "DADOS_INVALIDOS" });
  });

  it("excluir a pai leva as subtarefas; subtarefa só tem um nível", async () => {
    const { projeto, paula } = await semear();
    const pai = await criarTarefa(projeto.id, { titulo: "Pai" }, paula);
    if (!pai.ok) throw new Error();
    const f1 = await criarTarefa(projeto.id, { titulo: "Filha 1", paiId: pai.id }, paula);
    const f2 = await criarTarefa(projeto.id, { titulo: "Filha 2", paiId: pai.id }, paula);
    if (!f1.ok || !f2.ok) throw new Error();
    expect(await criarTarefa(projeto.id, { titulo: "Neta", paiId: f1.id }, paula)).toEqual({ ok: false, erro: "DADOS_INVALIDOS" });
    expect(await excluirTarefa(projeto.id, pai.id, paula)).toEqual({ ok: true });
    const vivas = await db.tarefa.findMany({ where: { projetoId: projeto.id, deletadoEm: null } });
    expect(vivas).toHaveLength(0);
  });
});

describe("responsável e avisos", () => {
  const avisos = () => db.aviso.findMany({ orderBy: { criadoEm: "asc" }, select: { usuarioId: true, tipo: true, titulo: true, projetoId: true, whatsapp: true } });

  it("atribuir a outra pessoa avisa no sino (sem WhatsApp); a si mesmo não; mover sem mudar responsável não", async () => {
    const { projeto, paula, pedro } = await semear();
    const t = await criarTarefa(projeto.id, { titulo: "Validação de CPF", responsavelId: pedro.id }, paula);
    if (!t.ok) throw new Error();
    expect(await avisos()).toEqual([
      { usuarioId: pedro.id, tipo: "TAREFA_ATRIBUIDA", titulo: "Paula te atribuiu #1 Validação de CPF em Portal do aluno", projetoId: projeto.id, whatsapp: null },
    ]);

    await moverTarefa(projeto.id, t.id, { status: "EM_ANDAMENTO", posicao: 1 }, paula); // mesmo responsável
    await editarTarefa(projeto.id, t.id, { titulo: "Validação de CPF duplicado" }, paula);
    expect(await avisos()).toHaveLength(1);

    await editarTarefa(projeto.id, t.id, { responsavelId: paula.id }, paula); // para si mesma
    expect(await avisos()).toHaveLength(1);

    await moverTarefa(projeto.id, t.id, { status: "EM_ANDAMENTO", posicao: 2, responsavelId: pedro.id }, paula); // linha de outra pessoa
    expect(await avisos()).toHaveLength(2);
  });

  it("responsável precisa passar na regra de acesso e estar ativo", async () => {
    const { projeto, paula, ana, pedro } = await semear();
    expect(await criarTarefa(projeto.id, { titulo: "X", responsavelId: ana.id }, paula)).toEqual({ ok: false, erro: "RESPONSAVEL_INVALIDO" });
    await db.usuario.update({ where: { id: pedro.id }, data: { ativo: false } });
    expect(await criarTarefa(projeto.id, { titulo: "X", responsavelId: pedro.id }, paula)).toEqual({ ok: false, erro: "RESPONSAVEL_INVALIDO" });
    expect(await db.tarefa.count()).toBe(0);
  });

  it("desativar o responsável não quebra o quadro: a tarefa continua na linha dele e dá para reatribuir", async () => {
    const { projeto, paula, pedro } = await semear();
    const t = await criarTarefa(projeto.id, { titulo: "X", responsavelId: pedro.id }, paula);
    if (!t.ok) throw new Error();
    await db.usuario.update({ where: { id: pedro.id }, data: { ativo: false } });
    const q = await listarQuadro(projeto.id, paula);
    if (!q.ok) throw new Error();
    expect(q.tarefas[0].responsavelId).toBe(pedro.id);
    expect(q.pessoas.find((p) => p.id === pedro.id)).toMatchObject({ nome: "Pedro", ativo: false });
    expect(await editarTarefa(projeto.id, t.id, { responsavelId: paula.id }, paula)).toEqual({ ok: true });
  });
});

describe("prioridade e etiquetas (etapa 2)", () => {
  it("cria e edita com prioridade; etiquetas normalizadas, sem repetição; quadro devolve as etiquetas em uso", async () => {
    const { projeto, paula } = await semear();
    const t = await criarTarefa(projeto.id, { titulo: "X", prioridade: "ALTA", etiquetas: [" Backend ", "backend", "Infra  Prod", ""] }, paula);
    if (!t.ok) throw new Error();
    expect(await tarefa(t.id)).toMatchObject({ prioridade: "ALTA", etiquetas: ["backend", "infra prod"] });
    expect(await editarTarefa(projeto.id, t.id, { prioridade: "URGENTE", etiquetas: ["qa"] }, paula)).toEqual({ ok: true });
    expect(await tarefa(t.id)).toMatchObject({ prioridade: "URGENTE", etiquetas: ["qa"] });
    await criarTarefa(projeto.id, { titulo: "Y", etiquetas: ["backend"] }, paula);
    const q = await listarQuadro(projeto.id, paula);
    expect(q.ok && q.etiquetas).toEqual(["backend", "qa"]);
    expect(await editarTarefa(projeto.id, t.id, { prioridade: "INVENTADA" as never }, paula)).toEqual({ ok: false, erro: "DADOS_INVALIDOS" });
  });
});

describe("resumo para a visão geral do projeto", () => {
  it("conta abertas, minhas e atrasadas; feitas, canceladas e excluídas ficam fora", async () => {
    const { projeto, paula, pedro } = await semear();
    const ids = await Promise.all([
      criarTarefa(projeto.id, { titulo: "Minha atrasada", responsavelId: paula.id, prazo: "2026-11-01" }, paula),
      criarTarefa(projeto.id, { titulo: "Do Pedro", responsavelId: pedro.id, prazo: "2026-11-20" }, paula),
      criarTarefa(projeto.id, { titulo: "Feita atrasada", responsavelId: paula.id, prazo: "2026-11-01", status: "FEITA" }, paula),
      criarTarefa(projeto.id, { titulo: "Excluída", responsavelId: paula.id }, paula),
    ]);
    const excluida = ids[3];
    if (!excluida.ok) throw new Error();
    await excluirTarefa(projeto.id, excluida.id, paula);
    expect(await resumoTarefas(projeto.id, paula.id, "2026-11-04")).toEqual({ abertas: 2, minhas: 1, atrasadas: 1 });
  });
});

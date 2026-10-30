import { beforeEach, describe, expect, it } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { removerFase } from "@/lib/fases/fases";
import { adicionarPonto, criarContato } from "@/lib/contatos/contatos";
import { encontrarContatoPorIdentificador } from "@/lib/contatos/match";
import { criarEmpresa } from "@/lib/empresas/empresas";
import { criarCard, obterCard } from "@/lib/projetos/projetos";
import { listarQuadro } from "@/lib/projetos/projetos";
import { listarCardsDoVendedor } from "@/lib/semana/semana";
import { travarPipelines } from "@/lib/fases/fases";
import { vincularAoCard } from "@/lib/projetos/vinculos";
import { apagarCardDefinitivo, excluirCard, restaurarCard } from "./cards";
import { apagarEntidadeDefinitivo, excluirEntidade, restaurarEntidade } from "./entidades";
import { listarCardsNaLixeira, listarContatosNaLixeira } from "./lixeira";
import { mensagemLixeira } from "./regras";

const db = dbTeste();

async function semear() {
  const vendas = await db.pipeline.create({
    data: {
      chave: "vendas",
      nome: "Vendas",
      ordem: 0,
      fases: {
        create: [
          { chave: "primeiro_contato", nome: "Primeiro Contato", ordem: 0 },
          { chave: "proposta", nome: "Proposta", ordem: 1 },
          { chave: "contrato_assinado", nome: "Contrato assinado", ordem: 2, isTerminal: true, tipoTerminal: "GANHO" },
          { chave: "perdido", nome: "Perdido", ordem: 3, isTerminal: true, tipoTerminal: "PERDIDO" },
        ],
      },
    },
    include: { fases: true },
  });
  const projetos = await db.pipeline.create({
    data: { chave: "projetos", nome: "Projetos", ordem: 1, fases: { create: [{ chave: "em_execucao", nome: "Em execução", ordem: 0 }] } },
    include: { fases: true },
  });
  const vend = await db.usuario.create({ data: { nome: "Vera Vendedora", email: "v@ij.test", papel: "VENDEDOR" } });
  const gestor = await db.usuario.create({ data: { nome: "Gil Gestor", email: "g@ij.test", papel: "GESTOR" } });
  const admin = await db.usuario.create({ data: { nome: "Ada Admin", email: "a@ij.test", papel: "ADMIN" } });
  const r = await criarCard({ pipelineId: vendas.id, faseId: fase(vendas, "proposta").id, titulo: "Site da padaria" }, vend);
  if (!r.ok) throw new Error(r.erro);
  return { vendas, projetos, vend, gestor, admin, cardId: r.id };
}

const fase = (p: { fases: { chave: string; id: string }[] }, chave: string) => p.fases.find((f) => f.chave === chave)!;

/** Card de projetos ligado à venda como a v1 deixava (o ganho não cria mais, GAB-81; dados antigos têm). */
async function projetoLegado(projetos: { id: string; fases: { chave: string; id: string }[] }, vendaId: string, extra: { absorvidoPorId?: string; deletadoEm?: Date } = {}) {
  const v = await db.projeto.findUniqueOrThrow({ where: { id: vendaId } });
  return db.projeto.create({
    data: { pipelineId: projetos.id, faseId: fase(projetos, "em_execucao").id, titulo: v.titulo, responsavelId: v.responsavelId, criadoVia: "UI", vendaOrigemId: vendaId, ...extra },
  });
}
const tipos = async (id: string) => (await db.timeline.findMany({ where: { projetoId: id }, orderBy: [{ em: "asc" }, { id: "asc" }] })).map((t) => t.tipo);

beforeEach(async () => {
  await limparBanco(["mensagem_enviada", "transicao_fase", "timeline", "oportunidade", "contato_ponto", "contato", "empresa", "fase", "pipeline", "sessao", "usuario"]);
  invalidarCachePipelines();
});

describe("soft-delete e restauração de card", () => {
  it("qualquer usuário exclui: some do Kanban, da Minha Semana e do detalhe; Timeline registra quem/quando", async () => {
    const { vend, cardId } = await semear();
    expect(await excluirCard(cardId, vend)).toEqual({ ok: true });

    expect((await listarQuadro("vendas"))!.cards).toHaveLength(0);
    expect(await listarCardsDoVendedor(vend.id)).toHaveLength(0);
    expect(await obterCard(cardId)).toBeNull();
    const ex = await db.timeline.findFirstOrThrow({ where: { projetoId: cardId, tipo: "EXCLUSAO" } });
    expect(ex.usuarioId).toBe(vend.id);

    const lix = await listarCardsNaLixeira("padaria");
    expect(lix).toMatchObject([{ id: cardId, porNome: "Vera Vendedora", fase: { nome: "Proposta", arquivada: false }, opcoesFase: [] }]);
    // De novo: já está na lixeira.
    expect(await excluirCard(cardId, vend)).toMatchObject({ ok: false, erro: "CARD_NAO_ENCONTRADO" });
  });

  it("restaurar: vendedor recebe SEM_PERMISSAO; gestor devolve para a mesma fase", async () => {
    const { vendas, vend, gestor, cardId } = await semear();
    await excluirCard(cardId, vend);
    expect(await restaurarCard(cardId, vend)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await restaurarCard(cardId, gestor)).toEqual({ ok: true, faseId: fase(vendas, "proposta").id });
    expect((await listarQuadro("vendas"))!.cards.map((c) => c.id)).toEqual([cardId]);
    expect(await tipos(cardId)).toEqual(["CRIACAO", "EXCLUSAO", "RESTAURACAO"]);
    expect(await restaurarCard(cardId, gestor)).toMatchObject({ ok: false, erro: "NAO_ESTA_NA_LIXEIRA" });
  });

  it("fase arquivada enquanto na lixeira → erro de regra pedindo fase; com fase do mesmo tipo, move e registra", async () => {
    const { vendas, vend, gestor, cardId } = await semear();
    await excluirCard(cardId, vend);
    // Só card soft-deletado na fase → é arquivada (não apagada).
    expect(await removerFase(fase(vendas, "proposta").id, {}, gestor)).toEqual({ ok: true, acao: "ARQUIVAR" });
    invalidarCachePipelines();

    expect(await restaurarCard(cardId, gestor)).toEqual({ ok: false, erro: "FASE_ARQUIVADA_ESCOLHA", fase: { id: fase(vendas, "proposta").id, nome: "Proposta" } });
    const [lix] = await listarCardsNaLixeira();
    expect(lix.opcoesFase.map((f) => f.nome)).toEqual(["Primeiro Contato"]); // só abertas ativas
    expect(await restaurarCard(cardId, gestor, { faseId: fase(vendas, "perdido").id })).toMatchObject({ ok: false, erro: "FASE_INCOMPATIVEL" });
    expect(await restaurarCard(cardId, gestor, { faseId: fase(vendas, "proposta").id })).toMatchObject({ ok: false, erro: "FASE_INVALIDA" });

    expect(await restaurarCard(cardId, gestor, { faseId: fase(vendas, "primeiro_contato").id })).toEqual({ ok: true, faseId: fase(vendas, "primeiro_contato").id });
    const card = await db.projeto.findUniqueOrThrow({ where: { id: cardId } });
    expect([card.deletadoEm, card.faseId]).toEqual([null, fase(vendas, "primeiro_contato").id]);
    expect(await tipos(cardId)).toEqual(["CRIACAO", "EXCLUSAO", "RESTAURACAO", "MOVIMENTACAO"]);
    expect(await db.transicaoFase.count({ where: { projetoId: cardId, deFaseId: fase(vendas, "proposta").id } })).toBe(1);
  });

  it("casca absorvida pelo ciclo único (GAB-81) não aparece na lixeira, não restaura nem é apagada sozinha; vai junto com o Projeto", async () => {
    const { projetos, vend, gestor, admin, cardId } = await semear();
    const casca = await projetoLegado(projetos, cardId, { absorvidoPorId: cardId, deletadoEm: new Date() });
    expect((await listarCardsNaLixeira()).map((c) => c.id)).toEqual([]);
    expect(await restaurarCard(casca.id, gestor)).toMatchObject({ ok: false, erro: "CARD_NAO_ENCONTRADO" });
    expect(await apagarCardDefinitivo(casca.id, admin, casca.titulo)).toMatchObject({ ok: false, erro: "CARD_NAO_ENCONTRADO" });
    await excluirCard(cardId, vend);
    expect((await listarCardsNaLixeira()).map((c) => c.id)).toEqual([cardId]);
    expect(await apagarCardDefinitivo(cardId, admin, "Site da padaria")).toEqual({ ok: true });
    expect(await db.projeto.count({ where: { id: { in: [cardId, casca.id] } } })).toBe(0);
  });
});

describe("deleção definitiva de card", () => {
  it("só admin, só da lixeira, com o título digitado; leva Timeline/transições; projeto fica sem vínculo e com nota", async () => {
    const { projetos, vend, gestor, admin, cardId } = await semear();
    const projeto = await projetoLegado(projetos, cardId);

    expect(await apagarCardDefinitivo(cardId, admin, "Site da padaria")).toMatchObject({ ok: false, erro: "NAO_ESTA_NA_LIXEIRA" });
    await excluirCard(cardId, vend);
    expect(await apagarCardDefinitivo(cardId, gestor, "Site da padaria")).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await apagarCardDefinitivo(cardId, admin, "site da padaria")).toMatchObject({ ok: false, erro: "CONFIRMACAO_NAO_CONFERE" });
    expect(await apagarCardDefinitivo(cardId, admin, " Site da padaria ")).toEqual({ ok: true });

    expect(await db.projeto.count({ where: { id: cardId } })).toBe(0);
    expect(await db.timeline.count({ where: { projetoId: cardId } })).toBe(0);
    expect(await db.transicaoFase.count({ where: { projetoId: cardId } })).toBe(0);
    const p = await db.projeto.findUniqueOrThrow({ where: { id: projeto.id } });
    expect(p.vendaOrigemId).toBeNull();
    expect(await db.timeline.count({ where: { projetoId: projeto.id, tipo: "VINCULO_PROJETO", payload: { path: ["evento"], equals: "venda_apagada" } } })).toBe(1);
  });
});

describe("lixeira de contatos e empresas", () => {
  it("excluir/restaurar exige gestor; telefone segue bloqueado na lixeira; apagar de vez libera para reuso", async () => {
    const { gestor, admin, vend, cardId } = await semear();
    const c = await criarContato({ nome: "Zé da Padaria", pontos: ["11 99999-8888"] });
    if (!c.ok) throw new Error("setup");
    await db.projeto.update({ where: { id: cardId }, data: { contatoId: c.id } });

    expect(await excluirEntidade("contato", c.id, vend)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await excluirEntidade("contato", c.id, gestor)).toEqual({ ok: true });
    expect(await encontrarContatoPorIdentificador("11 99999-8888")).toEqual({ tipo: "BLOQUEADO_EXCLUIDO", contatoId: c.id });
    expect(await criarContato({ nome: "Outro", pontos: ["11 99999-8888"] })).toMatchObject({ ok: false, erro: "PONTO_DUPLICADO" });
    expect((await listarContatosNaLixeira("+5511999998888")).map((x) => x.id)).toEqual([c.id]);

    expect(await restaurarEntidade("contato", c.id, vend)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await restaurarEntidade("contato", c.id, gestor)).toEqual({ ok: true });
    expect(await encontrarContatoPorIdentificador("11 99999-8888")).toMatchObject({ tipo: "ENCONTRADO" });

    await excluirEntidade("contato", c.id, gestor);
    expect(await apagarEntidadeDefinitivo("contato", c.id, gestor, "Zé da Padaria")).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await apagarEntidadeDefinitivo("contato", c.id, admin, "Ze da Padaria")).toEqual({ ok: false, erro: "CONFIRMACAO_NAO_CONFERE" });
    expect(await apagarEntidadeDefinitivo("contato", c.id, admin, "Zé da Padaria")).toEqual({ ok: true, cardsAfetados: 1, mescladosParaLixeira: 0 });

    expect(await encontrarContatoPorIdentificador("11 99999-8888")).toEqual({ tipo: "NAO_ENCONTRADO" });
    expect(await criarContato({ nome: "Novo dono", pontos: ["11 99999-8888"] })).toMatchObject({ ok: true });
    const card = await db.projeto.findUniqueOrThrow({ where: { id: cardId } });
    expect(card.contatoId).toBeNull();
    const nota = await db.timeline.findFirstOrThrow({ where: { projetoId: cardId, tipo: "CAMPO_ALTERADO" } });
    expect(nota.payload).toEqual({ campo: "contato", antes: "Zé da Padaria", depois: null, motivo: "apagado_definitivamente" });
  });

  it("apagar de vez uma empresa libera o CNPJ; mesclada nela vai para a lixeira com ponteiro limpo", async () => {
    const { gestor, admin } = await semear();
    const a = await criarEmpresa({ nome: "Acme", cnpj: "11.222.333/0001-81" });
    const b = await criarEmpresa({ nome: "Acme Ltda" });
    if (!a.ok || !b.ok) throw new Error("setup");
    await db.empresa.update({ where: { id: b.id }, data: { mergedIntoId: a.id } });
    // Excluir um principal com mesclados é recusado (review #12); simula dado legado já na lixeira.
    expect(await excluirEntidade("empresa", a.id, gestor)).toMatchObject({ ok: false, erro: "EMPRESA_TEM_MESCLADOS" });
    await db.empresa.update({ where: { id: a.id }, data: { deletadoEm: new Date() } });
    expect(await criarEmpresa({ nome: "X", cnpj: "11222333000181" })).toMatchObject({ ok: false, erro: "CNPJ_DUPLICADO" });
    expect(await apagarEntidadeDefinitivo("empresa", a.id, admin, "Acme")).toEqual({ ok: true, cardsAfetados: 0, mescladosParaLixeira: 1 });
    const bb = await db.empresa.findUniqueOrThrow({ where: { id: b.id } });
    expect(bb.mergedIntoId).toBeNull();
    expect(bb.deletadoEm).not.toBeNull();
    expect(await criarEmpresa({ nome: "X", cnpj: "11222333000181" })).toMatchObject({ ok: true });
  });

  it("adicionarPonto segue funcionando após restaurar (pontos nunca saíram)", async () => {
    const { gestor } = await semear();
    const c = await criarContato({ nome: "Ana", pontos: ["ana@acme.com"] });
    if (!c.ok) throw new Error("setup");
    await excluirEntidade("contato", c.id, gestor);
    expect(await adicionarPonto(c.id, "11 98888-7777")).toMatchObject({ ok: false, erro: "CONTATO_NAO_ENCONTRADO" });
    await restaurarEntidade("contato", c.id, gestor);
    expect(await adicionarPonto(c.id, "ana@acme.com")).toMatchObject({ ok: true, jaExistia: true });
  });
});

describe("review do PR #12", () => {
  it("excluir contato/empresa que recebeu merges é recusado, com contagem; depois de desfazer, exclui", async () => {
    const { gestor } = await semear();
    const ana = await criarContato({ nome: "Ana", pontos: ["ana@acme.com"] });
    const dup = await criarContato({ nome: "Ana S.", pontos: ["ana.s@acme.com"] });
    const acme = await criarEmpresa({ nome: "Acme" });
    const e1 = await criarEmpresa({ nome: "Acme Ltda" });
    const e2 = await criarEmpresa({ nome: "ACME SA" });
    if (!ana.ok || !dup.ok || !acme.ok || !e1.ok || !e2.ok) throw new Error("setup");
    await db.contato.update({ where: { id: dup.id }, data: { mergedIntoId: ana.id } });
    await db.empresa.updateMany({ where: { id: { in: [e1.id, e2.id] } }, data: { mergedIntoId: acme.id } });

    const rc = await excluirEntidade("contato", ana.id, gestor);
    expect(rc).toEqual({ ok: false, erro: "CONTATO_TEM_MESCLADOS", mesclados: 1 });
    const re = await excluirEntidade("empresa", acme.id, gestor);
    expect(re).toEqual({ ok: false, erro: "EMPRESA_TEM_MESCLADOS", mesclados: 2 });
    if (re.ok || rc.ok) throw new Error("tipo");
    expect(mensagemLixeira(re)).toBe("Esta empresa tem 2 registros mesclados nela. Desfaça os merges antes de excluir.");
    expect(mensagemLixeira(rc)).toBe("Este contato tem 1 registro mesclado nele. Desfaça os merges antes de excluir.");
    expect((await db.contato.findUniqueOrThrow({ where: { id: ana.id } })).deletadoEm).toBeNull();
    expect((await db.empresa.findUniqueOrThrow({ where: { id: acme.id } })).deletadoEm).toBeNull();

    await db.contato.update({ where: { id: dup.id }, data: { mergedIntoId: null } });
    expect(await excluirEntidade("contato", ana.id, gestor)).toEqual({ ok: true });
  });

  it("apagar card de vez espera o lock do quadro do card ligado (pipeline → linha)", async () => {
    const { projetos, vend, admin, cardId } = await semear();
    await projetoLegado(projetos, cardId);
    await excluirCard(cardId, vend);

    let soltar!: () => void;
    const solto = new Promise<void>((r) => (soltar = r));
    let travou!: () => void;
    const travado = new Promise<void>((r) => (travou = r));
    const segurando = db.$transaction(
      async (tx) => {
        await travarPipelines(tx, [projetos.id]);
        travou();
        await solto;
      },
      { timeout: 20_000 },
    );
    await travado;
    let terminou = false;
    const apagando = apagarCardDefinitivo(cardId, admin, "Site da padaria").then((r) => ((terminou = true), r));
    try {
      await new Promise((r) => setTimeout(r, 400));
      expect(terminou).toBe(false);
    } finally {
      soltar();
      await segurando;
    }
    expect(await apagando).toEqual({ ok: true });
  });

  it("apagar card de vez em paralelo com troca de vínculo no card ligado: os dois terminam", async () => {
    const { vendas, projetos, vend, admin } = await semear();
    const empresas = await Promise.all(["E0", "E1", "E2", "E3", "E4"].map((nome) => criarEmpresa({ nome })));
    for (let i = 0; i < 5; i++) {
      const c = await criarCard({ pipelineId: vendas.id, faseId: fase(vendas, "proposta").id, titulo: `Venda ${i}` }, vend);
      if (!c.ok) throw new Error(c.erro);
      const projeto = await projetoLegado(projetos, c.id);
      await excluirCard(projeto.id, vend);
      const e = empresas[i];
      if (!e.ok) throw new Error("setup");
      const [apagado, vinculado] = await Promise.all([
        apagarCardDefinitivo(projeto.id, admin, projeto.titulo),
        vincularAoCard(c.id, "empresa", e.id, vend),
      ]);
      expect(apagado).toEqual({ ok: true });
      expect(vinculado).toEqual({ ok: true, mudou: true });
    }
  });

  it("card reaberto a partir do apagado sobrevive, perde o ponteiro e ganha nota; mensagens enviadas ficam", async () => {
    const { vendas, vend, admin, cardId } = await semear();
    const r = await criarCard({ pipelineId: vendas.id, faseId: fase(vendas, "primeiro_contato").id, titulo: "Site da padaria (reaberto)" }, vend);
    if (!r.ok) throw new Error(r.erro);
    await db.projeto.update({ where: { id: r.id }, data: { reabertaDeId: cardId } });
    await db.mensagemEnviada.create({ data: { eventoId: "ev-1", projetoId: cardId, grupoJid: "g@g.us", texto: "oi" } });
    await excluirCard(cardId, vend);
    const [lix] = await listarCardsNaLixeira();
    expect(lix).toMatchObject({ id: cardId, mensagensEnviadas: 1, reaberturas: 1 });

    expect(await apagarCardDefinitivo(cardId, admin, "Site da padaria")).toEqual({ ok: true });
    expect((await db.projeto.findUniqueOrThrow({ where: { id: r.id } })).reabertaDeId).toBeNull();
    const nota = await db.timeline.findFirstOrThrow({ where: { projetoId: r.id, tipo: "VINCULO_PROJETO" } });
    expect(nota.payload).toEqual({ evento: "origem_reabertura_apagada", titulo: "Site da padaria" });
    expect(nota.usuarioId).toBe(admin.id);
    expect((await db.mensagemEnviada.findUniqueOrThrow({ where: { eventoId: "ev-1" } })).projetoId).toBeNull();
  });

  it("Kanban e Minha Semana: principal excluído não empresta o nome; mesclado mostra o próprio", async () => {
    const { vend, cardId } = await semear();
    const acme = await criarEmpresa({ nome: "Acme" });
    const dup = await criarEmpresa({ nome: "Acme Ltda" });
    if (!acme.ok || !dup.ok) throw new Error("setup");
    await db.empresa.update({ where: { id: dup.id }, data: { mergedIntoId: acme.id } });
    await db.projeto.update({ where: { id: cardId }, data: { empresaId: dup.id } });
    const nomes = async () => [(await listarQuadro("vendas"))!.cards[0].empresa?.nome, (await listarCardsDoVendedor(vend.id))[0].empresa?.nome];

    expect(await nomes()).toEqual(["Acme", "Acme"]);
    await db.empresa.update({ where: { id: acme.id }, data: { deletadoEm: new Date() } });
    expect(await nomes()).toEqual(["Acme Ltda", "Acme Ltda"]);
  });
});

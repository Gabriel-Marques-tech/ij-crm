import { beforeEach, describe, expect, it } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { removerFase } from "@/lib/fases/fases";
import { adicionarPonto, criarContato } from "@/lib/contatos/contatos";
import { encontrarContatoPorIdentificador } from "@/lib/contatos/match";
import { criarEmpresa } from "@/lib/empresas/empresas";
import { criarCard, moverCard, obterCard } from "@/lib/oportunidades/oportunidades";
import { listarQuadro } from "@/lib/oportunidades/oportunidades";
import { listarCardsDoVendedor } from "@/lib/semana/semana";
import { apagarCardDefinitivo, excluirCard, restaurarCard } from "./cards";
import { apagarEntidadeDefinitivo, excluirEntidade, restaurarEntidade } from "./entidades";
import { listarCardsNaLixeira, listarContatosNaLixeira } from "./lixeira";

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
const tipos = async (id: string) => (await db.timeline.findMany({ where: { oportunidadeId: id }, orderBy: [{ em: "asc" }, { id: "asc" }] })).map((t) => t.tipo);

beforeEach(async () => {
  await limparBanco(["transicao_fase", "timeline", "oportunidade", "contato_ponto", "contato", "empresa", "fase", "pipeline", "sessao", "usuario"]);
  invalidarCachePipelines();
});

describe("soft-delete e restauração de card", () => {
  it("qualquer usuário exclui: some do Kanban, da Minha Semana e do detalhe; Timeline registra quem/quando", async () => {
    const { vend, cardId } = await semear();
    expect(await excluirCard(cardId, vend)).toEqual({ ok: true });

    expect((await listarQuadro("vendas"))!.cards).toHaveLength(0);
    expect(await listarCardsDoVendedor(vend.id)).toHaveLength(0);
    expect(await obterCard(cardId)).toBeNull();
    const ex = await db.timeline.findFirstOrThrow({ where: { oportunidadeId: cardId, tipo: "EXCLUSAO" } });
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
    const card = await db.oportunidade.findUniqueOrThrow({ where: { id: cardId } });
    expect([card.deletadoEm, card.faseId]).toEqual([null, fase(vendas, "primeiro_contato").id]);
    expect(await tipos(cardId)).toEqual(["CRIACAO", "EXCLUSAO", "RESTAURACAO", "MOVIMENTACAO"]);
    expect(await db.transicaoFase.count({ where: { oportunidadeId: cardId, deFaseId: fase(vendas, "proposta").id } })).toBe(1);
  });

  it("excluir venda com projeto vivo: projeto vê a venda removida; restaurar limpa o aviso", async () => {
    const { vendas, vend, gestor, cardId } = await semear();
    expect(await moverCard(cardId, fase(vendas, "contrato_assinado").id, vend, { dadosTerminal: {} })).toMatchObject({ ok: true });
    const projeto = await db.oportunidade.findFirstOrThrow({ where: { origemOportunidadeId: cardId } });
    await excluirCard(cardId, vend);
    expect((await obterCard(projeto.id))!.origemOportunidade!.deletadoEm).not.toBeNull();
    await restaurarCard(cardId, gestor);
    expect((await obterCard(projeto.id))!.origemOportunidade!.deletadoEm).toBeNull();
  });
});

describe("deleção definitiva de card", () => {
  it("só admin, só da lixeira, com o título digitado; leva Timeline/transições; projeto fica sem vínculo e com nota", async () => {
    const { vendas, vend, gestor, admin, cardId } = await semear();
    await moverCard(cardId, fase(vendas, "contrato_assinado").id, vend, { dadosTerminal: {} });
    const projeto = await db.oportunidade.findFirstOrThrow({ where: { origemOportunidadeId: cardId } });

    expect(await apagarCardDefinitivo(cardId, admin, "Site da padaria")).toMatchObject({ ok: false, erro: "NAO_ESTA_NA_LIXEIRA" });
    await excluirCard(cardId, vend);
    expect(await apagarCardDefinitivo(cardId, gestor, "Site da padaria")).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await apagarCardDefinitivo(cardId, admin, "site da padaria")).toMatchObject({ ok: false, erro: "CONFIRMACAO_NAO_CONFERE" });
    expect(await apagarCardDefinitivo(cardId, admin, " Site da padaria ")).toEqual({ ok: true });

    expect(await db.oportunidade.count({ where: { id: cardId } })).toBe(0);
    expect(await db.timeline.count({ where: { oportunidadeId: cardId } })).toBe(0);
    expect(await db.transicaoFase.count({ where: { oportunidadeId: cardId } })).toBe(0);
    const p = await db.oportunidade.findUniqueOrThrow({ where: { id: projeto.id } });
    expect(p.origemOportunidadeId).toBeNull();
    expect(await db.timeline.count({ where: { oportunidadeId: projeto.id, tipo: "VINCULO_PROJETO", payload: { path: ["evento"], equals: "venda_apagada" } } })).toBe(1);
  });
});

describe("lixeira de contatos e empresas", () => {
  it("excluir/restaurar exige gestor; telefone segue bloqueado na lixeira; apagar de vez libera para reuso", async () => {
    const { gestor, admin, vend, cardId } = await semear();
    const c = await criarContato({ nome: "Zé da Padaria", pontos: ["11 99999-8888"] });
    if (!c.ok) throw new Error("setup");
    await db.oportunidade.update({ where: { id: cardId }, data: { contatoId: c.id } });

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
    const card = await db.oportunidade.findUniqueOrThrow({ where: { id: cardId } });
    expect(card.contatoId).toBeNull();
    const nota = await db.timeline.findFirstOrThrow({ where: { oportunidadeId: cardId, tipo: "CAMPO_ALTERADO" } });
    expect(nota.payload).toEqual({ campo: "contato", antes: "Zé da Padaria", depois: null, motivo: "apagado_definitivamente" });
  });

  it("apagar de vez uma empresa libera o CNPJ; mesclada nela vai para a lixeira com ponteiro limpo", async () => {
    const { gestor, admin } = await semear();
    const a = await criarEmpresa({ nome: "Acme", cnpj: "11.222.333/0001-81" });
    const b = await criarEmpresa({ nome: "Acme Ltda" });
    if (!a.ok || !b.ok) throw new Error("setup");
    await db.empresa.update({ where: { id: b.id }, data: { mergedIntoId: a.id } });
    await excluirEntidade("empresa", a.id, gestor);
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

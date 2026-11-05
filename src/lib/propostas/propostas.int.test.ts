import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Papel } from "@prisma/client";
import { extractText, getDocumentProxy } from "unpdf";
import { dbTeste, limparBanco } from "@/test/db";
import { comViaMcp } from "@/lib/canal";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { listarQuadro } from "@/lib/projetos/projetos";
import { estruturadoParaEntrada, type Estruturado } from "./estruturado";
import { criarProposta, listarPropostas, MODELO_INICIAL, obterPropostaDoProjeto, obterVersao, pdfDoRascunho, salvarRascunho, salvarVersao } from "./propostas";

const db = dbTeste();

async function semear() {
  const vendas = await db.pipeline.create({
    data: { chave: "vendas", nome: "Vendas", ordem: 0, fases: { create: [{ chave: "proposta", nome: "Proposta", ordem: 0, marco: "PROPOSTA" }] } },
    include: { fases: true },
  });
  const pessoa = async (nome: string, papel: Papel) => db.usuario.create({ data: { nome, email: `${nome.toLowerCase()}@ij.test`, papel } });
  const ana = await pessoa("Ana", "VENDEDOR");
  const bia = await pessoa("Bia", "VENDEDOR");
  const paula = await pessoa("Paula", "PROJETOS");
  const gil = await pessoa("Gil", "GESTOR");
  const vera = await pessoa("Vera", "VISUALIZADOR");
  const projeto = await db.projeto.create({
    data: { pipelineId: vendas.id, faseId: vendas.fases[0].id, titulo: "Site da Padaria", responsavelId: ana.id, criadoVia: "UI" },
  });
  return { vendas, ana, bia, paula, gil, vera, projeto };
}

const doc = (texto: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: texto }] }] as object[] });

beforeEach(async () => {
  await limparBanco(["proposta_versao", "proposta", "transicao_fase", "timeline", "oportunidade", "fase", "pipeline", "sessao", "usuario"]);
  invalidarCachePipelines();
});
afterEach(() => vi.restoreAllMocks());

describe("criar proposta: uma por Projeto, só quem edita", () => {
  it("vendedora responsável cria: rascunho com o modelo, revisão 0, Timeline PROPOSTA criada", async () => {
    const { ana, projeto } = await semear();
    const r = await criarProposta(projeto.id, ana);
    expect(r.ok).toBe(true);
    const p = await db.proposta.findUniqueOrThrow({ where: { projetoId: projeto.id } });
    expect(p).toMatchObject({ status: "RASCUNHO", conteudoMd: MODELO_INICIAL, revisao: 0, criadoPorId: ana.id, canetaComId: ana.id, canetaLado: "VENDAS" });
    const tl = await db.timeline.findMany({ where: { projetoId: projeto.id } });
    expect(tl).toHaveLength(1);
    expect(tl[0]).toMatchObject({ tipo: "PROPOSTA", usuarioId: ana.id, viaMcp: false, payload: { evento: "criada" } });
  });

  it("no máximo uma: a segunda (mesmo em paralelo) é recusada", async () => {
    const { ana, gil, projeto } = await semear();
    const [a, b] = await Promise.all([criarProposta(projeto.id, ana), criarProposta(projeto.id, gil)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect([a, b].find((x) => !x.ok)).toMatchObject({ erro: "PROPOSTA_JA_EXISTE" });
    expect(await db.proposta.count()).toBe(1);
    expect(await criarProposta(projeto.id, ana)).toEqual({ ok: false, erro: "PROPOSTA_JA_EXISTE" });
  });

  it("permissão: outra vendedora, projetos e visualizador não criam; gestor cria", async () => {
    const { bia, paula, vera, gil, projeto } = await semear();
    for (const quem of [bia, paula, vera]) expect(await criarProposta(projeto.id, quem)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    expect((await criarProposta(projeto.id, gil)).ok).toBe(true);
  });

  it("projeto apagado (lixeira) ou inexistente", async () => {
    const { ana, projeto } = await semear();
    await db.projeto.update({ where: { id: projeto.id }, data: { deletadoEm: new Date() } });
    expect(await criarProposta(projeto.id, ana)).toEqual({ ok: false, erro: "PROJETO_NAO_ENCONTRADO" });
    expect(await criarProposta("nao-existe", ana)).toEqual({ ok: false, erro: "PROJETO_NAO_ENCONTRADO" });
  });
});

describe("rascunho (autosave): Markdown canônico, controle otimista", () => {
  it("grava o JSON do editor como Markdown; recarregar devolve o mesmo texto", async () => {
    const { ana, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    const r = await salvarRascunho(projeto.id, { revisao: 0, conteudo: { documento: doc("Proposta *nova* para a padaria") } }, ana);
    expect(r).toMatchObject({ ok: true, revisao: 1, mudou: true, markdown: "Proposta \\*nova\\* para a padaria" });
    const lido = await obterPropostaDoProjeto(projeto.id);
    expect(lido?.proposta?.conteudoMd).toBe("Proposta \\*nova\\* para a padaria");
    expect(lido?.proposta).toMatchObject({ revisao: 1, rascunhoPor: { nome: "Ana" }, rascunhoViaMcp: false });
  });

  it("sem mudança e base atual: ok sem mexer na revisão", async () => {
    const { ana, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    await salvarRascunho(projeto.id, { revisao: 0, conteudo: { markdown: "texto" } }, ana);
    expect(await salvarRascunho(projeto.id, { revisao: 1, conteudo: { markdown: "texto" } }, ana)).toMatchObject({ ok: true, revisao: 1, mudou: false });
  });

  it("sem mudança mas base VELHA é conflito (senão a aba velha adota a revisão nova e desfaz a mudança do outro)", async () => {
    const { ana, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    await salvarRascunho(projeto.id, { revisao: 0, conteudo: { markdown: "texto" }, estruturado: { valor: "20.000,00" } }, ana);
    // A (tela) e B (o Claude dela, MCP) na revisão 1; B troca o valor para 25k → revisão 2
    expect(await comViaMcp(() => salvarRascunho(projeto.id, { revisao: 1, estruturado: { valor: "25.000,00" } }, ana))).toMatchObject({ ok: true, revisao: 2 });
    // A digitou e apagou: o autosave manda o mesmo texto com a base 1 → conflito, não "ok rev 2"
    const a = await salvarRascunho(projeto.id, { revisao: 1, conteudo: { markdown: "texto" } }, ana);
    expect(a).toMatchObject({ ok: false, erro: "CONFLITO", conflito: { revisao: 2, por: "Ana", viaMcp: true, estruturado: { valor: "25000.00" } } });
    // e o "Salvar dados" de A com o formulário velho (20k) e base 1 também não passa
    expect(await salvarRascunho(projeto.id, { revisao: 1, estruturado: { valor: "20.000,00", prazoDias: "30" } }, ana)).toMatchObject({ ok: false, erro: "CONFLITO" });
    expect((await db.proposta.findUniqueOrThrow({ where: { projetoId: projeto.id } })).valor?.toFixed(2)).toBe("25000.00");
  });

  it("duas abas / pessoa + MCP: quem grava com revisão velha recebe CONFLITO com o atual, nada é sobrescrito", async () => {
    const { ana, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    expect((await comViaMcp(() => salvarRascunho(projeto.id, { revisao: 0, conteudo: { markdown: "versão do Claude" } }, ana))).ok).toBe(true);
    const r = await salvarRascunho(projeto.id, { revisao: 0, conteudo: { markdown: "versão da aba antiga" } }, ana);
    expect(r).toMatchObject({ ok: false, erro: "CONFLITO", conflito: { revisao: 1, por: "Ana", viaMcp: true, markdown: "versão do Claude" } });
    expect((await db.proposta.findUniqueOrThrow({ where: { projetoId: projeto.id } })).conteudoMd).toBe("versão do Claude");
    // recarregou (revisão 1) → grava
    expect(await salvarRascunho(projeto.id, { revisao: 1, conteudo: { markdown: "agora sim" } }, ana)).toMatchObject({ ok: true, revisao: 2 });
  });

  it("gravações simultâneas com a mesma base: exatamente uma vence", async () => {
    const { ana, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    const rs = await Promise.all(["a", "b", "c", "d"].map((t) => salvarRascunho(projeto.id, { revisao: 0, conteudo: { markdown: t } }, ana)));
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.filter((r) => !r.ok).every((r) => !r.ok && r.erro === "CONFLITO")).toBe(true);
    expect((await db.proposta.findUniqueOrThrow({ where: { projetoId: projeto.id } })).revisao).toBe(1);
  });

  it("parte estruturada validada no servidor; valor vira coluna", async () => {
    const { ana, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    const ruim = await salvarRascunho(projeto.id, { revisao: 0, estruturado: { valor: "-10,00" } }, ana);
    expect(ruim).toMatchObject({ ok: false, erro: "ESTRUTURADO_INVALIDO" });
    const dataRuim = await salvarRascunho(projeto.id, { revisao: 0, estruturado: { entregas: [{ titulo: "MVP", dia: "2026-02-30" }] } }, ana);
    expect(dataRuim).toMatchObject({ ok: false, erro: "ESTRUTURADO_INVALIDO", mensagem: "Entrega 1: data inválida (use AAAA-MM-DD)." });
    const ok = await salvarRascunho(
      projeto.id,
      { revisao: 0, estruturado: { valor: "30.000,00", prazoDias: "90", escopoResumo: " Site + loja ", entregas: [{ titulo: "Design", dia: "2026-12-01", valor: "10.000,00" }, { titulo: "Site", dia: "2027-01-15", valor: "20.000,00" }] } },
      ana,
    );
    expect(ok.ok).toBe(true);
    const p = await db.proposta.findUniqueOrThrow({ where: { projetoId: projeto.id } });
    expect(p.valor?.toFixed(2)).toBe("30000.00");
    expect(p.estruturado).toEqual({
      valor: "30000.00",
      prazoDias: 90,
      escopoResumo: "Site + loja",
      entregas: [
        { titulo: "Design", dia: "2026-12-01", duracao: null, valor: "10000.00" },
        { titulo: "Site", dia: "2027-01-15", duracao: null, valor: "20000.00" },
      ],
    });
  });

  it("conteúdo fora do subconjunto do editor é recusado; Markdown com HTML vira texto", async () => {
    const { ana, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    expect(await salvarRascunho(projeto.id, { revisao: 0, conteudo: { documento: { type: "doc", content: [{ type: "image", attrs: { src: "x" } }] } } }, ana)).toEqual({
      ok: false,
      erro: "CONTEUDO_INVALIDO",
    });
    expect(await salvarRascunho(projeto.id, { revisao: 0, conteudo: { markdown: "x".repeat(100_001) } }, ana)).toEqual({ ok: false, erro: "CONTEUDO_LONGO" });
    const larga = `| ${Array.from({ length: 9 }, () => "a").join(" | ")} |\n| ${Array.from({ length: 9 }, () => "---").join(" | ")} |`;
    expect(await salvarRascunho(projeto.id, { revisao: 0, conteudo: { markdown: larga } }, ana)).toEqual({ ok: false, erro: "TABELA_GRANDE" });
    const merge = { type: "doc", content: [{ type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", attrs: { colspan: 2 }, content: [{ type: "paragraph" }] }] }] }] };
    expect(await salvarRascunho(projeto.id, { revisao: 0, conteudo: { documento: merge } }, ana)).toEqual({ ok: false, erro: "CONTEUDO_INVALIDO" });
    const r = await salvarRascunho(projeto.id, { revisao: 0, conteudo: { markdown: "<script>alert(1)</script>" } }, ana);
    expect(r).toMatchObject({ ok: true, markdown: "\\<script>alert(1)\\</script>" });
  });

  it("só o dono da caneta grava: projetos, outra vendedora, gestor e visualizador leem", async () => {
    const { ana, bia, paula, gil, vera, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    for (const quem of [paula, bia, gil, vera]) {
      expect(await salvarRascunho(projeto.id, { revisao: 0, conteudo: { markdown: "x" } }, quem)).toEqual({ ok: false, erro: "SEM_CANETA" });
      expect(await salvarVersao(projeto.id, { revisao: 0, conteudo: { markdown: "x" } }, quem)).toEqual({ ok: false, erro: "SEM_CANETA" });
    }
    expect(await salvarRascunho(projeto.id, { revisao: 0, conteudo: { markdown: "x" } }, ana)).toMatchObject({ ok: true });
  });

  it("rebaixado na Gestão perde a edição na hora (papel relido do banco)", async () => {
    const { ana, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    await db.usuario.update({ where: { id: ana.id }, data: { papel: "VISUALIZADOR" } });
    expect(await salvarRascunho(projeto.id, { revisao: 0, conteudo: { markdown: "x" } }, { id: ana.id, papel: "VENDEDOR" })).toEqual({ ok: false, erro: "SEM_CANETA" });
  });

  it("sem proposta ainda", async () => {
    const { ana, projeto } = await semear();
    expect(await salvarRascunho(projeto.id, { revisao: 0, conteudo: { markdown: "x" } }, ana)).toEqual({ ok: false, erro: "PROPOSTA_NAO_ENCONTRADA" });
  });
});

describe("versões: imutáveis, numeradas, com nota, autor e Timeline", () => {
  it("salvar versão grava v1, v2 com o snapshot (texto + estruturado), autor, lado e nota", async () => {
    const { ana, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    const v1 = await salvarVersao(projeto.id, { revisao: 0, conteudo: { documento: doc("primeira") }, estruturado: { valor: "1.000,00" }, nota: " pronta para olhar " }, ana);
    expect(v1).toEqual({ ok: true, numero: 1, revisao: 1 });
    const v2 = await salvarVersao(projeto.id, { revisao: 1, conteudo: { documento: doc("segunda") } }, ana);
    expect(v2).toMatchObject({ ok: true, numero: 2 });

    const um = await obterVersao(projeto.id, 1);
    expect(um).toMatchObject({ numero: 1, conteudoMd: "primeira", nota: "pronta para olhar", autor: { nome: "Ana" }, autorLado: "VENDAS", viaMcp: false });
    expect(um?.estruturado.valor).toBe("1000.00");
    expect((await obterVersao(projeto.id, 2))?.conteudoMd).toBe("segunda");
    expect(await obterVersao(projeto.id, 3)).toBeNull();

    const tl = await db.timeline.findMany({ where: { projetoId: projeto.id }, orderBy: { em: "asc" } });
    expect(tl.map((t) => t.payload)).toEqual([{ evento: "criada", propostaId: expect.any(String), canetaComId: ana.id, canetaComNome: "Ana" }, { evento: "versao_salva", numero: 1, nota: "pronta para olhar" }, { evento: "versao_salva", numero: 2 }]);
  });

  it("autosave não é versão", async () => {
    const { ana, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    await salvarRascunho(projeto.id, { revisao: 0, conteudo: { markdown: "a" } }, ana);
    await salvarRascunho(projeto.id, { revisao: 1, conteudo: { markdown: "b" } }, ana);
    expect(await db.propostaVersao.count()).toBe(0);
  });

  it("nada mudou desde a última versão → SEM_MUDANCAS; nota longa → NOTA_LONGA", async () => {
    const { ana, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    await salvarVersao(projeto.id, { revisao: 0 }, ana);
    expect(await salvarVersao(projeto.id, { revisao: 0 }, ana)).toEqual({ ok: false, erro: "SEM_MUDANCAS" });
    expect(await salvarVersao(projeto.id, { revisao: 0, nota: "x".repeat(501) }, ana)).toEqual({ ok: false, erro: "NOTA_LONGA" });
  });

  it("MCP sem conteúdo: a revisão lida tem de ser a atual (versão do que o Claude viu)", async () => {
    const { ana, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    await salvarRascunho(projeto.id, { revisao: 0, conteudo: { markdown: "editado na tela" } }, ana);
    const r = await comViaMcp(() => salvarVersao(projeto.id, { revisao: 0 }, ana));
    expect(r).toMatchObject({ ok: false, erro: "CONFLITO", conflito: { revisao: 1, markdown: "editado na tela" } });
    const ok = await comViaMcp(() => salvarVersao(projeto.id, { revisao: 1, nota: "pelo Claude" }, ana));
    expect(ok).toMatchObject({ ok: true, numero: 1 });
    expect(await db.propostaVersao.findFirstOrThrow()).toMatchObject({ viaMcp: true });
    expect(await db.timeline.findFirstOrThrow({ where: { payload: { path: ["evento"], equals: "versao_salva" } } })).toMatchObject({ viaMcp: true });
  });

  it("versões simultâneas: numeração sem buraco nem repetição", async () => {
    const { ana, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    const rs = await Promise.all(["a", "b", "c"].map((t) => salvarVersao(projeto.id, { revisao: 0, conteudo: { markdown: t } }, ana)));
    const oks = rs.filter((r) => r.ok);
    expect(oks).toHaveLength(1); // as outras chegaram com a revisão velha
    expect(rs.filter((r) => !r.ok).every((r) => !r.ok && r.erro === "CONFLITO")).toBe(true);
    expect((await db.propostaVersao.findMany()).map((v) => v.numero)).toEqual([1]);
  });

  it("o banco recusa alterar uma versão (imutável), mas apagar o Projeto de vez leva tudo", async () => {
    const { ana, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    await salvarVersao(projeto.id, { revisao: 0 }, ana);
    await expect(db.propostaVersao.updateMany({ data: { nota: "mexi" } })).rejects.toThrow();
    await expect(db.$executeRawUnsafe(`UPDATE proposta_versao SET conteudo_md = 'x'`)).rejects.toThrow(/imutável/);
    await db.timeline.deleteMany();
    await db.projeto.delete({ where: { id: projeto.id } });
    expect(await db.propostaVersao.count()).toBe(0);
    expect(await db.proposta.count()).toBe(0);
  });
});

describe("aba Propostas", () => {
  it("lista com status, última versão e filtros (status, responsável, texto na empresa/título); some com o projeto na lixeira", async () => {
    const { ana, gil, projeto, vendas } = await semear();
    const emp = await db.empresa.create({ data: { nome: "Padaria São João" } });
    await db.projeto.update({ where: { id: projeto.id }, data: { empresaId: emp.id } });
    const outro = await db.projeto.create({ data: { pipelineId: vendas.id, faseId: vendas.fases[0].id, titulo: "App do Mercado", responsavelId: gil.id, criadoVia: "UI" } });
    await criarProposta(projeto.id, ana);
    await salvarVersao(projeto.id, { revisao: 0, estruturado: { valor: "5.000,00" } }, ana);
    await criarProposta(outro.id, gil);

    const gestao = { id: gil.id, papel: "ADMIN" as const, area: null, cargos: [] };
    const todas = await listarPropostas({}, gestao);
    expect(todas.map((p) => p.projeto.titulo).sort()).toEqual(["App do Mercado", "Site da Padaria"]);
    const padaria = todas.find((p) => p.projeto.id === projeto.id)!;
    expect(padaria).toMatchObject({ status: "RASCUNHO", valor: "5000.00", ultimaVersao: { numero: 1 }, projeto: { empresa: "Padaria São João", responsavel: { nome: "Ana" } } });
    expect((await listarPropostas({ texto: "são joão" }, gestao)).map((p) => p.projeto.titulo)).toEqual(["Site da Padaria"]);
    expect((await listarPropostas({ responsavelId: gil.id }, gestao)).map((p) => p.projeto.titulo)).toEqual(["App do Mercado"]);
    expect(await listarPropostas({ status: "ENVIADA" }, gestao)).toEqual([]);

    await db.projeto.update({ where: { id: outro.id }, data: { deletadoEm: new Date() } });
    expect((await listarPropostas({}, gestao)).map((p) => p.projeto.titulo)).toEqual(["Site da Padaria"]);
  });
});

describe("Kanban", () => {
  it("o quadro traz o status da proposta de cada card (badge); sem proposta = null", async () => {
    const { ana, projeto, vendas } = await semear();
    const sem = await db.projeto.create({ data: { pipelineId: vendas.id, faseId: vendas.fases[0].id, titulo: "Sem proposta", responsavelId: ana.id, criadoVia: "UI" } });
    await criarProposta(projeto.id, ana);
    const q = await listarQuadro("vendas");
    expect(q?.cards.find((c) => c.id === projeto.id)?.proposta).toEqual({ status: "RASCUNHO" });
    expect(q?.cards.find((c) => c.id === sem.id)?.proposta).toBeNull();
  });
});

describe("blocos móveis e duração (GAB-100)", () => {
  const entradas = (e: Estruturado) => estruturadoParaEntrada(e);

  it("markdown com blocos passa pelo serviço; o rascunho sem marcador segue sem marcador", async () => {
    const { ana, projeto } = await semear();
    const c = await criarProposta(projeto.id, ana);
    const md = "Antes.\n\n<!-- bloco:cronograma -->\n\nDepois.";
    const r = await salvarRascunho(projeto.id, { revisao: c.ok ? c.revisao : -1, conteudo: { documento: { type: "doc", content: [doc("Antes.").content[0], { type: "blocoDados", attrs: { tipo: "cronograma" } }, doc("Depois.").content[0]] } } }, ana);
    expect(r).toMatchObject({ ok: true, markdown: md });
    // O editor manda os dois no fim: é a posição padrão, nada muda no Markdown de proposta antiga.
    const r2 = await salvarRascunho(
      projeto.id,
      { revisao: r.ok ? r.revisao : -1, conteudo: { documento: { type: "doc", content: [doc("Texto.").content[0], { type: "blocoDados", attrs: { tipo: "cronograma" } }, { type: "blocoDados", attrs: { tipo: "investimento" } }, { type: "paragraph" }] } } },
      ana,
    );
    expect(r2).toMatchObject({ ok: true, markdown: "Texto." });
    const r3 = await salvarRascunho(projeto.id, { revisao: r2.ok ? r2.revisao : -1, conteudo: { documento: { type: "doc", content: [doc("Texto.").content[0], { type: "semBlocos" }] } } }, ana);
    expect(r3).toMatchObject({ ok: true, markdown: "Texto.\n\n<!-- bloco:nenhum -->" });
  });

  it("documento com bloco de tipo desconhecido é recusado", async () => {
    const { ana, projeto } = await semear();
    const c = await criarProposta(projeto.id, ana);
    expect(await salvarRascunho(projeto.id, { revisao: c.ok ? c.revisao : -1, conteudo: { documento: { type: "doc", content: [{ type: "blocoDados", attrs: { tipo: "x" } }] } } }, ana)).toEqual({ ok: false, erro: "CONTEUDO_INVALIDO" });
  });

  it("proposta antiga (entrega gravada sem `duracao`): reenviar o formulário igual não conta como mudança, e a versão não conta como alterada", async () => {
    const { ana, projeto } = await semear();
    const c = await criarProposta(projeto.id, ana);
    const antigo = { valor: "9000.00", prazoDias: 45, escopoResumo: "Site", entregas: [{ titulo: "Site no ar", dia: "2027-01-15", valor: null }] };
    await db.proposta.update({ where: { projetoId: projeto.id }, data: { estruturado: antigo, valor: "9000.00" } });
    const lida = (await obterPropostaDoProjeto(projeto.id))!.proposta!;
    expect(lida.estruturado.entregas).toEqual([{ titulo: "Site no ar", dia: "2027-01-15", duracao: null, valor: null }]);
    const r = await salvarRascunho(projeto.id, { revisao: c.ok ? c.revisao : -1, estruturado: entradas(lida.estruturado) }, ana);
    expect(r).toMatchObject({ ok: true, mudou: false });
  });

  it("entrega só com duração atravessa rascunho e versão, e não some", async () => {
    const { ana, projeto } = await semear();
    const c = await criarProposta(projeto.id, ana);
    const r = await salvarRascunho(projeto.id, { revisao: c.ok ? c.revisao : -1, estruturado: { entregas: [{ titulo: "Levantamento", duracao: "2 sem" }] } }, ana);
    expect(r).toMatchObject({ ok: true });
    const v = await salvarVersao(projeto.id, { revisao: r.ok ? r.revisao : -1 }, ana);
    const numero = v.ok ? v.numero : -1;
    expect((await obterVersao(projeto.id, numero))!.estruturado.entregas).toEqual([{ titulo: "Levantamento", dia: null, duracao: "2 semanas", valor: null }]);
  });

  it("prévia do rascunho sai no modelo, com a capa e os blocos, em qualquer status", async () => {
    const { ana, projeto } = await semear();
    const c = await criarProposta(projeto.id, ana);
    await salvarRascunho(projeto.id, { revisao: c.ok ? c.revisao : -1, conteudo: { markdown: "Texto do rascunho." }, estruturado: { valor: "1.000,00", entregas: [{ titulo: "Etapa um", duracao: "1 semana" }] } }, ana);
    const r = await pdfDoRascunho(projeto.id);
    if (!r.ok) throw new Error(r.erro);
    expect(r.nomeArquivo).toBe("Proposta - Site da Padaria - rascunho.pdf");
    const { texto } = await extractText(await getDocumentProxy(new Uint8Array(r.bytes)), { mergePages: true }).then((t) => ({ texto: (t.text as string).replace(/\s+/g, " ") }));
    for (const s of ["PROPOSTA COMERCIAL", "Proposta Comercial de Projeto", "Texto do rascunho.", "Cronograma", "Etapa um", "1 semana", "Total em valores: R$ 1.000,00"]) expect(texto).toContain(s);
    expect(await pdfDoRascunho("nao-existe")).toEqual({ ok: false, erro: "PROPOSTA_NAO_ENCONTRADA" });
  });
});

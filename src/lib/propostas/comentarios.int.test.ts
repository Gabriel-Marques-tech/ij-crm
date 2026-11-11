import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Area, Papel } from "@prisma/client";
import { dbTeste, limparBanco } from "@/test/db";
import { comViaMcp } from "@/lib/canal";
import { Editor } from "@tiptap/core";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { EXTENSOES } from "@/components/propostas/editor-texto";
import { ancoraDaSelecao, DestaquesComentarios } from "@/components/propostas/destaques-editor";
import type { Documento } from "./documento";
import { textoPlano, TOKEN_BLOCO, trechoLegivel } from "./ancora";
import { markdownParaDocumento } from "./markdown";
import { aplicarSugestao, COMENTARIO_MAX, comentar, descartarPendente, enviarRevisao, listarComentarios, reabrirComentario, resolverComentario, responderComentario, versaoDosComentarios } from "./comentarios";
import { criarProposta, passarCaneta, salvarRascunho, salvarVersao } from "./propostas";
import { ancoraDaLinha } from "./sugestao-trecho";

const db = dbTeste();

async function semear() {
  const vendas = await db.pipeline.create({
    data: { chave: "vendas", nome: "Vendas", ordem: 0, fases: { create: [{ chave: "proposta", nome: "Proposta", ordem: 0, marco: "PROPOSTA" }] } },
    include: { fases: true },
  });
  // GAB-98: só comenta quem vê a proposta. Bia e Paula são GP e Vera é da gestão; quem não vê tem teste próprio.
  const pessoa = (nome: string, papel: Papel, area: Area | null = null, cargos: "GP"[] = []) => db.usuario.create({ data: { nome, email: `${nome.toLowerCase()}@ij.test`, papel, area, cargos } });
  const ana = await pessoa("Ana", "VENDEDOR", "VENDAS");
  const bia = await pessoa("Bia", "VENDEDOR", "VENDAS", ["GP"]);
  const paula = await pessoa("Paula", "PROJETOS", "PROJETOS", ["GP"]);
  const vera = await pessoa("Vera", "GESTOR");
  const projeto = await db.projeto.create({
    data: { pipelineId: vendas.id, faseId: vendas.fases[0].id, titulo: "Site da Padaria", responsavelId: ana.id, criadoVia: "UI" },
  });
  const r = await criarProposta(projeto.id, ana);
  if (!r.ok) throw new Error("seed proposta");
  const s = await salvarRascunho(projeto.id, { revisao: r.revisao, conteudo: { markdown: "## Escopo\n\nSite com loja e blog.\n\n## Prazo\n\n30 dias." } }, ana);
  if (!s.ok) throw new Error("seed rascunho");
  return { ana, bia, paula, vera, projeto, revisao: s.revisao };
}

const avisos = () => db.aviso.findMany({ orderBy: { criadoEm: "asc" } });
// Quem lê sem revisão própria: vê o que está publicado.
const listar = (id: string) => listarComentarios(id, { id: "outra-pessoa" });
const versao = (id: string) => versaoDosComentarios(id, { id: "outra-pessoa" });

beforeEach(async () => {
  await limparBanco(["aviso", "proposta_comentario", "proposta_caneta", "proposta_versao", "proposta", "transicao_fase", "timeline", "oportunidade", "fase", "pipeline", "sessao", "usuario"]);
  invalidarCachePipelines();
});
afterEach(() => vi.restoreAllMocks());

describe("comentar (§4.6): qualquer usuário ativo, sem a caneta", () => {
  it("comentário geral e preso a um trecho (âncora vinda da tela); a caneta não é exigida", async () => {
    const { projeto, paula, vera } = await semear();
    const g = await comentar(projeto.id, { texto: "  Faltou o cronograma.  " }, paula);
    expect(g).toMatchObject({ ok: true });
    const t = await comentar(projeto.id, { texto: "Loja é escopo grande", trecho: { trecho: "com loja", antes: "Site ", depois: " e blog." } }, vera);
    expect(t).toMatchObject({ ok: true });

    const l = (await listar(projeto.id))!;
    expect(l.threads.map((c) => [c.autor.nome, c.texto, c.ancora?.trecho ?? null, c.trechoAlterado])).toEqual([
      ["Paula", "Faltou o cronograma.", null, false],
      ["Vera", "Loja é escopo grande", "com loja", false],
    ]);
    expect(l.threads[1].ancora).toEqual({ trecho: "com loja", antes: "Site ", depois: " e blog." });
  });

  it("trecho como texto (MCP): o servidor acha no rascunho e guarda o contexto; não achou → erro", async () => {
    const { projeto, paula } = await semear();
    const r = await comentar(projeto.id, { texto: "30 é pouco", trecho: "30 dias" }, paula);
    expect(r).toMatchObject({ ok: true });
    const c = await db.propostaComentario.findFirstOrThrow();
    expect(c).toMatchObject({ trecho: "30 dias", trechoAntes: "Escopo\nSite com loja e blog.\nPrazo\n", trechoDepois: ".\n\uE001\n\uE002" });
    expect(await comentar(projeto.id, { texto: "x", trecho: "60 dias" }, paula)).toEqual({ ok: false, erro: "TRECHO_NAO_ENCONTRADO" });
  });

  it("limites: vazio, longo, trecho longo; texto puro guardado como veio (sem HTML interpretado)", async () => {
    const { projeto, paula } = await semear();
    expect(await comentar(projeto.id, { texto: "   " }, paula)).toEqual({ ok: false, erro: "TEXTO_VAZIO" });
    expect(await comentar(projeto.id, { texto: "x".repeat(COMENTARIO_MAX + 1) }, paula)).toEqual({ ok: false, erro: "TEXTO_LONGO" });
    expect(await comentar(projeto.id, { texto: "x", trecho: { trecho: "y".repeat(501), antes: "", depois: "" } }, paula)).toEqual({ ok: false, erro: "TRECHO_INVALIDO" });
    expect(await comentar(projeto.id, { texto: "<b>oi</b>\u0000" }, paula)).toMatchObject({ ok: true });
    expect((await db.propostaComentario.findFirstOrThrow()).texto).toBe("<b>oi</b>");
  });

  it("só usuários ativos; projeto na lixeira ou sem proposta → recusa", async () => {
    const { projeto, paula, ana, vera } = await semear();
    await db.usuario.update({ where: { id: paula.id }, data: { ativo: false } });
    expect(await comentar(projeto.id, { texto: "oi" }, paula)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    const outro = await db.projeto.create({ data: { pipelineId: projeto.pipelineId, faseId: projeto.faseId, titulo: "Sem proposta", responsavelId: ana.id, criadoVia: "UI" } });
    expect(await comentar(outro.id, { texto: "oi" }, ana)).toEqual({ ok: false, erro: "PROPOSTA_NAO_ENCONTRADA" });
    await db.projeto.update({ where: { id: projeto.id }, data: { deletadoEm: new Date() } });
    // Quem vê todas descobre que sumiu; quem depende do card não descobre nada (GAB-98).
    expect(await comentar(projeto.id, { texto: "oi" }, vera)).toEqual({ ok: false, erro: "PROJETO_NAO_ENCONTRADO" });
    expect(await comentar(projeto.id, { texto: "oi" }, ana)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await listar(projeto.id)).toBeNull();
  });

  it("via MCP fica marcado", async () => {
    const { projeto, paula } = await semear();
    await comViaMcp(() => comentar(projeto.id, { texto: "pelo Claude" }, paula));
    expect((await listar(projeto.id))!.threads[0].viaMcp).toBe(true);
  });
});

describe("aviso só no app para o dono da caneta (camada emitirAvisos)", () => {
  it("comentário e resposta de outra pessoa avisam o dono da caneta (COMENTARIO, sem WhatsApp)", async () => {
    const { projeto, paula, ana } = await semear();
    const r = await comentar(projeto.id, { texto: "oi" }, paula);
    if (!r.ok) throw new Error();
    const [a] = await avisos();
    expect(a).toMatchObject({ usuarioId: ana.id, tipo: "COMENTARIO", projetoId: projeto.id, whatsapp: null });
    expect(a.titulo).toContain("Paula");
    expect(a.titulo).toContain("Site da Padaria");
    await responderComentario(r.comentario.id, "e mais", paula);
    expect(await avisos()).toHaveLength(2);
  });

  it("o autor nunca avisa a si mesmo (dono da caneta comentando)", async () => {
    const { projeto, ana } = await semear();
    await comentar(projeto.id, { texto: "nota minha" }, ana);
    expect(await avisos()).toHaveLength(0);
  });

  it("caneta mudou de mão: avisa o dono atual", async () => {
    const { projeto, ana, bia, paula } = await semear();
    const p = await passarCaneta(projeto.id, bia.id, ana);
    if (!p.ok) throw new Error(JSON.stringify(p));
    await db.aviso.deleteMany();
    await comentar(projeto.id, { texto: "oi" }, paula);
    expect((await avisos()).map((a) => a.usuarioId)).toEqual([bia.id]);
  });
});

describe("threads, resolver e reabrir", () => {
  it("resposta entra na thread da raiz (resposta de resposta também); sem âncora própria", async () => {
    const { projeto, paula, ana } = await semear();
    const r = await comentar(projeto.id, { texto: "raiz", trecho: "30 dias" }, paula);
    if (!r.ok) throw new Error();
    const r1 = await responderComentario(r.comentario.id, "resposta 1", ana);
    if (!r1.ok) throw new Error();
    expect(await responderComentario(r1.comentario.id, "resposta 2", paula)).toMatchObject({ ok: true });
    const l = (await listar(projeto.id))!;
    expect(l.threads).toHaveLength(1);
    expect(l.threads[0].respostas.map((x) => x.texto)).toEqual(["resposta 1", "resposta 2"]);
    expect(await responderComentario("nao-existe", "x", ana)).toEqual({ ok: false, erro: "COMENTARIO_NAO_ENCONTRADO" });
  });

  it("resolver e reabrir: estado na raiz e histórico na Timeline (com via MCP)", async () => {
    const { projeto, paula, ana, vera } = await semear();
    const r = await comentar(projeto.id, { texto: "raiz" }, paula);
    if (!r.ok) throw new Error();
    expect(await resolverComentario(r.comentario.id, ana)).toEqual({ ok: true });
    expect(await resolverComentario(r.comentario.id, ana)).toEqual({ ok: false, erro: "JA_RESOLVIDO" });
    let t = (await listar(projeto.id))!.threads[0];
    expect(t.resolvido).toMatchObject({ por: "Ana" });
    expect(await comViaMcp(() => reabrirComentario(r.comentario.id, vera))).toEqual({ ok: true });
    expect(await reabrirComentario(r.comentario.id, vera)).toEqual({ ok: false, erro: "NAO_RESOLVIDO" });
    t = (await listar(projeto.id))!.threads[0];
    expect(t.resolvido).toBeNull();
    const tl = await db.timeline.findMany({ where: { projetoId: projeto.id, tipo: "PROPOSTA" }, orderBy: { em: "asc" } });
    const eventos = tl.filter((x) => String((x.payload as { evento: string }).evento).startsWith("comentario_"));
    expect(eventos.map((x) => [(x.payload as { evento: string }).evento, x.usuarioId, x.viaMcp])).toEqual([
      ["comentario_resolvido", ana.id, false],
      ["comentario_reaberto", vera.id, true],
    ]);
  });

  it("resolver uma resposta resolve a thread dela", async () => {
    const { projeto, paula, ana } = await semear();
    const r = await comentar(projeto.id, { texto: "raiz" }, paula);
    if (!r.ok) throw new Error();
    const r1 = await responderComentario(r.comentario.id, "resp", ana);
    if (!r1.ok) throw new Error();
    expect(await resolverComentario(r1.comentario.id, ana)).toEqual({ ok: true });
    expect((await db.propostaComentario.findUniqueOrThrow({ where: { id: r.comentario.id } })).resolvidoEm).not.toBeNull();
  });
});

describe("trecho alterado e versões", () => {
  it("trecho editado/apagado: o comentário continua, marcado como trecho alterado; sobrevive a versões", async () => {
    const { projeto, paula, ana, revisao } = await semear();
    await comentar(projeto.id, { texto: "sobre o prazo", trecho: "30 dias" }, paula);
    const v = await salvarVersao(projeto.id, { revisao }, ana);
    if (!v.ok) throw new Error();
    const s = await salvarRascunho(projeto.id, { revisao: v.revisao, conteudo: { markdown: "## Escopo\n\nSite com loja e blog.\n\n## Prazo\n\n45 dias." } }, ana);
    if (!s.ok) throw new Error();
    const v2 = await salvarVersao(projeto.id, { revisao: s.revisao }, ana);
    expect(v2.ok).toBe(true);
    const [t] = (await listar(projeto.id))!.threads;
    expect(t).toMatchObject({ texto: "sobre o prazo", trechoAlterado: true, ancora: { trecho: "30 dias" } });
  });
});

describe("versão para o polling", () => {
  it("muda quando há comentário, resposta, resolver ou reabrir; igual quando nada muda", async () => {
    const { projeto, paula } = await semear();
    const v0 = await versao(projeto.id);
    expect(await versao(projeto.id)).toBe(v0);
    const r = await comentar(projeto.id, { texto: "oi" }, paula);
    if (!r.ok) throw new Error();
    const v1 = await versao(projeto.id);
    expect(v1).not.toBe(v0);
    await new Promise((ok) => setTimeout(ok, 5));
    await resolverComentario(r.comentario.id, paula);
    const v2 = await versao(projeto.id);
    expect(v2).not.toBe(v1);
    expect((await listar(projeto.id))!.versao).toBe(v2);
  });
});

describe("espaços que o Markdown não guarda (B1 da revisão)", () => {
  it("trecho com dois espaços digitado no editor: o servidor acha no rascunho salvo (não fica 'trecho alterado')", async () => {
    const { projeto, ana, paula, revisao } = await semear();
    // O editor ao vivo da dona da caneta tem "Prazo:  30 dias" (dois espaços); o autosave grava o canônico.
    const cru: Documento = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Prazo:  30 dias, sem\tatraso." }] }] };
    const s = await salvarRascunho(projeto.id, { revisao, conteudo: { documento: cru } }, ana);
    if (!s.ok) throw new Error(JSON.stringify(s));
    const e = new Editor({ extensions: [...EXTENSOES, DestaquesComentarios], content: cru });
    e.commands.setTextSelection({ from: 1, to: 16 }); // "Prazo:  30 dias"
    const ancora = ancoraDaSelecao(e.state)!;
    e.destroy();
    expect(ancora.trecho).toBe("Prazo: 30 dias");
    expect(await comentar(projeto.id, { texto: "curto", trecho: ancora }, ana)).toMatchObject({ ok: true });
    // Cliente velho mandando o trecho cru: o servidor normaliza.
    expect(await comentar(projeto.id, { texto: "cru", trecho: { trecho: "Prazo:  30 dias", antes: "", depois: ",  sem" } }, paula)).toMatchObject({ ok: true });
    // MCP citando com dois espaços/tab também acha.
    expect(await comentar(projeto.id, { texto: "mcp", trecho: "sem\tatraso" }, paula)).toMatchObject({ ok: true });
    const l = (await listar(projeto.id))!;
    expect(l.threads.map((t) => [t.ancora?.trecho, t.trechoAlterado])).toEqual([
      ["Prazo: 30 dias", false],
      ["Prazo: 30 dias", false],
      ["sem atraso", false],
    ]);
  });
});

describe("GAB-98: só comenta quem vê a proposta", () => {
  it("VISUALIZADOR e quem não está escalado são recusados em comentar, responder, resolver e reabrir", async () => {
    const { ana, projeto } = await semear();
    const v = await db.usuario.create({ data: { nome: "Viu", email: "viu@ij.test", papel: "VISUALIZADOR" } });
    const fora = await db.usuario.create({ data: { nome: "Fora", email: "fora@ij.test", papel: "PROJETOS", area: "PROJETOS" } });
    const c = await comentar(projeto.id, { texto: "da dona" }, ana);
    if (!c.ok) throw new Error("seed");
    for (const quem of [v, fora]) {
      expect(await comentar(projeto.id, { texto: "x" }, quem)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
      expect(await responderComentario(c.comentario.id, "x", quem)).toEqual({ ok: false, erro: "COMENTARIO_NAO_ENCONTRADO" });
      expect(await resolverComentario(c.comentario.id, quem)).toEqual({ ok: false, erro: "COMENTARIO_NAO_ENCONTRADO" });
      expect(await reabrirComentario(c.comentario.id, quem)).toEqual({ ok: false, erro: "COMENTARIO_NAO_ENCONTRADO" });
    }
    expect(await db.propostaComentario.count()).toBe(1);
  });
});

describe("âncora nos blocos móveis (GAB-100)", () => {
  it("citar uma palavra: o texto real vem primeiro; sem ele, o título comenta o bloco; o comentário do bloco não migra para o texto", async () => {
    const { projeto, paula, ana, revisao } = await semear();
    const r = await salvarRascunho(projeto.id, { revisao, conteudo: { markdown: "## Cronograma\n\nTexto.\n\n<!-- bloco:cronograma -->\n\nFim." } }, ana);
    const lista = async () => (await listar(projeto.id))!.threads;
    await comentar(projeto.id, { texto: "no título do texto", trecho: "Cronograma" }, paula);
    expect((await lista())[0].ancora?.trecho).toBe("Cronograma");
    // Investimento não está na folha nem no texto.
    expect(await comentar(projeto.id, { texto: "fora", trecho: "Investimento" }, paula)).toEqual({ ok: false, erro: "TRECHO_NAO_ENCONTRADO" });
    const s2 = await salvarRascunho(projeto.id, { revisao: r.ok ? r.revisao : -1, conteudo: { markdown: "Texto.\n\n<!-- bloco:cronograma -->\n\nFim." } }, ana);
    await comentar(projeto.id, { texto: "agora no bloco", trecho: "Cronograma" }, paula);
    const doBloco = (await lista()).find((t) => t.texto === "agora no bloco")!;
    expect(doBloco.ancora?.trecho).toBe(TOKEN_BLOCO.cronograma);
    await salvarRascunho(projeto.id, { revisao: s2.ok ? s2.revisao : -1, conteudo: { markdown: "## Cronograma\n\nTexto.\n\n<!-- bloco:nenhum -->" } }, ana);
    expect((await lista()).find((t) => t.texto === "agora no bloco")!.trechoAlterado).toBe(true);
  });

  it("comentar o bloco citando o título (como o MCP): não fica alterado ao mudar dados nem ao movê-lo; tirá-lo da folha marca", async () => {
    const { projeto, paula, ana, revisao } = await semear();
    expect(await comentar(projeto.id, { texto: "Revise as semanas", trecho: "Cronograma" }, paula)).toMatchObject({ ok: true });
    const alterado = async () => (await listar(projeto.id))!.threads[0].trechoAlterado;
    expect(await alterado()).toBe(false);

    const dados = await salvarRascunho(projeto.id, { revisao, estruturado: { valor: "1.000,00", entregas: [{ titulo: "A", duracao: "2 semanas" }] } }, ana);
    expect(await alterado()).toBe(false);
    const movido = await salvarRascunho(projeto.id, { revisao: dados.ok ? dados.revisao : -1, conteudo: { markdown: "<!-- bloco:cronograma -->\n\n## Escopo\n\nSite com loja e blog." } }, ana);
    expect(movido).toMatchObject({ ok: true });
    expect(await alterado()).toBe(false);
    await salvarRascunho(projeto.id, { revisao: movido.ok ? movido.revisao : -1, conteudo: { markdown: "<!-- bloco:investimento -->\n\n## Escopo\n\nSite com loja e blog." } }, ana);
    expect(await alterado()).toBe(true);
  });

  it("comentário no texto continua achado com bloco no meio do trecho vizinho; a âncora do editor (com os blocos explícitos) vale no servidor", async () => {
    const { projeto, paula, ana, revisao } = await semear();
    const md = "## Escopo\n\nSite com loja e blog.\n\n<!-- bloco:investimento -->\n\n## Prazo\n\n30 dias.";
    await salvarRascunho(projeto.id, { revisao, conteudo: { markdown: md } }, ana);
    const e = new Editor({ extensions: [...EXTENSOES, DestaquesComentarios], content: markdownParaDocumento(md) });
    e.commands.setTextSelection({ from: 8, to: 40 });
    const a = ancoraDaSelecao(e.state)!;
    expect(trechoLegivel(a.trecho)).toContain("Investimento");
    e.destroy();
    expect(await comentar(projeto.id, { texto: "atravessa o bloco", trecho: a }, paula)).toMatchObject({ ok: true });
    expect((await listar(projeto.id))!.threads[0].trechoAlterado).toBe(false);
  });
});

describe("id forjado (GAB-101): nada diz se o comentário existe", () => {
  it("sem acesso, pendente de outra pessoa e inexistente dão a mesma resposta em todas as ações por id", async () => {
    const { projeto, ana, paula, revisao } = await semear();
    const fora = await db.usuario.create({ data: { nome: "Fora", email: "fora@ij.test", papel: "VENDEDOR", area: "VENDAS" } });
    const publico = await comentar(projeto.id, { texto: "x", trecho: "30 dias", sugestao: "45 dias" }, paula);
    const pendente = await comentar(projeto.id, { texto: "y", pendente: true }, paula);
    if (!publico.ok || !pendente.ok) throw new Error("seed");
    const NAO = { ok: false, erro: "COMENTARIO_NAO_ENCONTRADO" };
    const acoes = (id: string, quem: { id: string; papel?: string }) => [
      responderComentario(id, "r", quem),
      resolverComentario(id, quem),
      reabrirComentario(id, quem),
      descartarPendente(id, quem),
      aplicarSugestao(projeto.id, id, { revisao }, quem as typeof ana),
    ];
    for (const r of await Promise.all(acoes(publico.comentario.id, fora))) expect(r).toEqual(NAO);
    for (const r of await Promise.all(acoes("nao-existe", ana))) expect(r).toEqual(NAO);
    for (const r of await Promise.all(acoes(pendente.comentario.id, ana))) expect(r).toEqual(NAO);
    expect(await enviarRevisao(projeto.id, fora)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    // Nada mudou.
    expect(await db.propostaComentario.count()).toBe(2);
    expect((await db.proposta.findFirstOrThrow()).revisao).toBe(revisao);
  });

  it("aplicar com id de outra proposta não grava o texto de uma na outra", async () => {
    const { projeto, ana, paula, revisao } = await semear();
    const c = await comentar(projeto.id, { texto: "x", trecho: "30 dias", sugestao: "45 dias" }, paula);
    if (!c.ok) throw new Error("seed");
    const v = await db.pipeline.findFirstOrThrow({ include: { fases: true } });
    const outro = await db.projeto.create({ data: { pipelineId: v.id, faseId: v.fases[0].id, titulo: "Outro", responsavelId: ana.id, criadoVia: "UI" } });
    const p2 = await criarProposta(outro.id, ana);
    if (!p2.ok) throw new Error("seed");
    expect(await aplicarSugestao(outro.id, c.comentario.id, { revisao: p2.revisao }, ana)).toEqual({ ok: false, erro: "COMENTARIO_NAO_ENCONTRADO" });
    expect(await aplicarSugestao(projeto.id, "nao-existe", { revisao }, ana)).toEqual({ ok: false, erro: "COMENTARIO_NAO_ENCONTRADO" });
  });
});

describe("sugestão aplicável (GAB-101)", () => {
  async function comSugestao() {
    const s = await semear();
    const c = await comentar(s.projeto.id, { texto: "", trecho: "30 dias", sugestao: "  45  dias " }, s.paula);
    if (!c.ok) throw new Error("seed");
    return { ...s, id: c.comentario.id };
  }

  it("criar: normaliza, lista com o estado, e recusa o que não cabe", async () => {
    const { projeto, paula } = await comSugestao();
    const t = (await listar(projeto.id))!.threads[0];
    expect(t.sugestao).toEqual({ texto: "45 dias", aplicada: null, desatualizada: false });
    expect(t.texto).toBe("Sugestão de texto.");
    const recusa = (e: object) => comentar(projeto.id, { texto: "x", ...e }, paula);
    expect(await recusa({ sugestao: "y" })).toEqual({ ok: false, erro: "SUGESTAO_INVALIDA" });
    expect(await recusa({ trecho: "30 dias", sugestao: "30 dias" })).toEqual({ ok: false, erro: "SUGESTAO_IGUAL" });
    expect(await recusa({ trecho: "30 dias", sugestao: "x".repeat(2001) })).toEqual({ ok: false, erro: "SUGESTAO_LONGA" });
    expect(await recusa({ trecho: "Site com loja e blog.\nPrazo", sugestao: "y" })).toEqual({ ok: false, erro: "SUGESTAO_INVALIDA" });
    expect(await recusa({ trecho: "Cronograma", sugestao: "y" })).toEqual({ ok: false, erro: "SUGESTAO_INVALIDA" });
    expect(await recusa({ campo: "valor", sugestao: "y" })).toEqual({ ok: false, erro: "SUGESTAO_INVALIDA" });
  });

  it("só quem tem a caneta aplica; grava, resolve, registra quem aplicou e a Timeline", async () => {
    const { projeto, ana, paula, vera, id, revisao } = await comSugestao();
    expect(await aplicarSugestao(projeto.id, id, { revisao }, paula)).toEqual({ ok: false, erro: "SEM_CANETA" });
    expect(await aplicarSugestao(projeto.id, id, { revisao }, vera)).toEqual({ ok: false, erro: "SEM_CANETA" });
    const r = await aplicarSugestao(projeto.id, id, { revisao }, ana);
    expect(r).toEqual({ ok: true, revisao: revisao + 1 });
    const p = await db.proposta.findFirstOrThrow();
    expect(p.conteudoMd).toContain("45 dias.");
    expect(p.conteudoMd).not.toContain("30 dias");
    const t = (await listar(projeto.id))!.threads[0];
    expect(t.resolvido?.por).toBe("Ana");
    expect(t.sugestao?.aplicada?.por).toBe("Ana");
    expect(t.sugestao?.desatualizada).toBe(false);
    const eventos = await db.timeline.findMany({ where: { tipo: "PROPOSTA" } });
    expect(eventos.some((e) => (e.payload as { evento?: string }).evento === "sugestao_aplicada" && e.usuarioId === ana.id)).toBe(true);
    // Aplicar de novo não faz nada.
    expect(await aplicarSugestao(projeto.id, id, { revisao: revisao + 1 }, ana)).toEqual({ ok: false, erro: "SUGESTAO_JA_APLICADA" });
    // Reabrir a conversa não desfaz o registro nem deixa aplicar outra vez.
    expect(await reabrirComentario(id, paula)).toEqual({ ok: true });
    expect((await listar(projeto.id))!.threads[0].sugestao?.aplicada?.por).toBe("Ana");
    expect(await aplicarSugestao(projeto.id, id, { revisao: revisao + 1 }, ana)).toEqual({ ok: false, erro: "SUGESTAO_JA_APLICADA" });
  });

  it("revisão velha é conflito: não grava nem resolve", async () => {
    const { projeto, ana, id, revisao } = await comSugestao();
    const s = await salvarRascunho(projeto.id, { revisao, conteudo: { markdown: "## Escopo\n\nSite com loja e blog.\n\n## Prazo\n\n30 dias. Mais." } }, ana);
    if (!s.ok) throw new Error("seed");
    const r = await aplicarSugestao(projeto.id, id, { revisao }, ana);
    expect(r).toMatchObject({ ok: false, erro: "CONFLITO" });
    expect((await listar(projeto.id))!.threads[0].resolvido).toBeNull();
    expect((await db.proposta.findFirstOrThrow()).conteudoMd).toContain("30 dias. Mais.");
  });

  it("trecho mudado: desatualizada, não se aplica e nada é gravado", async () => {
    const { projeto, ana, id, revisao } = await comSugestao();
    const s = await salvarRascunho(projeto.id, { revisao, conteudo: { markdown: "## Escopo\n\nSite com loja e blog.\n\n## Prazo\n\n60 dias." } }, ana);
    if (!s.ok) throw new Error("seed");
    const t = (await listar(projeto.id))!.threads[0];
    expect(t.sugestao?.desatualizada).toBe(true);
    expect(t.trechoAlterado).toBe(true);
    expect(await aplicarSugestao(projeto.id, id, { revisao: s.revisao }, ana)).toEqual({ ok: false, erro: "SUGESTAO_DESATUALIZADA" });
    const p = await db.proposta.findFirstOrThrow();
    expect(p.revisao).toBe(s.revisao);
    expect((await listar(projeto.id))!.threads[0].resolvido).toBeNull();
  });

  it("vizinhos editados, trecho intacto (o + da linha): segue aplicável na lista e aplica", async () => {
    const { projeto, ana, paula, revisao } = await semear();
    // O + da linha de "30 dias.": o bloco inteiro é o trecho; os dois contextos da âncora moram nos vizinhos.
    const plano = textoPlano(markdownParaDocumento("## Escopo\n\nSite com loja e blog.\n\n## Prazo\n\n30 dias.")).texto;
    const a = ancoraDaLinha(plano, plano.indexOf("30 dias."), "30 dias.".length)!;
    const c = await comentar(projeto.id, { texto: "", trecho: a, sugestao: "45 dias." }, paula);
    if (!c.ok) throw new Error("seed");
    const s = await salvarRascunho(projeto.id, { revisao, conteudo: { markdown: "## Escopo\n\nSite com loja, blog e app.\n\n## Prazo final\n\n30 dias.\n\nPagamento à vista." } }, ana);
    if (!s.ok) throw new Error("seed");
    const t = (await listar(projeto.id))!.threads[0];
    expect(t.sugestao?.desatualizada).toBe(false);
    expect(t.trechoAlterado).toBe(false);
    expect(await aplicarSugestao(projeto.id, c.comentario.id, { revisao: s.revisao }, ana)).toMatchObject({ ok: true });
    expect((await db.proposta.findFirstOrThrow()).conteudoMd).toContain("## Prazo final\n\n45 dias.\n\nPagamento à vista.");
  });

  it("aplica sobre o texto da tela, que vai junto (o que o autosave ainda não gravou)", async () => {
    const { projeto, ana, id, revisao } = await comSugestao();
    const documento = markdownParaDocumento("## Escopo\n\nSite com loja e blog, ainda não salvo.\n\n## Prazo\n\n30 dias.");
    expect(await aplicarSugestao(projeto.id, id, { revisao, conteudo: { documento } }, ana)).toMatchObject({ ok: true });
    const md = (await db.proposta.findFirstOrThrow()).conteudoMd;
    expect(md).toContain("ainda não salvo");
    expect(md).toContain("45 dias.");
  });

  it("proposta sem edição (caneta passada, congelada): recusa pela mesma regra do autosave", async () => {
    const { projeto, ana, bia, id, revisao } = await comSugestao();
    const v = await salvarVersao(projeto.id, { revisao }, ana);
    if (!v.ok) throw new Error("seed");
    const pc = await passarCaneta(projeto.id, bia.id, ana);
    if (!pc.ok) throw new Error("seed");
    expect(await aplicarSugestao(projeto.id, id, { revisao: pc.revisao }, ana)).toEqual({ ok: false, erro: "SEM_CANETA" });
    expect(await aplicarSugestao(projeto.id, id, { revisao: pc.revisao }, bia)).toMatchObject({ ok: true });
  });
});

describe("revisão em lote (GAB-101)", () => {
  it("pendente: só o autor vê, não avisa, não muda o carimbo dos outros; sobrevive à releitura", async () => {
    const { projeto, paula, ana } = await semear();
    const antes = await versaoDosComentarios(projeto.id, ana);
    const c = await comentar(projeto.id, { texto: "guardado", pendente: true }, paula);
    if (!c.ok) throw new Error("seed");
    expect((await listarComentarios(projeto.id, paula))!.threads.map((t) => [t.texto, t.pendente])).toEqual([["guardado", true]]);
    expect((await listarComentarios(projeto.id, ana))!.threads).toEqual([]);
    expect(await versaoDosComentarios(projeto.id, ana)).toBe(antes);
    expect(await versaoDosComentarios(projeto.id, paula)).not.toBe(antes);
    expect(await avisos()).toEqual([]);
  });

  it("enviar publica tudo, com um único aviso; enviar de novo não publica nem avisa; outro autor segue pendente", async () => {
    const { projeto, ana, paula, vera } = await semear();
    await comentar(projeto.id, { texto: "um", pendente: true }, paula);
    const dois = await comentar(projeto.id, { texto: "dois", trecho: "30 dias", sugestao: "45 dias", pendente: true }, paula);
    if (!dois.ok) throw new Error("seed");
    await responderComentario(dois.comentario.id, "resposta na revisão", paula);
    await comentar(projeto.id, { texto: "da Vera", pendente: true }, vera);
    const antes = await versaoDosComentarios(projeto.id, ana);

    expect(await enviarRevisao(projeto.id, paula)).toEqual({ ok: true, publicados: 3 });
    const l = (await listarComentarios(projeto.id, ana))!;
    expect(l.threads.map((t) => t.texto)).toEqual(["um", "dois"]);
    expect(l.threads[1].respostas.map((r) => r.texto)).toEqual(["resposta na revisão"]);
    expect(l.threads.every((t) => !t.pendente)).toBe(true);
    expect(await versaoDosComentarios(projeto.id, ana)).not.toBe(antes);

    const a = await avisos();
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ usuarioId: ana.id, tipo: "COMENTARIO" });
    expect(a[0].titulo).toContain("3 comentários");

    expect(await enviarRevisao(projeto.id, paula)).toEqual({ ok: false, erro: "NADA_PENDENTE" });
    expect(await avisos()).toHaveLength(1);
    expect((await listarComentarios(projeto.id, vera))!.threads.find((t) => t.texto === "da Vera")?.pendente).toBe(true);
    expect((await listarComentarios(projeto.id, ana))!.threads.some((t) => t.texto === "da Vera")).toBe(false);
  });

  it("dois envios ao mesmo tempo: um publica, um aviso só", async () => {
    const { projeto, paula } = await semear();
    await comentar(projeto.id, { texto: "um", pendente: true }, paula);
    const rs = await Promise.all([enviarRevisao(projeto.id, paula), enviarRevisao(projeto.id, paula)]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(await avisos()).toHaveLength(1);
  });

  it("quem tem a caneta enviando a própria revisão não avisa a si mesmo", async () => {
    const { projeto, ana } = await semear();
    await comentar(projeto.id, { texto: "um", pendente: true }, ana);
    expect(await enviarRevisao(projeto.id, ana)).toMatchObject({ ok: true });
    expect(await avisos()).toEqual([]);
  });

  it("pendente não resolve nem aplica; descartar some com ele e as respostas; publicado não descarta", async () => {
    const { projeto, ana, paula, revisao } = await semear();
    const c = await comentar(projeto.id, { texto: "um", trecho: "30 dias", sugestao: "45 dias", pendente: true }, paula);
    if (!c.ok) throw new Error("seed");
    expect(await resolverComentario(c.comentario.id, paula)).toEqual({ ok: false, erro: "PENDENTE" });
    expect(await aplicarSugestao(projeto.id, c.comentario.id, { revisao }, paula)).toEqual({ ok: false, erro: "PENDENTE" });
    await responderComentario(c.comentario.id, "resposta", paula);
    expect((await db.propostaComentario.findMany()).every((l) => l.pendente)).toBe(true);
    expect(await descartarPendente(c.comentario.id, paula)).toEqual({ ok: true });
    expect(await db.propostaComentario.count()).toBe(0);
    const pub = await comentar(projeto.id, { texto: "pub" }, paula);
    if (!pub.ok) throw new Error("seed");
    expect(await descartarPendente(pub.comentario.id, paula)).toEqual({ ok: false, erro: "NAO_PENDENTE" });
    expect(await descartarPendente(pub.comentario.id, ana)).toEqual({ ok: false, erro: "NAO_PENDENTE" });
  });

  it("resposta pendente em conversa pública: só o autor vê, e não avisa", async () => {
    const { projeto, ana, paula } = await semear();
    const c = await comentar(projeto.id, { texto: "pub" }, ana);
    if (!c.ok) throw new Error("seed");
    await responderComentario(c.comentario.id, "guardada", paula, { pendente: true });
    expect((await listarComentarios(projeto.id, ana))!.threads[0].respostas).toEqual([]);
    expect((await listarComentarios(projeto.id, paula))!.threads[0].respostas.map((r) => r.pendente)).toEqual([true]);
    expect(await avisos()).toEqual([]);
  });
});

describe("comentário em campo dos dados (GAB-101)", () => {
  it("preso ao campo, não fica desatualizado ao mudar o valor; campo inválido é recusado", async () => {
    const { projeto, ana, paula, revisao } = await semear();
    expect(await comentar(projeto.id, { texto: "caro", campo: "valor" }, paula)).toMatchObject({ ok: true });
    expect(await comentar(projeto.id, { texto: "x", campo: "ida" as "valor" }, paula)).toEqual({ ok: false, erro: "CAMPO_INVALIDO" });
    expect(await comentar(projeto.id, { texto: "x", campo: "valor", trecho: "30 dias" }, paula)).toEqual({ ok: false, erro: "TRECHO_INVALIDO" });
    const s = await salvarRascunho(projeto.id, { revisao, estruturado: { valor: "100,00", prazoDias: "", escopoResumo: "", entregas: [] } }, ana);
    expect(s).toMatchObject({ ok: true });
    const t = (await listar(projeto.id))!.threads[0];
    expect(t).toMatchObject({ campo: "valor", ancora: null, trechoAlterado: false, sugestao: null });
  });
});

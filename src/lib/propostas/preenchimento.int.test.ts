// @vitest-environment node
import { mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Papel } from "@prisma/client";
import { dbTeste, limparBanco } from "@/test/db";
import { pdfDeTexto, PNG } from "@/test/fixtures/anexos";
import { anexarArquivo } from "@/lib/anexos/anexos";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { criarProvedorMock, definirPropostaArquivoMock } from "@/lib/llm/provedores/mock";
import { ErroLlm, type PedidoExtracao } from "@/lib/llm/tipos";
import { estruturadoParaEntrada } from "./estruturado";
import { leiturasEmAndamento, PAGINAS_MAX, sugerirDeAnexo } from "./preenchimento";
import { criarProposta, MODELO_INICIAL, obterPropostaDoProjeto, salvarRascunho } from "./propostas";
import { mesclarSugestao } from "./sugestao";

const db = dbTeste();
const provedor = criarProvedorMock();

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
  const novo = (titulo: string) => db.projeto.create({ data: { pipelineId: vendas.id, faseId: vendas.fases[0].id, titulo, responsavelId: ana.id, criadoVia: "UI" } });
  const projeto = await novo("Site da Padaria");
  const outro = await novo("Outro projeto");
  return { ana, bia, paula, gil, vera, projeto, outro };
}

async function anexo(projetoId: string, nome: string, bytes: Uint8Array, por: { id: string; papel: Papel }) {
  const r = await anexarArquivo(projetoId, { nome, bytes }, por);
  if (!r.ok) throw new Error(`seed anexo: ${r.erro}`);
  return r.anexo.id;
}

const LEITURA_BOA = {
  valor_total: { valor: "12500.00", confianca: 0.95, trecho: "Investimento: R$ 12.500,00" },
  prazo_dias: { valor: 60, confianca: 0.9, trecho: "Prazo: 60 dias" },
  escopo_resumo: { valor: "Site institucional com blog", confianca: 0.85, trecho: null },
  entregas: { itens: [{ titulo: "MVP", dia: "2026-12-15", valor: "5000.00", trecho: "MVP — 15/12/2026 — R$ 5.000,00" }], confianca: 0.9 },
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "preencher-"));
  process.env.ANEXOS_DIR = dir;
  await limparBanco(["log_llm", "alerta_operacional", "proposta_versao", "proposta", "anexo", "transicao_fase", "timeline", "oportunidade", "fase", "pipeline", "sessao", "usuario"]);
  invalidarCachePipelines();
});
afterEach(async () => {
  definirPropostaArquivoMock(null);
  vi.restoreAllMocks();
  delete process.env.ANEXOS_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("sugerir a partir de anexo (GAB-90)", () => {
  it("PDF digital: o texto extraído vira o texto; o LLM (sem arquivo) só preenche a parte estruturada; nada é gravado", async () => {
    const { ana, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    const id = await anexo(projeto.id, "proposta.pdf", pdfDeTexto(["Proposta Padaria", "Investimento total 12500"]), ana);
    const pedidos: { texto: string; pedido: PedidoExtracao }[] = [];
    definirPropostaArquivoMock((texto, pedido) => {
      pedidos.push({ texto, pedido });
      return LEITURA_BOA;
    });

    const r = await sugerirDeAnexo(projeto.id, id, ana, { provedor });
    if (!r.ok) throw new Error(r.mensagem);
    expect(r.sugestao).toMatchObject({
      origem: "texto",
      anexo: { id, nome: "proposta.pdf" },
      campos: { valor: "12.500,00", prazoDias: "60", escopoResumo: "Site institucional com blog", entregas: [{ titulo: "MVP", dia: "2026-12-15", valor: "5.000,00" }] },
      revisar: [],
    });
    expect(r.sugestao.markdown).toMatch(/Proposta Padaria[\s\S]*Investimento total 12500/);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].pedido.arquivo).toBeUndefined();
    expect(pedidos[0].texto).toMatch(/Investimento total 12500/);
    // Custo por arquivo: linha em log_llm, sem texto, ref = <ref>:<começo do anexo>.
    const log = await db.logLlm.findMany();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ operacao: "proposta_arquivo", status: "ok", provedor: "mock" });
    expect(log[0].ref).toMatch(new RegExp(`^[0-9a-f]{8}:${id.slice(0, 12)}$`));
    // Sugestão não grava: o rascunho continua o mesmo.
    const p = await db.proposta.findUniqueOrThrow({ where: { projetoId: projeto.id } });
    expect(p).toMatchObject({ conteudoMd: MODELO_INICIAL, revisao: 0 });
  });

  it("PDF escaneado: o arquivo vai ao modelo com visão (base64), que transcreve; campo incerto fica vazio e marcado", async () => {
    const { ana, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    const bytes = pdfDeTexto([""]);
    const id = await anexo(projeto.id, "escaneada.pdf", bytes, ana);
    expect((await db.anexo.findUniqueOrThrow({ where: { id } })).semTexto).toBe(true);
    let recebido: PedidoExtracao | undefined;
    definirPropostaArquivoMock((_t, pedido) => {
      recebido = pedido;
      return { markdown: "# Proposta\n\nTexto **lido** <script>x</script>", ...LEITURA_BOA, valor_total: { valor: "12500.00", confianca: 0.3, trecho: "R$ 12.5?0" } };
    });

    const r = await sugerirDeAnexo(projeto.id, id, ana, { provedor });
    if (!r.ok) throw new Error(r.mensagem);
    expect(recebido?.arquivo).toEqual({ nome: "escaneada.pdf", mime: "application/pdf", base64: Buffer.from(bytes).toString("base64") });
    expect(recebido?.timeoutMs).toBeGreaterThan(30_000);
    // Visão: uma tentativa só (timeout/5xx não re-tentam: uma cobrança, uma espera).
    expect(recebido?.tentativas).toBe(1);
    expect(r.sugestao.origem).toBe("arquivo");
    // Markdown canônico do editor (HTML vira texto escapado).
    expect(r.sugestao.markdown).toBe("# Proposta\n\nTexto **lido** \\<script>x\\</script>");
    expect(r.sugestao.campos.valor).toBeNull();
    expect(r.sugestao.revisar).toEqual([{ campo: "valor", motivo: "leitura incerta: confira no arquivo", lido: "12500.00", trecho: "R$ 12.5?0" }]);
  });

  it("tabela vinda do modelo só passa pela canonização, inclusive torta ou grande, sem quebrar", async () => {
    const { ana, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    const id = await anexo(projeto.id, "escaneada.pdf", pdfDeTexto([""]), ana);
    const grande = ["| x |", "|---|", ...Array.from({ length: 150 }, () => "| y |")].join("\n");
    definirPropostaArquivoMock(() => ({ markdown: `Antes.\n\n| a | b |\n|---|---|\n| 1 | 2 | 3 |\n\n${grande}`, ...LEITURA_BOA }));
    const r = await sugerirDeAnexo(projeto.id, id, ana, { provedor });
    if (!r.ok) throw new Error(r.mensagem);
    expect(r.sugestao.markdown).toContain("| a | b |  |\n| --- | --- | --- |\n| 1 | 2 | 3 |");
    // A grande não cabe nos limites da tabela: entra como texto, sem perder nada.
    expect(r.sugestao.markdown).toContain("\n\ny\n\ny");
  });

  it("imagem: vai como image/png", async () => {
    const { projeto, ana } = await semear();
    await criarProposta(projeto.id, ana);
    const id = await anexo(projeto.id, "foto.png", PNG, ana);
    let mime: string | undefined;
    definirPropostaArquivoMock((_t, pedido) => {
      mime = pedido.arquivo?.mime;
      return { markdown: "Foto da proposta", ...LEITURA_BOA };
    });
    const r = await sugerirDeAnexo(projeto.id, id, ana, { provedor });
    expect(r.ok).toBe(true);
    expect(mime).toBe("image/png");
  });

  it("falha do LLM: erro com ref (a mesma do log do servidor e do log_llm) e o rascunho intacto", async () => {
    const { ana, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    await salvarRascunho(projeto.id, { revisao: 0, conteudo: { markdown: "meu rascunho" } }, ana);
    const id = await anexo(projeto.id, "p.md", new TextEncoder().encode("# Proposta\n\nR$ 10.000"), ana);
    definirPropostaArquivoMock(() => {
      throw new ErroLlm("SEM_CREDITO", { detalhe: "sem crédito na API da OpenAI" });
    });
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});

    const r = await sugerirDeAnexo(projeto.id, id, ana, { provedor });
    if (r.ok) throw new Error("devia falhar");
    expect(r).toMatchObject({ erro: "FALHA_LEITURA", ref: expect.stringMatching(/^[0-9a-f]{8}$/) });
    expect(r.mensagem).toMatch(/sem crédito.*O rascunho não foi alterado/);
    const linhas = erro.mock.calls.map((c) => String(c[0]));
    expect(linhas.some((l) => l.includes(`ref=${r.ref}`) && l.includes("SEM_CREDITO"))).toBe(true);
    const log = await db.logLlm.findFirstOrThrow();
    expect(log).toMatchObject({ operacao: "proposta_arquivo", status: "SEM_CREDITO" });
    expect(log.ref?.startsWith(`${r.ref}:`)).toBe(true);
    const p = await db.proposta.findUniqueOrThrow({ where: { projetoId: projeto.id } });
    expect(p).toMatchObject({ conteudoMd: "meu rascunho", revisao: 1 });
  });

  it("saída fora do schema também é falha com ref (nunca aplica lixo)", async () => {
    const { ana, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    const id = await anexo(projeto.id, "p.txt", new TextEncoder().encode("Proposta"), ana);
    definirPropostaArquivoMock(() => ({ valor_total: "12500" }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const r = await sugerirDeAnexo(projeto.id, id, ana, { provedor });
    expect(r).toMatchObject({ ok: false, erro: "FALHA_LEITURA", ref: expect.any(String) });
    expect((await db.logLlm.findFirstOrThrow()).status).toBe("SAIDA_INVALIDA");
  });

  it("caneta (GAB-87): só o dono, com o pingue-pongue em curso — conferido ANTES da vaga e do LLM (não gasta)", async () => {
    const { ana, bia, paula, gil, vera, projeto } = await semear();
    await criarProposta(projeto.id, ana); // a caneta começa com a vendedora responsável
    expect(await db.proposta.findFirstOrThrow({ where: { projetoId: projeto.id } })).toMatchObject({ canetaComId: ana.id });
    const id = await anexo(projeto.id, "p.md", new TextEncoder().encode("texto"), ana);
    const chamado = vi.fn(() => LEITURA_BOA);
    definirPropostaArquivoMock(chamado);
    // outro vendedor, projetos, GESTOR sem caneta e visualizador: SEM_CANETA
    for (const quem of [bia, paula, gil, vera]) {
      expect(await sugerirDeAnexo(projeto.id, id, quem, { provedor })).toEqual({ ok: false, erro: "SEM_CANETA", mensagem: expect.stringMatching(/não está com a caneta/) });
    }
    await db.usuario.update({ where: { id: ana.id }, data: { ativo: false } });
    expect(await sugerirDeAnexo(projeto.id, id, ana, { provedor })).toMatchObject({ ok: false, erro: "SEM_CANETA" });
    await db.usuario.update({ where: { id: ana.id }, data: { ativo: true } });
    // pronta para envio e encerrada: nem o dono da caneta usa
    await db.proposta.update({ where: { projetoId: projeto.id }, data: { status: "PRONTA_PARA_ENVIO" } });
    expect(await sugerirDeAnexo(projeto.id, id, ana, { provedor })).toMatchObject({ ok: false, erro: "PROPOSTA_PRONTA" });
    await db.proposta.update({ where: { projetoId: projeto.id }, data: { status: "ENVIADA" } });
    expect(await sugerirDeAnexo(projeto.id, id, ana, { provedor })).toMatchObject({ ok: false, erro: "PROPOSTA_COM_O_CLIENTE" });
    await db.proposta.update({ where: { projetoId: projeto.id }, data: { status: "ACEITA" } });
    expect(await sugerirDeAnexo(projeto.id, id, ana, { provedor })).toMatchObject({ ok: false, erro: "PROPOSTA_ENCERRADA" });
    expect(chamado).not.toHaveBeenCalled();
    expect(await db.logLlm.count()).toBe(0);
    expect(leiturasEmAndamento()).toBe(0);
  });

  it("sem caneta → recusado sem LLM e SEM ocupar vaga (mesmo com o semáforo cheio, a resposta é SEM_CANETA)", async () => {
    const { ana, bia, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    const id = await anexo(projeto.id, "p.md", new TextEncoder().encode("texto"), ana);
    let soltar!: () => void;
    const portao = new Promise<void>((ok) => (soltar = ok));
    let chamadas = 0;
    definirPropostaArquivoMock(async () => {
      chamadas++;
      await portao;
      return LEITURA_BOA;
    });
    vi.spyOn(console, "info").mockImplementation(() => {});
    const a1 = sugerirDeAnexo(projeto.id, id, ana, { provedor });
    await vi.waitFor(() => expect(chamadas).toBe(1));
    expect(await sugerirDeAnexo(projeto.id, id, bia, { provedor })).toMatchObject({ ok: false, erro: "SEM_CANETA" });
    expect(leiturasEmAndamento()).toBe(1);
    expect(chamadas).toBe(1);
    soltar();
    expect((await a1).ok).toBe(true);
    expect(leiturasEmAndamento()).toBe(0);
  });

  it("sem proposta, anexo de outro projeto ou excluído, projeto inexistente: recusa sem chamar o LLM", async () => {
    const { ana, projeto, outro } = await semear();
    const id = await anexo(projeto.id, "p.md", new TextEncoder().encode("texto"), ana);
    const deOutro = await anexo(outro.id, "o.md", new TextEncoder().encode("outro"), ana);
    expect(await sugerirDeAnexo(projeto.id, id, ana, { provedor })).toMatchObject({ ok: false, erro: "PROPOSTA_NAO_ENCONTRADA" });
    await criarProposta(projeto.id, ana);
    expect(await sugerirDeAnexo(projeto.id, deOutro, ana, { provedor })).toMatchObject({ ok: false, erro: "ANEXO_NAO_ENCONTRADO" });
    await db.anexo.update({ where: { id }, data: { deletadoEm: new Date() } });
    expect(await sugerirDeAnexo(projeto.id, id, ana, { provedor })).toMatchObject({ ok: false, erro: "ANEXO_NAO_ENCONTRADO" });
    expect(await sugerirDeAnexo("nao-existe", id, ana, { provedor })).toMatchObject({ ok: false, erro: "PROJETO_NAO_ENCONTRADO" });
    expect(await db.logLlm.count()).toBe(0);
  });

  it("aplicar = salvarRascunho de sempre: grava texto + dados mesclados; base velha é CONFLITO", async () => {
    const { ana, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    await salvarRascunho(projeto.id, { revisao: 0, estruturado: { valor: "", prazoDias: "30", escopoResumo: "", entregas: [] } }, ana);
    const id = await anexo(projeto.id, "p.md", new TextEncoder().encode("# Proposta da Padaria\n\nTexto"), ana);
    definirPropostaArquivoMock(() => ({ ...LEITURA_BOA, prazo_dias: { valor: null, confianca: 0, trecho: null } }));
    const r = await sugerirDeAnexo(projeto.id, id, ana, { provedor });
    if (!r.ok) throw new Error(r.mensagem);
    const atual = (await obterPropostaDoProjeto(projeto.id))!.proposta!;
    const estruturado = mesclarSugestao(estruturadoParaEntrada(atual.estruturado), r.sugestao.campos);

    const velho = await salvarRascunho(projeto.id, { revisao: 0, conteudo: { markdown: r.sugestao.markdown }, estruturado }, ana);
    expect(velho).toMatchObject({ ok: false, erro: "CONFLITO" });
    const ok = await salvarRascunho(projeto.id, { revisao: atual.revisao, conteudo: { markdown: r.sugestao.markdown }, estruturado }, ana);
    expect(ok).toMatchObject({ ok: true, revisao: 2 });
    const p = await db.proposta.findUniqueOrThrow({ where: { projetoId: projeto.id } });
    expect(p.conteudoMd).toBe("# Proposta da Padaria\n\nTexto");
    // prazo não veio do arquivo: ficou o que estava (30), nada inventado.
    expect(p.estruturado).toMatchObject({ valor: "12500.00", prazoDias: 30, escopoResumo: "Site institucional com blog" });
    expect(p.valor?.toFixed(2)).toBe("12500.00");
  });

  it("limite de leituras simultâneas: 1 por pessoa e 2 no total; a vaga volta no fim (também na falha)", async () => {
    const { ana, bia, projeto } = await semear();
    const carla = await db.usuario.create({ data: { nome: "Carla", email: "carla@ij.test", papel: "VENDEDOR" } });
    await criarProposta(projeto.id, ana);
    const id = await anexo(projeto.id, "p.md", new TextEncoder().encode("texto"), ana);
    // Cada pessoa com a caneta da PRÓPRIA proposta (responsável de vendas → caneta).
    const deOutra = async (resp: { id: string; papel: Papel }) => {
      const p = await db.projeto.create({ data: { pipelineId: projeto.pipelineId, faseId: projeto.faseId, titulo: `Projeto de ${resp.id}`, responsavelId: resp.id, criadoVia: "UI" } });
      await criarProposta(p.id, resp);
      return { pid: p.id, aid: await anexo(p.id, "p.md", new TextEncoder().encode(`texto ${resp.id}`), resp) };
    };
    const daBia = await deOutra(bia);
    const daCarla = await deOutra(carla);
    let soltar!: () => void;
    const portao = new Promise<void>((ok) => (soltar = ok));
    let chamadas = 0;
    definirPropostaArquivoMock(async () => {
      chamadas++;
      await portao;
      return LEITURA_BOA;
    });
    vi.spyOn(console, "info").mockImplementation(() => {});
    const a1 = sugerirDeAnexo(projeto.id, id, ana, { provedor });
    const g1 = sugerirDeAnexo(daBia.pid, daBia.aid, bia, { provedor });
    await vi.waitFor(() => expect(chamadas).toBe(2));
    expect(leiturasEmAndamento()).toBe(2);
    expect(await sugerirDeAnexo(projeto.id, id, ana, { provedor })).toEqual({
      ok: false,
      erro: "OCUPADO",
      mensagem: "Você já tem uma leitura de arquivo em andamento. Espere ela terminar antes de pedir outra.",
    });
    expect(await sugerirDeAnexo(daCarla.pid, daCarla.aid, carla, { provedor })).toMatchObject({ ok: false, erro: "OCUPADO", mensagem: expect.stringMatching(/Já há 2 leituras/) });
    expect(chamadas).toBe(2);
    soltar();
    expect((await a1).ok).toBe(true);
    expect((await g1).ok).toBe(true);
    expect(leiturasEmAndamento()).toBe(0);

    definirPropostaArquivoMock(() => {
      throw new ErroLlm("HTTP", { status: 500 });
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await sugerirDeAnexo(projeto.id, id, ana, { provedor })).ok).toBe(false);
    expect(leiturasEmAndamento()).toBe(0);
    expect((await sugerirDeAnexo(projeto.id, id, ana, { provedor })).ok).toBe(false); // ainda tem vaga
  });

  it(`PDF escaneado com mais de ${PAGINAS_MAX} páginas: recusado antes do LLM, com mensagem clara`, async () => {
    const { ana, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    const id = await anexo(projeto.id, "grande.pdf", pdfDeTexto(Array(PAGINAS_MAX + 1).fill("")), ana);
    const chamado = vi.fn(() => ({ markdown: "x", ...LEITURA_BOA }));
    definirPropostaArquivoMock(chamado);
    const r = await sugerirDeAnexo(projeto.id, id, ana, { provedor });
    expect(r).toMatchObject({ ok: false, erro: "PAGINAS_DEMAIS", mensagem: expect.stringMatching(new RegExp(`${PAGINAS_MAX + 1} páginas.*até ${PAGINAS_MAX}`)) });
    expect(chamado).not.toHaveBeenCalled();
    expect(await db.logLlm.count()).toBe(0);
    expect(leiturasEmAndamento()).toBe(0);
    // no limite passa
    const ok = await anexo(projeto.id, "ok.pdf", pdfDeTexto(Array(PAGINAS_MAX).fill("")), ana);
    vi.spyOn(console, "info").mockImplementation(() => {});
    expect((await sugerirDeAnexo(projeto.id, ok, ana, { provedor })).ok).toBe(true);
  });

  it("arquivo sumiu do disco (ENOENT): mensagem diz isso (não 'falha da IA'), com ref, sem LLM", async () => {
    const { ana, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    const id = await anexo(projeto.id, "foto.png", PNG, ana);
    await unlink(path.join(dir, id));
    const chamado = vi.fn(() => ({ markdown: "x", ...LEITURA_BOA }));
    definirPropostaArquivoMock(chamado);
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await sugerirDeAnexo(projeto.id, id, ana, { provedor });
    if (r.ok) throw new Error("devia falhar");
    expect(r).toMatchObject({ erro: "ARQUIVO_INDISPONIVEL", ref: expect.stringMatching(/^[0-9a-f]{8}$/) });
    expect(r.mensagem).toMatch(/não foi encontrado no servidor.*Envie-o de novo/);
    expect(r.mensagem).not.toMatch(/IA/);
    expect(erro.mock.calls.some((c) => String(c[0]).includes(`ref=${r.ref}`) && String(c[0]).includes("ENOENT"))).toBe(true);
    expect(chamado).not.toHaveBeenCalled();
    expect(leiturasEmAndamento()).toBe(0);
  });
});

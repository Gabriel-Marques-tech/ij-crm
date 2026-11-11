// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Area, Cargo, Papel } from "@prisma/client";
import { anexarArquivo } from "@/lib/anexos/anexos";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { moverCard, criarCard } from "@/lib/projetos/projetos";
import { dbTeste, limparBanco } from "@/test/db";
import { pdfDeTexto } from "@/test/fixtures/anexos";
import { executarFerramenta, SO_LEITURA } from "./ferramentas";
import type { UsuarioMcp } from "./oauth";

const db = dbTeste();
const texto = (r: { content: unknown[] }) => (r.content[0] as { text: string }).text;
const dados = (r: { content: unknown[] }) => JSON.parse(texto(r));

async function semear() {
  const vendas = await db.pipeline.create({
    data: {
      chave: "vendas",
      nome: "Vendas",
      ordem: 0,
      fases: {
        create: [
          { chave: "montando_contrato", nome: "Montando contrato", ordem: 0, marco: "MONTANDO_CONTRATO" },
          { chave: "contrato_assinado", nome: "Contrato assinado", ordem: 1, isTerminal: true, tipoTerminal: "GANHO", marco: "GANHO" },
          { chave: "perdido", nome: "Perdido", ordem: 2, isTerminal: true, tipoTerminal: "PERDIDO", marco: "PERDIDO" },
        ],
      },
    },
    include: { fases: true },
  });
  const projetos = await db.pipeline.create({
    data: {
      chave: "projetos",
      nome: "Projetos",
      ordem: 1,
      fases: {
        create: [
          { chave: "handoff", nome: "Handoff", ordem: 0, marco: "HANDOFF" },
          { chave: "em_execucao", nome: "Em execução", ordem: 1, marco: "EXECUCAO" },
          { chave: "finalizado", nome: "Finalizado", ordem: 2, isTerminal: true, tipoTerminal: "GANHO", marco: "FINALIZADO" },
        ],
      },
    },
    include: { fases: true },
  });
  const pessoa = async (nome: string, papel: Papel, extra: { area?: Area; cargos?: Cargo[] } = {}): Promise<UsuarioMcp> => {
    const u = await db.usuario.create({ data: { nome, email: `${nome.toLowerCase()}@ij.test`, papel, ...extra } });
    return { id: u.id, nome: u.nome, papel: u.papel, area: u.area, cargos: u.cargos };
  };
  return {
    vendas,
    projetos,
    ana: await pessoa("Ana", "VENDEDOR", { area: "VENDAS" }),
    gil: await pessoa("Gil", "GESTOR"),
    vera: await pessoa("Vera", "VISUALIZADOR"),
    paula: await pessoa("Paula", "PROJETOS", { area: "PROJETOS", cargos: ["GP"] }),
    pedro: await pessoa("Pedro", "PROJETOS", { area: "PROJETOS" }),
  };
}

let s: Awaited<ReturnType<typeof semear>>;
const pessoaMcp = async (nome: string, papel: Papel, extra: { area?: Area; cargos?: Cargo[] } = {}): Promise<UsuarioMcp> => {
  const u = await db.usuario.create({ data: { nome, email: `${nome.toLowerCase()}@ij.test`, papel, ...extra } });
  return { id: u.id, nome: u.nome, papel: u.papel, area: u.area, cargos: u.cargos };
};
let dir: string;
let id: string;
const chamar = (nome: string, args: Record<string, unknown>, eu: UsuarioMcp) => executarFerramenta(nome, args, eu);

beforeEach(async () => {
  await limparBanco(["aviso", "anexo", "proposta", "projeto_handoff", "transicao_fase", "timeline", "oportunidade", "fase", "pipeline", "usuario"]);
  invalidarCachePipelines();
  dir = await mkdtemp(path.join(tmpdir(), "mcp-handoff-"));
  process.env.ANEXOS_DIR = dir;
  vi.spyOn(console, "info").mockImplementation(() => {});
  s = await semear();
  const r = await criarCard({ pipelineId: s.projetos.id, faseId: s.projetos.fases.find((f) => f.chave === "handoff")!.id, titulo: "Site" }, s.ana);
  if (!r.ok) throw new Error(r.erro);
  id = r.id;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe("MCP do handoff (GAB-93)", () => {
  it("fluxo inteiro: lê, preenche, designa e só então move; a Timeline sai via MCP", async () => {
    const inicio = dados(await chamar("ler_handoff", { id }, s.gil));
    expect(inicio).toMatchObject({ editavel: true, isento: false, completo: false, gp: null });
    expect(inicio.falta).toContain("GP do projeto designado");
    expect(inicio.candidatos_gp.map((c: { nome: string }) => c.nome)).toEqual(["Paula", "Pedro"]);

    const recusa = await chamar("mover_para_execucao", { id }, s.gil);
    expect(recusa.isError).toBe(true);
    expect(texto(recusa)).toContain("Falta: GP do projeto designado");
    // O arraste pelo MCP recusa igual.
    const execucao = s.projetos.fases.find((f) => f.chave === "em_execucao")!.id;
    const recusa2 = await chamar("mover_projeto", { id, fase_id: execucao }, s.gil);
    expect(recusa2.isError).toBe(true);
    expect(texto(recusa2)).toContain("Falta:");

    expect(dados(await chamar("designar_gp_projeto", { id, gp_id: s.pedro.id }, s.paula))).toMatchObject({ mudou: true });
    for (const item of ["contatos", "kickoff", "acessos"]) expect(dados(await chamar("marcar_item_handoff", { id, item, feito: true }, s.ana))).toMatchObject({ mudou: true });
    expect(dados(await chamar("escrever_resumo_handoff", { id, contexto: "c", combinados: "d", riscos: "r", valoriza: "v" }, s.ana))).toMatchObject({ mudou: true });
    const pdf = Buffer.from(pdfDeTexto(["Contrato"])).toString("base64");
    expect(dados(await chamar("definir_contrato_handoff", { id, pdf_base64: pdf, pdf_nome: "assinado" }, s.ana)).anexo.nome).toBe("assinado.pdf");

    const fim = dados(await chamar("ler_handoff", { id }, s.vera));
    expect(fim).toMatchObject({ completo: true, falta: null, gp: { nome: "Pedro", valido: true, responsavel: true }, resumo: { contexto: "c", por: "Ana" } });
    expect(fim.checklist.contrato_pdf).toMatchObject({ feito: true, anexo: { nome: "assinado.pdf" } });
    expect(fim.checklist.kickoff.feito).toBe(true);

    expect(texto(await chamar("mover_para_execucao", { id }, s.ana))).toMatch(/outra área/); // GAB-98: vendas não move card de Projetos sem ser a responsável
    expect(dados(await chamar("mover_para_execucao", { id }, s.pedro))).toMatchObject({ mudou: true });
    const c = await db.projeto.findUniqueOrThrow({ where: { id }, include: { fase: true } });
    expect(c.fase.marco).toBe("EXECUCAO");
    // Saiu de Handoff: a regra volta ao normal para Vendas.
    expect((await chamar("marcar_item_handoff", { id, item: "kickoff", feito: false }, s.ana)).isError).toBe(true);
    expect(texto(await chamar("atualizar_projeto", { id, campos: { cidade: "Santos" } }, s.ana))).toMatch(/outra área/);
    expect(c.responsavelId).toBe(s.pedro.id);
    const tl = await db.timeline.findMany({ where: { projetoId: id, tipo: "HANDOFF" } });
    expect(tl.length).toBeGreaterThan(4);
    expect(tl.every((t) => t.viaMcp)).toBe(true);
    expect((await db.aviso.findFirstOrThrow({ where: { usuarioId: s.pedro.id } })).tipo).toBe("HANDOFF");
  });

  it("as mesmas permissões da tela", async () => {
    expect(texto(await chamar("marcar_item_handoff", { id, item: "kickoff", feito: true }, s.vera))).toBe(SO_LEITURA);
    expect(texto(await chamar("designar_gp_projeto", { id, gp_id: s.pedro.id }, s.gil))).toContain("Só o PM de projetos");
    // Cargos de Projetos: o PM designa pelo MCP; o PO (sem permissão nova) não.
    const pm = await pessoaMcp("Mia", "PROJETOS", { area: "PROJETOS", cargos: ["PM"] });
    const po = await pessoaMcp("Olga", "PROJETOS", { area: "PROJETOS", cargos: ["PO"] });
    expect(texto(await chamar("designar_gp_projeto", { id, gp_id: s.pedro.id }, po))).toContain("Só o PM de projetos");
    expect(dados(await chamar("designar_gp_projeto", { id, gp_id: po.id }, pm))).toMatchObject({ mudou: true });
    expect(texto(await chamar("escrever_resumo_handoff", { id, contexto: "x" }, s.pedro))).toContain("escrito por vendas");
    expect((await chamar("marcar_item_handoff", { id, item: "proposta", feito: true }, s.ana)).isError).toBe(true);
  });

  it("contrato: um PDF já anexado por anexo_id; exige um dos dois", async () => {
    const a = await anexarArquivo(id, { nome: "c.pdf", bytes: pdfDeTexto(["x"]) }, s.ana);
    if (!a.ok) throw new Error(a.erro);
    expect((await chamar("definir_contrato_handoff", { id }, s.ana)).isError).toBe(true);
    expect((await chamar("definir_contrato_handoff", { id, anexo_id: a.anexo.id, pdf_base64: "AAAA" }, s.ana)).isError).toBe(true);
    expect(dados(await chamar("definir_contrato_handoff", { id, anexo_id: a.anexo.id }, s.ana))).toMatchObject({ mudou: true });
    expect(dados(await chamar("listar_anexos", { projeto_id: id }, s.ana)).anexos[0].contratoAssinado).toBe(true);
  });

  it("sem PM de projetos ativo, ler_handoff avisa que ninguém tem o cargo", async () => {
    expect(dados(await chamar("ler_handoff", { id }, s.ana)).aviso).toBeUndefined();
    await db.usuario.update({ where: { id: s.paula.id }, data: { cargos: [] } });
    expect(dados(await chamar("ler_handoff", { id }, s.ana)).aviso).toContain("Ninguém tem o cargo de PM de projetos");
  });

  it("ler_handoff de card em Vendas explica que o handoff começa no Ganho", async () => {
    const r = await criarCard({ pipelineId: s.vendas.id, faseId: s.vendas.fases.find((f) => f.chave === "perdido")!.id, titulo: "x" }, s.ana);
    expect(r.ok).toBe(false);
    await db.proposta.deleteMany();
    const mc = s.vendas.fases.find((f) => f.chave === "montando_contrato")!.id;
    const c = await db.projeto.create({ data: { pipelineId: s.vendas.id, faseId: mc, titulo: "v", responsavelId: s.ana.id, criadoVia: "UI", isentoTravaContrato: true } });
    expect(texto(await chamar("ler_handoff", { id: c.id }, s.ana))).toContain("o handoff começa no Ganho");
    await moverCard(c.id, s.vendas.fases.find((f) => f.chave === "contrato_assinado")!.id, s.ana, { dadosTerminal: { valorFechado: "" } });
    expect(dados(await chamar("ler_handoff", { id: c.id }, s.ana))).toMatchObject({ editavel: true });
  });
});

describe("GAB-98: handoff é etapa conjunta de Projetos + Vendas", () => {
  it("vendedor não responsável e gestor de vendas marcam item e definem o contrato em Handoff; em Execução, recusados", async () => {
    const gina = await db.usuario.create({ data: { nome: "Gina", email: "gina@ij.test", papel: "GESTOR", area: "VENDAS" } });
    const gestorVendas = { id: gina.id, nome: gina.nome, papel: gina.papel, area: gina.area, cargos: gina.cargos };
    await db.projeto.update({ where: { id }, data: { responsavelId: s.pedro.id } }); // Ana deixa de ser a responsável
    // GP designado: ele vira o responsável, e a vendedora deixa de ser.
    expect(dados(await chamar("designar_gp_projeto", { id, gp_id: s.pedro.id }, s.paula))).toMatchObject({ mudou: true });
    const pdf = Buffer.from(pdfDeTexto(["Contrato"])).toString("base64");
    for (const quem of [s.ana, gestorVendas]) {
      expect((await chamar("marcar_item_handoff", { id, item: "kickoff", feito: quem === s.ana }, quem)).isError).toBeFalsy();
      expect((await chamar("definir_contrato_handoff", { id, pdf_base64: pdf, pdf_nome: quem.nome }, quem)).isError).toBeFalsy();
      expect(texto(await chamar("mover_para_execucao", { id }, quem))).toMatch(/outra área/);
    }
    expect(texto(await chamar("marcar_item_handoff", { id, item: "kickoff", feito: true }, s.vera))).toBe(SO_LEITURA);
  });
});

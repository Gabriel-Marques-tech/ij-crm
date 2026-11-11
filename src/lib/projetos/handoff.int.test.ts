// @vitest-environment node
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Area, Cargo, Papel } from "@prisma/client";
import { anexarArquivo } from "@/lib/anexos/anexos";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { moverFase, removerFase, reordenarFases } from "@/lib/fases/fases";
import { excluirAnexo } from "@/lib/lixeira/anexos";
import { excluirCard, restaurarCard } from "@/lib/lixeira/cards";
import { carregarFluxo } from "@/lib/painel/servico";
import { carregarDados } from "@/lib/ranking/servico";
import { listarQuadro } from "./projetos";
import { anexarPdfDoContrato } from "./contrato-anexo";
import { salvarRascunho } from "@/lib/propostas/propostas";
import { dbTeste, limparBanco } from "@/test/db";
import { PNG, pdfDeTexto } from "@/test/fixtures/anexos";
import { marcarContratoAssinado } from "./contrato-assinado";
import {
  anexarContratoNoHandoff,
  definirContratoNoHandoff,
  designarGpDoProjeto,
  listarCandidatosGp,
  marcarItemHandoff,
  moverParaExecucao,
  obterHandoff,
  salvarResumoHandoff,
} from "./handoff";
import { criarCard, editarCard, moverCard } from "./projetos";

const db = dbTeste();

async function semear() {
  const vendas = await db.pipeline.create({
    data: {
      chave: "vendas",
      nome: "Vendas",
      ordem: 0,
      fases: {
        create: [
          { chave: "negociacao", nome: "Negociação", ordem: 0 },
          { chave: "proposta", nome: "Proposta", ordem: 1, marco: "PROPOSTA" },
          { chave: "montando_contrato", nome: "Montando contrato", ordem: 2, marco: "MONTANDO_CONTRATO" },
          { chave: "contrato_assinado", nome: "Contrato assinado", ordem: 3, isTerminal: true, tipoTerminal: "GANHO", marco: "GANHO" },
          { chave: "perdido", nome: "Perdido", ordem: 4, isTerminal: true, tipoTerminal: "PERDIDO", marco: "PERDIDO" },
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
          { chave: "preparacao", nome: "Preparação", ordem: 1 },
          { chave: "em_execucao", nome: "Em execução", ordem: 2, marco: "EXECUCAO" },
          { chave: "conclusao", nome: "Conclusão", ordem: 3 },
          { chave: "finalizado", nome: "Finalizado", ordem: 4, isTerminal: true, tipoTerminal: "GANHO", marco: "FINALIZADO" },
          { chave: "perdido_projeto", nome: "Perdido", ordem: 5, isTerminal: true, tipoTerminal: "PERDIDO" },
        ],
      },
    },
    include: { fases: true },
  });
  const pessoa = async (nome: string, papel: Papel, extra: { area?: Area; cargos?: Cargo[]; ativo?: boolean; telefoneWhatsapp?: string } = {}) =>
    db.usuario.create({ data: { nome, email: `${nome.toLowerCase()}@ij.test`, papel, ...extra } });
  const ana = await pessoa("Ana", "VENDEDOR", { area: "VENDAS" });
  const gil = await pessoa("Gil", "GESTOR");
  const vera = await pessoa("Vera", "VISUALIZADOR");
  const paula = await pessoa("Paula", "PROJETOS", { area: "PROJETOS", cargos: ["GP"], telefoneWhatsapp: "+5511911111111" });
  const pedro = await pessoa("Pedro", "PROJETOS", { area: "PROJETOS", telefoneWhatsapp: "+5511922222222" });
  const inativo = await pessoa("Ivo", "PROJETOS", { area: "PROJETOS", ativo: false });
  const gpVendas = await pessoa("Gabi", "VENDEDOR", { area: "VENDAS", cargos: ["GP"] });
  const f = (chave: string) => [...vendas.fases, ...projetos.fases].find((x) => x.chave === chave)!.id;
  const novo = async (titulo = "Site") => {
    const r = await criarCard({ pipelineId: vendas.id, faseId: f("negociacao"), titulo }, ana);
    if (!r.ok) throw new Error(r.erro);
    return r.id;
  };
  /** Pelo caminho real: proposta aceita → Montando contrato → Ganho → Handoff. */
  const emHandoff = async (titulo = "Site") => {
    const id = await novo(titulo);
    await db.proposta.create({ data: { projetoId: id, status: "ACEITA", criadoPorId: ana.id, versaoEnviada: 2 } });
    expect(await moverCard(id, f("montando_contrato"), ana)).toMatchObject({ ok: true });
    expect(await moverCard(id, f("contrato_assinado"), ana, { dadosTerminal: { valorFechado: "10,00" } })).toMatchObject({ ok: true });
    await db.aviso.deleteMany();
    return id;
  };
  /** Fecha tudo o que falta, pelos serviços. */
  const completar = async (id: string) => {
    expect(await designarGpDoProjeto(id, pedro.id, paula)).toMatchObject({ ok: true });
    for (const i of ["contatos", "kickoff", "acessos"] as const) expect(await marcarItemHandoff(id, i, true, ana)).toMatchObject({ ok: true });
    expect(await salvarResumoHandoff(id, RESUMO, ana)).toMatchObject({ ok: true });
    expect(await anexarContratoNoHandoff(id, PDF(), ana)).toMatchObject({ ok: true });
  };
  return { vendas, projetos, ana, gil, vera, paula, pedro, inativo, gpVendas, f, novo, emHandoff, completar };
}

const RESUMO = { contexto: "Padaria quer vender online", combinados: "Foto incluída", riscos: "Prazo apertado", valoriza: "Atendimento rápido" };
let seq = 0;
const PDF = () => ({ nome: "contrato.pdf", bytes: pdfDeTexto([`Contrato assinado ${++seq}`]) });
const lerCard = (id: string) => db.projeto.findUniqueOrThrow({ where: { id }, include: { fase: true } });

let dir: string;
let s: Awaited<ReturnType<typeof semear>>;
beforeEach(async () => {
  await limparBanco(["aviso", "anexo", "proposta", "projeto_handoff", "transicao_fase", "timeline", "oportunidade", "fase", "pipeline", "usuario"]);
  invalidarCachePipelines();
  dir = await mkdtemp(path.join(tmpdir(), "handoff-"));
  process.env.ANEXOS_DIR = dir;
  delete process.env.NOTIFICATIONS_ENABLED;
  vi.spyOn(console, "info").mockImplementation(() => {});
  s = await semear();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe("Ganho → Handoff", () => {
  it("o card cai na coluna Handoff e os GPs de projetos recebem o aviso (app + WhatsApp em safe mode)", async () => {
    const id = await s.novo();
    await db.proposta.create({ data: { projetoId: id, status: "ACEITA", criadoPorId: s.ana.id } });
    await moverCard(id, s.f("montando_contrato"), s.ana);
    expect(await marcarContratoAssinado(id, { valorFechado: "10,00" }, s.ana)).toMatchObject({ ok: true, mudou: true });
    expect((await lerCard(id)).fase.marco).toBe("HANDOFF");
    const avisos = await db.aviso.findMany();
    expect(avisos.map((a) => [a.usuarioId, a.tipo, a.whatsapp])).toEqual([[s.paula.id, "HANDOFF", "SAFE_MODE"]]);
    expect(avisos[0].titulo).toContain("Proposta aceita / handoff");
    expect(avisos[0].projetoId).toBe(id);
  });

  it("mover de novo para o mesmo lugar não reavisa; outro movimento qualquer também não", async () => {
    const id = await s.emHandoff();
    expect(await moverCard(id, s.f("handoff"), s.ana)).toEqual({ ok: true, mudou: false, terminal: null });
    expect(await moverCard(id, s.f("preparacao"), s.ana)).toEqual({ ok: true, mudou: true, terminal: null });
    expect(await db.aviso.count()).toBe(0);
  });

  it("GP de projetos que marca o ganho não avisa a si mesmo", async () => {
    const id = await s.novo();
    await db.proposta.create({ data: { projetoId: id, status: "ACEITA", criadoPorId: s.ana.id } });
    await moverCard(id, s.f("montando_contrato"), s.ana);
    await moverCard(id, s.f("contrato_assinado"), s.paula, { dadosTerminal: { valorFechado: "" } });
    expect(await db.aviso.count()).toBe(0);
  });
});

describe("trava de Execução", () => {
  it("recusa e diz o que falta, para qualquer papel; nada muda", async () => {
    const id = await s.emHandoff();
    for (const quem of [s.ana, s.gil, s.paula]) {
      const r = await moverCard(id, s.f("em_execucao"), quem);
      expect(r).toMatchObject({ ok: false, erro: "HANDOFF_INCOMPLETO" });
      expect(!r.ok && r.faltando).toContain("GP do projeto designado");
      expect(!r.ok && r.faltando).toContain("resumo de handoff completo");
      expect(!r.ok && r.faltando).not.toContain("proposta final congelada");
    }
    expect((await lerCard(id)).fase.marco).toBe("HANDOFF");
  });

  it("cada pendência sozinha ainda segura", async () => {
    const id = await s.emHandoff();
    await s.completar(id);
    await marcarItemHandoff(id, "kickoff", false, s.ana);
    expect(await moverCard(id, s.f("em_execucao"), s.ana)).toMatchObject({ ok: false, faltando: "kickoff marcado" });
    await marcarItemHandoff(id, "kickoff", true, s.ana);
    await salvarResumoHandoff(id, { riscos: "   " }, s.ana);
    expect(await moverCard(id, s.f("em_execucao"), s.ana)).toMatchObject({ ok: false, faltando: "resumo de handoff completo" });
    await salvarResumoHandoff(id, { riscos: "Nenhum" }, s.ana);
    const anexo = await db.anexo.findFirstOrThrow({ where: { projetoId: id, contratoAssinado: true } });
    expect(await excluirAnexo(anexo.id, s.ana)).toMatchObject({ ok: true });
    expect(await moverCard(id, s.f("em_execucao"), s.ana)).toMatchObject({ ok: false, faltando: "PDF do contrato assinado" });
    await db.anexo.update({ where: { id: anexo.id }, data: { deletadoEm: null } });
    await db.usuario.update({ where: { id: s.pedro.id }, data: { ativo: false } });
    expect(await moverCard(id, s.f("em_execucao"), s.ana)).toMatchObject({ ok: false, faltando: "GP do projeto designado" });
    await db.usuario.update({ where: { id: s.pedro.id }, data: { ativo: true } });
    expect(await moverCard(id, s.f("em_execucao"), s.ana)).toMatchObject({ ok: true, mudou: true });
    expect((await lerCard(id)).fase.marco).toBe("EXECUCAO");
  });

  it("não dá para pular: subfase depois de Execução e Finalizado também travam; a subfase antes não", async () => {
    const id = await s.emHandoff();
    expect(await moverCard(id, s.f("conclusao"), s.gil)).toMatchObject({ ok: false, erro: "HANDOFF_INCOMPLETO" });
    expect(await moverCard(id, s.f("finalizado"), s.gil, { dadosTerminal: {} })).toMatchObject({ ok: false, erro: "HANDOFF_INCOMPLETO" });
    expect(await moverCard(id, s.f("preparacao"), s.ana)).toMatchObject({ ok: true });
    expect(await moverCard(id, s.f("em_execucao"), s.ana)).toMatchObject({ ok: false, erro: "HANDOFF_INCOMPLETO" });
  });

  it("fase de ganho criada pela Gestão antes de Execução não é atalho", async () => {
    const id = await s.emHandoff();
    await db.fase.update({ where: { id: s.f("preparacao") }, data: { isTerminal: true, tipoTerminal: "GANHO" } });
    expect(await moverCard(id, s.f("preparacao"), s.gil, { dadosTerminal: {} })).toMatchObject({ ok: false, erro: "HANDOFF_INCOMPLETO" });
  });

  it("card novo não nasce em Execução (tela e MCP), mas nasce em Handoff", async () => {
    expect(await criarCard({ pipelineId: s.projetos.id, faseId: s.f("em_execucao"), titulo: "X" }, s.gil)).toEqual({ ok: false, erro: "HANDOFF_INCOMPLETO" });
    expect(await criarCard({ pipelineId: s.projetos.id, faseId: s.f("handoff"), titulo: "X" }, s.gil)).toMatchObject({ ok: true });
  });

  it("cards migrados/isentos não são afetados: em Handoff passam, em execução andam livres", async () => {
    const id = await s.emHandoff();
    await db.projeto.update({ where: { id }, data: { isentoTravaHandoff: true } });
    expect(await moverCard(id, s.f("em_execucao"), s.ana)).toMatchObject({ ok: true, mudou: true });
    expect(await moverCard(id, s.f("conclusao"), s.ana)).toMatchObject({ ok: true, mudou: true });
    expect(await moverCard(id, s.f("handoff"), s.ana)).toMatchObject({ ok: true, mudou: true });
    expect(await moverParaExecucao(id, s.ana)).toMatchObject({ ok: true, mudou: true });
  });

  it("a trava só olha a entrada: quem já está em Execução anda livre mesmo sem o PDF; voltar a Handoff exige fechar de novo", async () => {
    const id = await s.emHandoff();
    await s.completar(id);
    expect(await moverParaExecucao(id, s.ana)).toMatchObject({ ok: true, mudou: true });
    const anexo = await db.anexo.findFirstOrThrow({ where: { projetoId: id, contratoAssinado: true } });
    await excluirAnexo(anexo.id, s.ana);
    expect(await moverCard(id, s.f("conclusao"), s.ana)).toMatchObject({ ok: true, mudou: true });
    expect(await moverCard(id, s.f("handoff"), s.ana)).toMatchObject({ ok: true, mudou: true });
    expect(await moverCard(id, s.f("em_execucao"), s.ana)).toMatchObject({ ok: false, faltando: "PDF do contrato assinado" });
  });

  it("moverParaExecucao devolve o texto com o que falta, e card fora do quadro é recusado", async () => {
    const id = await s.emHandoff();
    const r = await moverParaExecucao(id, s.gil);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.erro).toContain("Falta: GP do projeto designado");
    expect(await moverParaExecucao(await s.novo("Outro"), s.ana)).toMatchObject({ ok: false });
  });
});

describe("caminhos laterais", () => {
  /** A subfase Preparação passa para depois de Execução, como faria a Gestão com o card na lixeira. */
  const cruzarPreparacao = async () => {
    await db.fase.update({ where: { id: s.f("preparacao") }, data: { ordem: 3 } });
    await db.fase.update({ where: { id: s.f("conclusao") }, data: { ordem: 1 } });
  };

  it("lixeira: subfase reordenada para depois de Execução com o card na lixeira não fura a trava", async () => {
    const id = await s.emHandoff();
    await moverCard(id, s.f("preparacao"), s.ana);
    await excluirCard(id, s.ana);
    await cruzarPreparacao();
    expect(await restaurarCard(id, s.gil)).toEqual({ ok: false, erro: "HANDOFF_INCOMPLETO" });
    await db.fase.update({ where: { id: s.f("preparacao") }, data: { ordem: 1 } });
    await db.fase.update({ where: { id: s.f("conclusao") }, data: { ordem: 3 } });
    expect(await restaurarCard(id, s.gil)).toMatchObject({ ok: true });
  });

  it("lixeira: quem estava além de Execução volta, mesmo tendo entrado direto por uma subfase e sem o PDF", async () => {
    const id = await s.emHandoff();
    await s.completar(id);
    expect(await moverCard(id, s.f("conclusao"), s.ana)).toMatchObject({ ok: true, mudou: true }); // nunca passou pelo marco
    await excluirAnexo((await db.anexo.findFirstOrThrow({ where: { projetoId: id, contratoAssinado: true } })).id, s.ana);
    await excluirCard(id, s.ana);
    expect(await restaurarCard(id, s.gil)).toMatchObject({ ok: true, faseId: s.f("conclusao") });
  });

  it("lixeira: já ter passado pelo marco não libera; vale onde o card estava ao ser excluído", async () => {
    const id = await s.emHandoff();
    await s.completar(id);
    await moverParaExecucao(id, s.ana);
    await moverCard(id, s.f("preparacao"), s.ana); // voltou
    await marcarItemHandoff(id, "kickoff", false, s.ana);
    await excluirCard(id, s.ana);
    await cruzarPreparacao();
    expect(await restaurarCard(id, s.gil)).toEqual({ ok: false, erro: "HANDOFF_INCOMPLETO" });
  });

  it("lixeira: fase arquivada, com destino escolhido: só trava o que cruza Execução", async () => {
    const antes = await s.emHandoff("Antes");
    await moverCard(antes, s.f("preparacao"), s.ana);
    await excluirCard(antes, s.ana);
    await db.fase.update({ where: { id: s.f("preparacao") }, data: { arquivadaEm: new Date() } });
    expect(await restaurarCard(antes, s.gil, { faseId: s.f("em_execucao") })).toEqual({ ok: false, erro: "HANDOFF_INCOMPLETO" });
    expect(await restaurarCard(antes, s.gil, { faseId: s.f("handoff") })).toMatchObject({ ok: true });

    const depois = await s.emHandoff("Depois");
    await s.completar(depois);
    await moverCard(depois, s.f("conclusao"), s.ana);
    await excluirAnexo((await db.anexo.findFirstOrThrow({ where: { projetoId: depois, contratoAssinado: true } })).id, s.ana);
    await excluirCard(depois, s.ana);
    await db.fase.update({ where: { id: s.f("conclusao") }, data: { arquivadaEm: new Date() } });
    expect(await restaurarCard(depois, s.gil, { faseId: s.f("em_execucao") })).toMatchObject({ ok: true });
  });

  it("fases: reordenar não leva para depois de Execução subfase com handoff pendente", async () => {
    const id = await s.emHandoff();
    await moverCard(id, s.f("preparacao"), s.ana);
    expect(await moverFase(s.f("preparacao"), "DESCER")).toEqual({ ok: false, erro: "FASE_CRUZA_EXECUCAO" });
    const ordem = ["handoff", "em_execucao", "preparacao", "conclusao", "finalizado", "perdido_projeto"].map(s.f);
    expect(await reordenarFases(s.projetos.id, ordem)).toEqual({ ok: false, erro: "FASE_CRUZA_EXECUCAO" });
    await db.projeto.update({ where: { id }, data: { isentoTravaHandoff: true } });
    expect(await reordenarFases(s.projetos.id, ordem)).toEqual({ ok: true });
  });

  it("fases: remover com migração não leva para Execução ou depois quem tem handoff pendente", async () => {
    const id = await s.emHandoff();
    await moverCard(id, s.f("preparacao"), s.ana);
    expect(await removerFase(s.f("preparacao"), { destinoFaseId: s.f("em_execucao") }, s.gil)).toEqual({ ok: false, erro: "DESTINO_EXIGE_HANDOFF" });
    expect(await removerFase(s.f("preparacao"), { destinoFaseId: s.f("conclusao") }, s.gil)).toEqual({ ok: false, erro: "DESTINO_EXIGE_HANDOFF" });
    expect(await removerFase(s.f("preparacao"), { destinoFaseId: s.f("handoff") }, s.gil)).toMatchObject({ ok: true });
  });

  it("fases: card com handoff fechado pode ser migrado", async () => {
    const id = await s.emHandoff();
    await s.completar(id);
    await moverCard(id, s.f("preparacao"), s.ana);
    expect(await removerFase(s.f("preparacao"), { destinoFaseId: s.f("em_execucao") }, s.gil)).toMatchObject({ ok: true });
  });
});

describe("GP do projeto", () => {
  it("o GP de projetos designa: a pessoa vira responsável, com Timeline e aviso", async () => {
    const id = await s.emHandoff();
    expect(await designarGpDoProjeto(id, s.pedro.id, s.paula)).toEqual({ ok: true, mudou: true });
    const c = await lerCard(id);
    expect(c.responsavelId).toBe(s.pedro.id);
    expect(c.vendedorId).toBe(s.ana.id); // o ranking continua creditando quem ganhou
    expect((await obterHandoff(id))?.gp?.nome).toBe("Pedro");
    const avisos = await db.aviso.findMany();
    expect(avisos.map((a) => [a.usuarioId, a.tipo, a.whatsapp])).toEqual([[s.pedro.id, "HANDOFF", "SAFE_MODE"]]);
    const tl = await db.timeline.findMany({ where: { projetoId: id }, orderBy: { em: "desc" }, take: 2 });
    expect(tl[0]).toMatchObject({ tipo: "HANDOFF", payload: { evento: "gp_designado", gpId: s.pedro.id, gpNome: "Pedro" } });
    expect(tl[1]).toMatchObject({ tipo: "CAMPO_ALTERADO", payload: { campo: "responsavelId", antes: s.ana.id, depois: s.pedro.id } });
  });

  it("designar a mesma pessoa não duplica nada; se o responsável mudou depois, ela volta", async () => {
    const id = await s.emHandoff();
    await designarGpDoProjeto(id, s.pedro.id, s.paula);
    expect(await designarGpDoProjeto(id, s.pedro.id, s.paula)).toEqual({ ok: true, mudou: false });
    expect(await db.aviso.count()).toBe(1);
    await editarCard(id, { responsavelId: s.ana.id }, s.gil);
    expect(await designarGpDoProjeto(id, s.pedro.id, s.paula)).toEqual({ ok: true, mudou: true });
    expect((await lerCard(id)).responsavelId).toBe(s.pedro.id);
  });

  it("GP que designa a si mesmo não recebe aviso", async () => {
    const id = await s.emHandoff();
    expect(await designarGpDoProjeto(id, s.paula.id, s.paula)).toEqual({ ok: true, mudou: true });
    expect(await db.aviso.count()).toBe(0);
  });

  it("só o GP de projetos designa: nem gestor, nem GP de vendas, nem projetos sem cargo", async () => {
    const id = await s.emHandoff();
    for (const quem of [s.gil, s.gpVendas, s.pedro, s.ana, s.vera]) {
      expect(await designarGpDoProjeto(id, s.pedro.id, quem)).toEqual({ ok: false, erro: "SO_GP_DE_PROJETOS" });
    }
  });

  it("gestor com o lado projetos e o cargo GP designa", async () => {
    const id = await s.emHandoff();
    const dir = await db.usuario.create({ data: { nome: "Dora", email: "dora@ij.test", papel: "GESTOR", area: "PROJETOS", cargos: ["GP"] } });
    expect(await designarGpDoProjeto(id, s.pedro.id, dir)).toMatchObject({ ok: true });
  });

  it("o PM (cargo novo) designa; PO e Diretor não: nenhuma permissão nova", async () => {
    const id = await s.emHandoff();
    const pm = await db.usuario.create({ data: { nome: "Mia", email: "mia@ij.test", papel: "PROJETOS", area: "PROJETOS", cargos: ["PM"] } });
    const po = await db.usuario.create({ data: { nome: "Olga", email: "olga@ij.test", papel: "PROJETOS", area: "PROJETOS", cargos: ["PO"] } });
    const dir = await db.usuario.create({ data: { nome: "Dora", email: "dora@ij.test", papel: "GESTOR", area: "PROJETOS", cargos: ["DIRETOR"] } });
    expect(await designarGpDoProjeto(id, s.pedro.id, po)).toEqual({ ok: false, erro: "SO_GP_DE_PROJETOS" });
    expect(await designarGpDoProjeto(id, s.pedro.id, dir)).toEqual({ ok: false, erro: "SO_GP_DE_PROJETOS" });
    expect(await designarGpDoProjeto(id, po.id, pm)).toMatchObject({ ok: true, mudou: true });
  });

  it("GP gravado que diverge do responsável segura a trava; designar de novo corrige, sem reavisar", async () => {
    const id = await s.emHandoff();
    await s.completar(id);
    await editarCard(id, { responsavelId: s.ana.id }, s.gil);
    expect((await obterHandoff(id))?.responsavelDiverge).toBe(true);
    const r = await moverCard(id, s.f("em_execucao"), s.gil);
    expect(!r.ok && r.faltando).toContain("GP do projeto como responsável");
    await db.aviso.deleteMany();
    expect(await designarGpDoProjeto(id, s.pedro.id, s.paula)).toEqual({ ok: true, mudou: true });
    expect(await db.aviso.count()).toBe(0);
    expect(await moverCard(id, s.f("em_execucao"), s.ana)).toMatchObject({ ok: true, mudou: true });
  });

  it("GP que mudou de área ou virou visualizador conta como pendência", async () => {
    const id = await s.emHandoff();
    await s.completar(id);
    for (const data of [{ papel: "VENDEDOR", area: "VENDAS" }, { papel: "VISUALIZADOR", area: null }, { papel: "GESTOR", area: null }] as const) {
      await db.usuario.update({ where: { id: s.pedro.id }, data });
      expect(await moverCard(id, s.f("em_execucao"), s.ana)).toMatchObject({ ok: false, faltando: "GP do projeto designado" });
      expect((await obterHandoff(id))?.gpValido).toBe(false);
    }
    await db.usuario.update({ where: { id: s.pedro.id }, data: { papel: "GESTOR", area: "PROJETOS" } });
    expect(await moverCard(id, s.f("em_execucao"), s.ana)).toMatchObject({ ok: true, mudou: true });
  });

  it("o designado precisa ser pessoa ativa de projetos", async () => {
    const id = await s.emHandoff();
    for (const alvo of [s.ana, s.gil, s.vera, s.inativo]) expect(await designarGpDoProjeto(id, alvo.id, s.paula)).toEqual({ ok: false, erro: "GP_INVALIDO" });
    expect(await designarGpDoProjeto(id, "nao-existe", s.paula)).toEqual({ ok: false, erro: "GP_INVALIDO" });
    expect((await listarCandidatosGp()).map((c) => c.nome)).toEqual(["Paula", "Pedro"]);
  });

  it("candidatos: POs primeiro, depois PMs, depois o resto do time, cada grupo por nome (só ordem; todos valem)", async () => {
    await db.usuario.create({ data: { nome: "Zoe", email: "zoe@ij.test", papel: "PROJETOS", area: "PROJETOS", cargos: ["PO"] } });
    await db.usuario.create({ data: { nome: "Beto", email: "beto@ij.test", papel: "PROJETOS", area: "PROJETOS" } });
    await db.usuario.create({ data: { nome: "Yan", email: "yan@ij.test", papel: "PROJETOS", area: "PROJETOS", cargos: ["PM", "PO"] } });
    // Paula tem GP legado em Projetos (= PM); Pedro e Beto não têm cargo.
    expect((await listarCandidatosGp()).map((c) => c.nome)).toEqual(["Yan", "Zoe", "Paula", "Beto", "Pedro"]);
  });
});

describe("checklist e resumo", () => {
  it("itens: quem escreve marca e desmarca, com Timeline; visualizador não", async () => {
    const id = await s.emHandoff();
    expect(await marcarItemHandoff(id, "contatos", true, s.vera)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await marcarItemHandoff(id, "contatos", true, s.pedro)).toEqual({ ok: true, mudou: true });
    expect(await marcarItemHandoff(id, "contatos", true, s.ana)).toEqual({ ok: true, mudou: false });
    expect((await obterHandoff(id))?.itens.contatos).toBeInstanceOf(Date);
    expect(await marcarItemHandoff(id, "contatos", false, s.gil)).toEqual({ ok: true, mudou: true });
    expect((await obterHandoff(id))?.itens.contatos).toBeNull();
    const eventos = await db.timeline.findMany({ where: { projetoId: id, tipo: "HANDOFF" }, orderBy: { em: "asc" } });
    expect(eventos.map((e) => e.payload)).toEqual([
      { evento: "item_marcado", item: "contatos" },
      { evento: "item_desmarcado", item: "contatos" },
    ]);
  });

  it("resumo: só vendas escreve; parte ausente fica, e a Timeline não copia o texto", async () => {
    const id = await s.emHandoff();
    for (const quem of [s.pedro, s.paula, s.gil, s.vera]) expect(await salvarResumoHandoff(id, RESUMO, quem)).toEqual({ ok: false, erro: "SO_VENDAS_ESCREVE_RESUMO" });
    expect(await salvarResumoHandoff(id, { contexto: "  Só o contexto " }, s.ana)).toEqual({ ok: true, mudou: true });
    expect(await salvarResumoHandoff(id, { riscos: "Prazo" }, s.gpVendas)).toEqual({ ok: true, mudou: true });
    expect(await salvarResumoHandoff(id, { riscos: "Prazo" }, s.ana)).toEqual({ ok: true, mudou: false });
    const h = await obterHandoff(id);
    expect(h?.resumo).toEqual({ contexto: "Só o contexto", combinados: "", riscos: "Prazo", valoriza: "" });
    expect(h?.resumoPor).toBe("Gabi");
    const t = await db.timeline.findFirstOrThrow({ where: { projetoId: id, tipo: "HANDOFF" }, orderBy: { em: "desc" } });
    expect(t.payload).toEqual({ evento: "resumo_salvo", partes: ["riscos"] });
  });

  it("resumo longo é recusado", async () => {
    const id = await s.emHandoff();
    expect(await salvarResumoHandoff(id, { contexto: "x".repeat(5001) }, s.ana)).toEqual({ ok: false, erro: "RESUMO_LONGO" });
  });

  it("GAB-95: trocar o GP vale também em Execução e subfase depois dela, com a mesma permissão e o aviso", async () => {
    const id = await s.emHandoff();
    await s.completar(id);
    await moverParaExecucao(id, s.ana);
    await db.aviso.deleteMany();
    expect(await designarGpDoProjeto(id, s.paula.id, s.pedro)).toEqual({ ok: false, erro: "SO_GP_DE_PROJETOS" });
    expect(await designarGpDoProjeto(id, s.paula.id, s.gil)).toEqual({ ok: false, erro: "SO_GP_DE_PROJETOS" });
    expect(await designarGpDoProjeto(id, s.ana.id, s.paula)).toEqual({ ok: false, erro: "GP_INVALIDO" });
    expect(await designarGpDoProjeto(id, s.paula.id, s.paula)).toEqual({ ok: true, mudou: true });
    expect((await db.projeto.findUniqueOrThrow({ where: { id } })).responsavelId).toBe(s.paula.id);
    await moverCard(id, s.f("conclusao"), s.paula);
    expect(await designarGpDoProjeto(id, s.pedro.id, s.paula)).toEqual({ ok: true, mudou: true });
    expect((await db.aviso.findMany({ where: { tipo: "HANDOFF", projetoId: id } })).map((a) => a.usuarioId)).toEqual([s.pedro.id]);
    // Pedro saiu na troca feita por Paula: avisado, só no app. Paula saiu trocando ela mesma: sem aviso.
    const trocados = await db.aviso.findMany({ where: { tipo: "GP_TROCADO", projetoId: id } });
    expect(trocados.map((a) => [a.usuarioId, a.whatsapp])).toEqual([[s.pedro.id, null]]);
    expect(trocados[0].titulo).toContain("Paula");
    await moverCard(id, s.f("finalizado"), s.paula);
    expect(await designarGpDoProjeto(id, s.paula.id, s.paula)).toEqual({ ok: false, erro: "HANDOFF_ENCERRADO" });
    const venda = await s.novo("Venda");
    expect(await designarGpDoProjeto(venda, s.pedro.id, s.paula)).toEqual({ ok: false, erro: "HANDOFF_ENCERRADO" });
  });

  it("fora da coluna Handoff não edita: em Vendas, em Execução e em card na lixeira", async () => {
    const naVenda = await s.novo("Venda");
    expect(await marcarItemHandoff(naVenda, "contatos", true, s.ana)).toEqual({ ok: false, erro: "HANDOFF_ENCERRADO" });
    expect(await obterHandoff(naVenda)).toBeNull();
    const id = await s.emHandoff();
    await s.completar(id);
    await moverParaExecucao(id, s.ana);
    expect(await obterHandoff(id)).toMatchObject({ emHandoff: false, completo: true });
    expect(await salvarResumoHandoff(id, { riscos: "outro" }, s.ana)).toEqual({ ok: false, erro: "HANDOFF_ENCERRADO" });
    expect(await marcarItemHandoff(id, "kickoff", false, s.ana)).toEqual({ ok: false, erro: "HANDOFF_ENCERRADO" });
    expect(await anexarContratoNoHandoff(id, PDF(), s.ana)).toEqual({ ok: false, erro: "HANDOFF_ENCERRADO" });
    const outro = await s.emHandoff("Outro");
    await excluirCard(outro, s.ana);
    expect(await marcarItemHandoff(outro, "kickoff", true, s.ana)).toEqual({ ok: false, erro: "CARD_NAO_ENCONTRADO" });
  });
});

describe("proposta congelada", () => {
  it("automática: item feito com a proposta aceita e nenhuma escrita a muda", async () => {
    const id = await s.emHandoff();
    const h = await obterHandoff(id);
    expect(h?.proposta).toEqual({ congelada: true, dispensada: false, versao: 2 });
    expect(await salvarRascunho(id, { revisao: 0, conteudo: { markdown: "novo" } }, s.ana)).toEqual({ ok: false, erro: "PROPOSTA_CONGELADA" });
  });

  it("card isento que chegou a Ganho sem aceite: item dispensado, e a proposta em andamento congela também", async () => {
    const id = await s.novo();
    await db.projeto.update({ where: { id }, data: { isentoTravaContrato: true } });
    await db.proposta.create({ data: { projetoId: id, status: "RASCUNHO", criadoPorId: s.ana.id, canetaComId: s.ana.id, canetaLado: "VENDAS" } });
    await moverCard(id, s.f("contrato_assinado"), s.ana, { dadosTerminal: { valorFechado: "" } });
    const h = await obterHandoff(id);
    expect(h?.proposta).toEqual({ congelada: false, dispensada: true, versao: null });
    expect(h?.pendencias).not.toContain("PROPOSTA");
    expect(await salvarRascunho(id, { revisao: 0, conteudo: { markdown: "novo" } }, s.ana)).toEqual({ ok: false, erro: "PROPOSTA_CONGELADA" });
  });

  it("card criado direto em Projetos, sem ganho: não fica preso no item", async () => {
    const r = await criarCard({ pipelineId: s.projetos.id, faseId: s.f("handoff"), titulo: "Direto" }, s.gil);
    if (!r.ok) throw new Error(r.erro);
    expect((await obterHandoff(r.id))?.pendencias).not.toContain("PROPOSTA");
  });
});

describe("PDF do contrato assinado", () => {
  /** Em Montando contrato, pronto para marcar como assinado. */
  const emMontando = async () => {
    const id = await s.novo();
    await db.proposta.create({ data: { projetoId: id, status: "ACEITA", criadoPorId: s.ana.id } });
    await moverCard(id, s.f("montando_contrato"), s.ana);
    return id;
  };

  it("o botão Contrato assinado com PDF cumpre o item", async () => {
    const id = await emMontando();
    const r = await marcarContratoAssinado(id, { valorFechado: "", arquivo: PDF() }, s.ana);
    expect(r).toMatchObject({ ok: true });
    const h = await obterHandoff(id);
    expect(h?.contrato?.nome).toBe("contrato.pdf");
    expect(h?.pendencias).not.toContain("CONTRATO");
  });

  it("PDF já anexado (duplicado) pelo botão passa a ser o contrato, com Timeline", async () => {
    const id = await emMontando();
    const arq = PDF();
    await anexarArquivo(id, arq, s.ana);
    expect(await marcarContratoAssinado(id, { valorFechado: "", arquivo: arq }, s.ana)).toMatchObject({ ok: true, anexo: null });
    expect((await obterHandoff(id))?.contrato?.nome).toBe("contrato.pdf");
    expect(await db.timeline.findFirst({ where: { projetoId: id, tipo: "HANDOFF" } })).toMatchObject({ payload: { evento: "contrato_definido" } });
  });

  it("sem falso positivo: anexo comum, mesmo chamado contrato, não conta", async () => {
    const id = await s.emHandoff();
    await anexarArquivo(id, { nome: "Contrato assinado.pdf", bytes: pdfDeTexto(["qualquer"]) }, s.ana);
    expect((await obterHandoff(id))?.pendencias).toContain("CONTRATO");
  });

  it("quem chegou sem o botão cumpre depois, enviando o arquivo ou apontando um PDF; imagem não serve", async () => {
    const id = await s.emHandoff();
    expect(await anexarContratoNoHandoff(id, { nome: "foto.png", bytes: PNG }, s.ana)).toEqual({ ok: false, erro: "CONTRATO_NAO_E_PDF" });
    expect(await anexarContratoNoHandoff(id, PDF(), s.vera)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await anexarContratoNoHandoff(id, PDF(), s.ana)).toMatchObject({ ok: true });
    const primeiro = (await obterHandoff(id))?.contrato?.id;
    expect(primeiro).toBeTruthy();

    const outro = await anexarArquivo(id, { nome: "assinado-final.pdf", bytes: pdfDeTexto(["final"]) }, s.ana);
    if (!outro.ok) throw new Error(outro.erro);
    expect(await definirContratoNoHandoff(id, outro.anexo.id, s.pedro)).toEqual({ ok: true, mudou: true });
    expect((await obterHandoff(id))?.contrato).toEqual({ id: outro.anexo.id, nome: "assinado-final.pdf" });
    // Um só marcado, e o anterior não volta a contar.
    expect(await db.anexo.count({ where: { projetoId: id, contratoAssinado: true } })).toBe(1);

    const img = await anexarArquivo(id, { nome: "foto.png", bytes: PNG }, s.ana);
    if (!img.ok) throw new Error(img.erro);
    expect(await definirContratoNoHandoff(id, img.anexo.id, s.ana)).toEqual({ ok: false, erro: "CONTRATO_NAO_E_PDF" });
    expect(await definirContratoNoHandoff(id, "nao-existe", s.ana)).toEqual({ ok: false, erro: "ANEXO_NAO_ENCONTRADO" });
    const deOutroCard = await s.emHandoff("Outro");
    expect(await definirContratoNoHandoff(deOutroCard, outro.anexo.id, s.ana)).toEqual({ ok: false, erro: "ANEXO_NAO_ENCONTRADO" });
  });

  it("o banco recusa dois contratos vivos no mesmo Projeto; um contrato na lixeira não conta", async () => {
    const id = await s.emHandoff();
    const a = await anexarArquivo(id, { nome: "a.pdf", bytes: pdfDeTexto(["a"]) }, s.ana);
    const b = await anexarArquivo(id, { nome: "b.pdf", bytes: pdfDeTexto(["b"]) }, s.ana);
    if (!a.ok || !b.ok) throw new Error("seed");
    await db.anexo.update({ where: { id: a.anexo.id }, data: { contratoAssinado: true } });
    await expect(db.anexo.update({ where: { id: b.anexo.id }, data: { contratoAssinado: true } })).rejects.toMatchObject({ code: "P2002" });
    await db.anexo.update({ where: { id: a.anexo.id }, data: { deletadoEm: new Date() } });
    await expect(db.anexo.update({ where: { id: b.anexo.id }, data: { contratoAssinado: true } })).resolves.toBeTruthy();
  });

  it("corrida: dois envios ao mesmo tempo não falham e sobra um contrato só", async () => {
    const id = await s.emHandoff();
    const rs = await Promise.all([anexarContratoNoHandoff(id, PDF(), s.ana), anexarContratoNoHandoff(id, PDF(), s.pedro)]);
    expect(rs).toMatchObject([{ ok: true }, { ok: true }]);
    expect(await db.anexo.count({ where: { projetoId: id } })).toBe(2);
    expect(await db.anexo.count({ where: { projetoId: id, contratoAssinado: true } })).toBe(1);
  });

  it("corrida: card que entrou em Execução enquanto o PDF era lido não troca de contrato (arquivo novo ou já anexado)", async () => {
    const id = await s.emHandoff();
    await s.completar(id);
    const contrato = (await obterHandoff(id))?.contrato?.id;
    const comum = { nome: "comum.pdf", bytes: pdfDeTexto(["comum"]) };
    await anexarArquivo(id, comum, s.ana);
    await moverParaExecucao(id, s.ana);
    const total = await db.anexo.count({ where: { projetoId: id } });
    // Direto na porta que faz a troca: a conferência de antes da leitura já passou.
    expect(await anexarPdfDoContrato(id, PDF(), s.ana)).toEqual({ ok: false, erro: "HANDOFF_ENCERRADO" });
    expect(await anexarPdfDoContrato(id, comum, s.ana)).toEqual({ ok: false, erro: "HANDOFF_ENCERRADO" });
    expect(await db.anexo.count({ where: { projetoId: id } })).toBe(total);
    expect((await obterHandoff(id))?.contrato?.id).toBe(contrato);
  });

  it("card isento também cumpre anexando depois", async () => {
    const id = await s.novo();
    await db.projeto.update({ where: { id }, data: { isentoTravaContrato: true } });
    await moverCard(id, s.f("contrato_assinado"), s.ana, { dadosTerminal: { valorFechado: "" } });
    expect((await obterHandoff(id))?.pendencias).toContain("CONTRATO");
    expect(await anexarContratoNoHandoff(id, PDF(), s.ana)).toMatchObject({ ok: true });
    expect((await obterHandoff(id))?.pendencias).not.toContain("CONTRATO");
  });
});

describe("Perdido no quadro Projetos", () => {
  const perder = (id: string, por: { id: string; papel: Papel }, dados: { motivo?: string; detalhe?: string } = { motivo: "preco" }) => moverCard(id, s.f("perdido_projeto"), por, { dadosTerminal: dados });

  it("Handoff → Perdido não passa pela trava e pede motivo; reabrir volta a Handoff com o que já tinha, e Execução segue travada", async () => {
    const id = await s.emHandoff();
    await marcarItemHandoff(id, "contatos", true, s.ana);
    expect(await perder(id, s.ana, {})).toMatchObject({ ok: false, erro: "MOTIVO_PERDA_OBRIGATORIO" });
    expect(await perder(id, s.ana)).toMatchObject({ ok: true, mudou: true, terminal: "PERDIDO" });
    const c = await lerCard(id);
    expect(c.motivoPerda).toBeTruthy();
    expect(c.fase.tipoTerminal).toBe("PERDIDO");
    expect((await obterHandoff(id))?.emHandoff).toBe(false);
    expect(await marcarItemHandoff(id, "kickoff", true, s.ana)).toEqual({ ok: false, erro: "HANDOFF_ENCERRADO" });

    expect(await moverCard(id, s.f("em_execucao"), s.gil)).toMatchObject({ ok: false, erro: "HANDOFF_INCOMPLETO" });
    expect(await moverCard(id, s.f("finalizado"), s.gil, { dadosTerminal: {} })).toMatchObject({ ok: false, erro: "HANDOFF_INCOMPLETO" });
    expect(await moverCard(id, s.f("handoff"), s.ana)).toMatchObject({ ok: true, mudou: true });
    const h = await obterHandoff(id);
    expect(h?.emHandoff).toBe(true);
    expect(h?.itens.contatos).toBeInstanceOf(Date);
  });

  it("perdido a partir de Execução pode reabrir direto em Execução, sem o PDF", async () => {
    const id = await s.emHandoff();
    await s.completar(id);
    await moverParaExecucao(id, s.ana);
    await excluirAnexo((await db.anexo.findFirstOrThrow({ where: { projetoId: id, contratoAssinado: true } })).id, s.ana);
    await perder(id, s.ana);
    expect(await moverCard(id, s.f("em_execucao"), s.ana)).toMatchObject({ ok: true, mudou: true });
  });

  it("reabrir em Projetos não mexe na proposta congelada", async () => {
    const id = await s.novo();
    await db.projeto.update({ where: { id }, data: { isentoTravaContrato: true } });
    await db.proposta.create({ data: { projetoId: id, status: "RECUSADA", criadoPorId: s.ana.id } });
    await moverCard(id, s.f("contrato_assinado"), s.ana, { dadosTerminal: { valorFechado: "" } });
    await perder(id, s.ana);
    await moverCard(id, s.f("handoff"), s.ana);
    expect((await db.proposta.findUniqueOrThrow({ where: { projetoId: id } })).status).toBe("RECUSADA");
  });

  it("não distorce vendas: o ganho continua no ranking, sem perda, e o fluxo do painel não conta nada", async () => {
    const inicio = new Date(Date.now() - 3_600_000);
    const fim = new Date(Date.now() + 3_600_000);
    const id = await s.emHandoff();
    const antes = await carregarFluxo({ inicio, fim });
    await perder(id, s.ana);
    const r = await carregarDados({ inicio, fim });
    expect(r.ganhos.map((g) => [g.projetoId, g.responsavelId])).toEqual([[id, s.ana.id]]);
    expect(r.perdas).toEqual([]);
    expect(r.abertos).toEqual([]);
    expect(await carregarFluxo({ inicio, fim })).toEqual(antes);
    expect((await carregarFluxo({ inicio, fim })).every((l) => l.perdas === 0)).toBe(true);
  });

  it("Kanban mostra a coluna no quadro Projetos, com o card", async () => {
    const id = await s.emHandoff();
    await perder(id, s.ana);
    const q = await listarQuadro("projetos");
    expect(q?.fases.find((f) => f.id === s.f("perdido_projeto"))?.isTerminal).toBe(true);
    expect(q?.cards.find((c) => c.id === id)?.faseId).toBe(s.f("perdido_projeto"));
  });

  it("a Gestão não remove a última fase de perdido do quadro", async () => {
    expect(await removerFase(s.f("perdido_projeto"), {}, s.gil)).toEqual({ ok: false, erro: "TERMINAL_PERDIDO_OBRIGATORIO" });
  });
});

describe("migration 20261104150000_handoff", () => {
  const SQL = readFileSync(path.resolve(import.meta.dirname, "../../../prisma/migrations/20261104150000_handoff/migration.sql"), "utf8");
  const criarPerdido = () => db.$executeRawUnsafe(SQL.slice(SQL.indexOf("DO $$"), SQL.indexOf("-- GAB-93-PERDIDO-FIM")));
  const perdidas = () => db.fase.findMany({ where: { pipelineId: s.projetos.id, tipoTerminal: "PERDIDO" }, orderBy: { criadoEm: "asc" } });

  it("Perdido: cria quando não há; é idempotente", async () => {
    await db.fase.delete({ where: { id: s.f("perdido_projeto") } });
    await criarPerdido();
    await criarPerdido();
    const fs = await perdidas();
    expect(fs).toHaveLength(1);
    expect(fs[0]).toMatchObject({ chave: "perdido", nome: "Perdido", isTerminal: true, marco: null, arquivadaEm: null, ordem: 5 });
  });

  it("Perdido: respeita a que a Gestão já criou", async () => {
    await criarPerdido();
    expect((await perdidas()).map((f) => f.chave)).toEqual(["perdido_projeto"]);
  });

  it("Perdido: fase arquivada ou chave ocupada não bloqueiam", async () => {
    await db.fase.update({ where: { id: s.f("perdido_projeto") }, data: { arquivadaEm: new Date(), chave: "perdido" } });
    await db.fase.create({ data: { pipelineId: s.projetos.id, chave: "perdido_2", nome: "Perdido?", ordem: 9 } });
    await criarPerdido();
    const nova = (await perdidas()).find((f) => !f.arquivadaEm);
    expect(nova).toMatchObject({ chave: "perdido_3", ordem: 10 });
  });

  it("Perdido: sem o quadro (instalação nova) não faz nada; quem cria é o seed", async () => {
    await db.pipeline.update({ where: { id: s.projetos.id }, data: { chave: "outro" } });
    await expect(criarPerdido()).resolves.toBeDefined();
    expect(await db.fase.count({ where: { pipelineId: s.projetos.id, tipoTerminal: "PERDIDO" } })).toBe(1);
  });

  it("isenta só quem está no quadro Projetos, inclusive na lixeira; Vendas continua exigindo", async () => {
    const update = SQL.slice(SQL.indexOf('UPDATE "oportunidade"'), SQL.indexOf("-- Fase Perdido no quadro Projetos"));
    const venda = await s.novo("Venda");
    const handoff = await s.emHandoff("Em handoff");
    const lixo = await s.emHandoff("Na lixeira");
    await excluirCard(lixo, s.ana);
    await db.$executeRawUnsafe(update);
    const isento = async (id: string) => (await db.projeto.findUniqueOrThrow({ where: { id } })).isentoTravaHandoff;
    expect(await isento(venda)).toBe(false);
    expect(await isento(handoff)).toBe(true);
    expect(await isento(lixo)).toBe(true);
    expect(await moverCard(handoff, s.f("em_execucao"), s.ana)).toMatchObject({ ok: true });
  });
});

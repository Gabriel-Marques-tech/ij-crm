// @vitest-environment node
// GAB-41: painel de mensagens (Gestão → WhatsApp): fila, recentes, desconhecidos, resolver e vincular.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StatusMensagem } from "@prisma/client";
import { dbTeste, limparBanco } from "@/test/db";
import { semear } from "../../../prisma/seed";
import {
  buscarCardsParaVincular,
  carregarPainel,
  listarFila,
  POR_PAGINA_FILA,
  resolverManualmente,
  vincularRemetente,
} from "./painel";

const dbT = dbTeste();
const TABELAS = ["contador_descartadas", "remetente_desconhecido", "timeline", "transicao_fase", "oportunidade", "fase", "pipeline", "mensagem_bruta", "usuario"];

let joao: { id: string };
let gestor: { id: string; papel: "GESTOR" };
let admin: { id: string };
let faseInicial: { id: string; pipelineId: string };
let seq = 0;

async function bruta(status: StatusMensagem, extra: Record<string, unknown> = {}) {
  seq++;
  return dbT.mensagemBruta.create({
    data: {
      eventoId: `EVT-P${seq}`,
      grupoJid: "g@g.us",
      texto: `#crm mensagem ${seq}`,
      recebidaEm: new Date(Date.UTC(2026, 9, 1, 12, 0, seq)),
      remetenteUsuarioId: joao.id,
      remetenteTelefone: "+5511999998888",
      status,
      ...extra,
    },
  });
}

beforeEach(async () => {
  await limparBanco(TABELAS);
  await semear(dbT, { log: () => {} });
  joao = await dbT.usuario.create({ data: { nome: "João", email: "joao@ij.test", telefoneWhatsapp: "+5511999998888" } });
  const g = await dbT.usuario.create({ data: { nome: "Gê", email: "g@ij.test", papel: "GESTOR" } });
  gestor = { id: g.id, papel: "GESTOR" };
  admin = await dbT.usuario.create({ data: { nome: "Adm", email: "a@ij.test", papel: "ADMIN" } });
  faseInicial = await dbT.fase.findFirstOrThrow({ where: { pipeline: { chave: "vendas" }, chave: "primeiro_contato" } });
});

describe("fila", () => {
  it("só FALHA e PENDENTE_REVISAO, mais recentes primeiro, paginada", async () => {
    for (let i = 0; i < POR_PAGINA_FILA + 2; i++) await bruta(i % 2 ? "FALHA" : "PENDENTE_REVISAO", { erro: "LLM HTTP ref=abc", resultadoLlm: { saida: { x: 1 } } });
    await bruta("PROCESSADA");
    await bruta("RECEBIDA");
    const p1 = await listarFila(1);
    expect(p1.total).toBe(POR_PAGINA_FILA + 2);
    expect(p1.itens).toHaveLength(POR_PAGINA_FILA);
    expect(p1.itens[0].recebidaEm.getTime()).toBeGreaterThan(p1.itens[1].recebidaEm.getTime());
    expect(p1.itens[0]).toMatchObject({ remetente: "João", texto: expect.stringContaining("#crm"), resultadoLlm: { saida: { x: 1 } } });
    expect((await listarFila(2)).itens).toHaveLength(2);
    expect((await listarFila(-5)).itens).toHaveLength(POR_PAGINA_FILA);
  });
});

describe("carregarPainel", () => {
  it("contagens, contadores do dia, desconhecidos mascarados e recentes com link do card", async () => {
    await bruta("FALHA");
    await bruta("PENDENTE_REVISAO");
    await bruta("PENDENTE_REVISAO");
    await dbT.contadorDescartadas.create({ data: { dia: new Date("2026-10-26T00:00:00Z"), total: 7, naoClassificadas: 2 } });
    await dbT.remetenteDesconhecido.create({ data: { telefone: "+5511912345678", total: 3, ultimaVez: new Date(Date.now() + 60_000) } });
    await dbT.remetenteDesconhecido.create({ data: { lid: "123456789012@lid", total: 1 } });
    const proc = await bruta("PROCESSADA");
    const op = await dbT.projeto.create({ data: { titulo: "Card X", pipelineId: faseInicial.pipelineId, faseId: faseInicial.id, responsavelId: joao.id, criadoVia: "WHATSAPP" } });
    await dbT.timeline.create({ data: { projetoId: op.id, tipo: "MENSAGEM_WHATSAPP", mensagemBrutaId: proc.id, payload: {} } });

    const p = await carregarPainel();
    expect(p.contagem).toEqual({ FALHA: 1, PENDENTE_REVISAO: 2 });
    expect(p.contadores[0]).toEqual({ dia: "2026-10-26", total: 7, naoClassificadas: 2 });
    const json = JSON.stringify(p.desconhecidos);
    expect(json).not.toContain("912345678");
    expect(json).not.toContain("123456789012");
    expect(p.desconhecidos[0]).toMatchObject({ tipo: "telefone", total: 3 });
    expect(p.desconhecidos[1]).toMatchObject({ tipo: "lid", total: 1 });
    expect(p.recentes).toHaveLength(1);
    expect(p.recentes[0]).toMatchObject({ id: proc.id, card: { id: op.id, titulo: "Card X", excluido: false } });
  });
});

describe("resolverManualmente", () => {
  it("criar card: card nasce com o vendedor como responsável, Timeline com o texto, mensagem PROCESSADA com quem resolveu", async () => {
    const m = await bruta("PENDENTE_REVISAO");
    const r = await resolverManualmente(m.id, { tipo: "CRIAR", titulo: "Gustavo — ACME", faseId: faseInicial.id }, gestor);
    if (!r.ok) throw new Error(r.erro);
    const op = await dbT.projeto.findUniqueOrThrow({ where: { id: r.projetoId } });
    expect(op).toMatchObject({ titulo: "Gustavo — ACME", responsavelId: joao.id, faseId: faseInicial.id });
    const t = await dbT.timeline.findFirstOrThrow({ where: { mensagemBrutaId: m.id } });
    expect(t).toMatchObject({ tipo: "MENSAGEM_WHATSAPP", projetoId: op.id, usuarioId: gestor.id });
    expect(t.payload).toMatchObject({ texto: m.texto, resolvidaManualmente: true });
    const depois = await dbT.mensagemBruta.findUniqueOrThrow({ where: { id: m.id } });
    expect(depois).toMatchObject({ status: "PROCESSADA", resolvidaPorId: gestor.id });
    expect(depois.resolvidaEm).toBeInstanceOf(Date);
  });

  it("vincular a card existente: não cria card", async () => {
    const m = await bruta("FALHA", { erro: "x ref=1" });
    const op = await dbT.projeto.create({ data: { titulo: "Já existe", pipelineId: faseInicial.pipelineId, faseId: faseInicial.id, responsavelId: joao.id, criadoVia: "UI" } });
    const r = await resolverManualmente(m.id, { tipo: "VINCULAR", projetoId: op.id }, gestor);
    expect(r).toEqual({ ok: true, projetoId: op.id });
    expect(await dbT.projeto.count()).toBe(1);
    expect((await dbT.mensagemBruta.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("PROCESSADA");
  });

  it("card excluído, mensagem já resolvida ou em processamento → erro de regra, nada muda", async () => {
    const op = await dbT.projeto.create({ data: { titulo: "Morto", pipelineId: faseInicial.pipelineId, faseId: faseInicial.id, responsavelId: joao.id, criadoVia: "UI", deletadoEm: new Date() } });
    const m = await bruta("PENDENTE_REVISAO");
    expect(await resolverManualmente(m.id, { tipo: "VINCULAR", projetoId: op.id }, gestor)).toEqual({ ok: false, erro: "CARD_NAO_ENCONTRADO" });
    const projeto = await dbT.fase.findFirstOrThrow({ where: { pipeline: { chave: "projetos" }, arquivadaEm: null } });
    const deProjeto = await dbT.projeto.create({ data: { titulo: "Projeto", pipelineId: projeto.pipelineId, faseId: projeto.id, responsavelId: joao.id, criadoVia: "UI" } });
    expect(await resolverManualmente(m.id, { tipo: "VINCULAR", projetoId: deProjeto.id }, gestor)).toEqual({ ok: false, erro: "CARD_NAO_ENCONTRADO" });
    const feita = await bruta("PROCESSADA");
    expect(await resolverManualmente(feita.id, { tipo: "CRIAR", titulo: "x", faseId: faseInicial.id }, gestor)).toEqual({ ok: false, erro: "MENSAGEM_JA_RESOLVIDA" });
    const andando = await bruta("PROCESSANDO");
    expect(await resolverManualmente(andando.id, { tipo: "CRIAR", titulo: "x", faseId: faseInicial.id }, gestor)).toEqual({ ok: false, erro: "MENSAGEM_EM_PROCESSAMENTO" });
    expect(await dbT.projeto.count()).toBe(2);
    expect(await dbT.timeline.count()).toBe(0);
  });

  it("dois cliques: um card só", async () => {
    const m = await bruta("PENDENTE_REVISAO");
    const rs = await Promise.all([
      resolverManualmente(m.id, { tipo: "CRIAR", titulo: "A", faseId: faseInicial.id }, gestor),
      resolverManualmente(m.id, { tipo: "CRIAR", titulo: "A", faseId: faseInicial.id }, gestor),
    ]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(await dbT.projeto.count()).toBe(1);
  });

  it("título vazio → TITULO_INVALIDO", async () => {
    const m = await bruta("PENDENTE_REVISAO");
    expect(await resolverManualmente(m.id, { tipo: "CRIAR", titulo: "  ", faseId: faseInicial.id }, gestor)).toEqual({ ok: false, erro: "TITULO_INVALIDO" });
  });
});

describe("buscarCardsParaVincular", () => {
  it("por título, só cards vivos", async () => {
    await dbT.projeto.create({ data: { titulo: "Gustavo — ACME", pipelineId: faseInicial.pipelineId, faseId: faseInicial.id, responsavelId: joao.id, criadoVia: "UI" } });
    await dbT.projeto.create({ data: { titulo: "Gustavo morto", pipelineId: faseInicial.pipelineId, faseId: faseInicial.id, responsavelId: joao.id, criadoVia: "UI", deletadoEm: new Date() } });
    const projeto = await dbT.fase.findFirstOrThrow({ where: { pipeline: { chave: "projetos" }, arquivadaEm: null } });
    await dbT.projeto.create({ data: { titulo: "Gustavo projeto", pipelineId: projeto.pipelineId, faseId: projeto.id, responsavelId: joao.id, criadoVia: "UI" } });
    const r = await buscarCardsParaVincular("gustavo");
    expect(r.map((o) => o.nome)).toEqual(["Gustavo — ACME"]); // só Vendas, como o criar
    expect(await buscarCardsParaVincular(" ")).toEqual([]);
  });
});

describe("vincularRemetente", () => {
  it("telefone → telefone_whatsapp do usuário; a linha de desconhecido some", async () => {
    const maria = await dbT.usuario.create({ data: { nome: "Maria", email: "m@ij.test" } });
    const d = await dbT.remetenteDesconhecido.create({ data: { telefone: "+5511912345678" } });
    expect(await vincularRemetente(d.id, maria.id, gestor)).toEqual({ ok: true });
    expect((await dbT.usuario.findUniqueOrThrow({ where: { id: maria.id } })).telefoneWhatsapp).toBe("+5511912345678");
    expect(await dbT.remetenteDesconhecido.count()).toBe(0);
  });

  it("LID → whatsapp_lid", async () => {
    const d = await dbT.remetenteDesconhecido.create({ data: { lid: "999@lid" } });
    expect(await vincularRemetente(d.id, joao.id, gestor)).toEqual({ ok: true });
    expect((await dbT.usuario.findUniqueOrThrow({ where: { id: joao.id } })).whatsappLid).toBe("999@lid");
  });

  it("atômico: dois vínculos concorrentes para o mesmo usuário → um vence, o outro recebe conflito", async () => {
    const maria = await dbT.usuario.create({ data: { nome: "Maria", email: "m@ij.test" } });
    const a = await dbT.remetenteDesconhecido.create({ data: { telefone: "+5511912345678" } });
    const b = await dbT.remetenteDesconhecido.create({ data: { telefone: "+5511912340000" } });
    const rs = await Promise.all([vincularRemetente(a.id, maria.id, gestor), vincularRemetente(b.id, maria.id, gestor)]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.find((r) => !r.ok)).toEqual({ ok: false, erro: "CONFLITO_CONCORRENTE" });
    const tel = (await dbT.usuario.findUniqueOrThrow({ where: { id: maria.id } })).telefoneWhatsapp;
    expect(["+5511912345678", "+5511912340000"]).toContain(tel);
    expect(await dbT.remetenteDesconhecido.count()).toBe(1);
  });

  it("usuário desativado entre a leitura e a escrita → conflito, nada gravado", async () => {
    const maria = await dbT.usuario.create({ data: { nome: "Maria", email: "m@ij.test" } });
    const d = await dbT.remetenteDesconhecido.create({ data: { lid: "777@lid" } });
    const { db } = await import("@/lib/db");
    const ler = db.usuario.findUnique.bind(db.usuario);
    const spy = vi.spyOn(db.usuario, "findUnique").mockImplementation((async (args: Parameters<typeof ler>[0]) => {
      const u = await ler(args);
      await dbT.usuario.update({ where: { id: maria.id }, data: { ativo: false } });
      return u;
    }) as never);
    try {
      expect(await vincularRemetente(d.id, maria.id, gestor)).toEqual({ ok: false, erro: "CONFLITO_CONCORRENTE" });
    } finally {
      spy.mockRestore();
    }
    expect((await dbT.usuario.findUniqueOrThrow({ where: { id: maria.id } })).whatsappLid).toBeNull();
    expect(await dbT.remetenteDesconhecido.count()).toBe(1);
  });

  it("recusa: usuário já tem outro telefone, telefone em uso, gestor mexendo em admin, inativo", async () => {
    const d = await dbT.remetenteDesconhecido.create({ data: { telefone: "+5511912345678" } });
    expect(await vincularRemetente(d.id, joao.id, gestor)).toEqual({ ok: false, erro: "USUARIO_JA_TEM_TELEFONE" });
    expect(await vincularRemetente(d.id, admin.id, gestor)).toEqual({ ok: false, erro: "PAPEL_NAO_PERMITIDO" });
    const inativo = await dbT.usuario.create({ data: { nome: "Ex", email: "ex@ij.test", ativo: false } });
    expect(await vincularRemetente(d.id, inativo.id, gestor)).toEqual({ ok: false, erro: "USUARIO_INATIVO" });
    const dup = await dbT.remetenteDesconhecido.create({ data: { telefone: "+5511999998888" } });
    const sem = await dbT.usuario.create({ data: { nome: "Sem", email: "sem@ij.test" } });
    expect(await vincularRemetente(dup.id, sem.id, gestor)).toEqual({ ok: false, erro: "IDENTIFICADOR_EM_USO" });
    expect(await vincularRemetente("nao-existe", sem.id, gestor)).toEqual({ ok: false, erro: "REMETENTE_NAO_ENCONTRADO" });
    expect(await dbT.remetenteDesconhecido.count()).toBe(2);
  });
});

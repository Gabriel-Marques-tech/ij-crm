import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { semear } from "../../../../prisma/seed";
import { decodificarArquivo } from "./csv";
import { calcularPrevia, confirmarPrevia, criarPrevia, importarConteudo, remapearPrevia } from "./servico";

const db = dbTeste();
const FIX = path.resolve(import.meta.dirname, "../../../test/fixtures/pipefy");
const CSV = decodificarArquivo(readFileSync(path.join(FIX, "export-exemplo.csv")));
const AGORA = new Date("2026-03-01T12:00:00Z");

async function preparar() {
  await semear(db, { log: () => {} });
  const admin = await db.usuario.create({ data: { nome: "Admin Import", email: "admin@ij.test", papel: "ADMIN" } });
  await db.usuario.create({ data: { nome: "Ana Souza", email: "ana@ij.test" } });
  await db.usuario.create({ data: { nome: "Bruno Lima", email: "bruno@ij.test" } });
  await db.usuario.create({ data: { nome: "Carla Dias", email: "carla.dias@ij.test" } });
  // Contato na lixeira dono do telefone do card 900009.
  await db.contato.create({
    data: { nome: "Ex-contato", deletadoEm: new Date(), pontos: { create: [{ tipo: "TELEFONE", valorNormalizado: "+5521977776666", valorOriginal: "21977776666" }] } },
  });
  return { admin };
}

const fase = async (pipeline: string, chave: string) => db.fase.findFirstOrThrow({ where: { chave, pipeline: { chave: pipeline } } });
const card = (pipefyId: string) => db.oportunidade.findUniqueOrThrow({ where: { pipefyId }, include: { fase: true, responsavel: true, empresa: true, contato: { include: { pontos: true } }, projeto: { include: { fase: true } } } });

async function contagens() {
  return {
    oportunidades: await db.oportunidade.count(),
    transicoes: await db.transicaoFase.count(),
    timeline: await db.timeline.count(),
    empresas: await db.empresa.count(),
    contatos: await db.contato.count(),
    pontos: await db.contatoPonto.count(),
  };
}

beforeEach(async () => {
  await limparBanco(["import_previa", "transicao_fase", "timeline", "oportunidade", "contato_ponto", "contato", "empresa", "fase", "pipeline", "sessao", "usuario"]);
  invalidarCachePipelines();
});

describe("prévia", () => {
  it("resume o arquivo sem gravar nada", async () => {
    const { admin } = await preparar();
    const antes = await contagens();
    const r = await criarPrevia({ conteudo: CSV, nomeArquivo: "export.csv" }, admin, AGORA);
    if (!r.ok) throw new Error(r.erro);
    const p = r.previa;
    expect(p).toMatchObject({ totalLinhas: 13, cards: 10, novos: 8, existentes: 0, duplicadas: 2, comProjeto: 3 });
    expect(p.fases.find((f) => f.chave === "backlog antigo")?.faseId).toBeNull();
    expect(p.fases.find((f) => f.chave === "em execucao")?.faseId).toBe((await fase("projetos", "em_execucao")).id);
    expect(p.erros.map((e) => [e.linha, e.mensagem])).toEqual([
      [8, 'Fase "Backlog antigo" sem correspondência no CRM (mapeie abaixo).'],
      [13, "Contato excluído na lixeira ((21) 97777-6666). Restaure ou mescle o contato e importe de novo."],
      [14, "Sem ID do card."],
    ]);
    expect(p.responsaveisSemMatch).toEqual([
      { nome: "(sem responsável)", cards: 1 },
      { nome: "Fulano Sem Cadastro", cards: 1 },
    ]);
    expect(await contagens()).toEqual(antes);
    expect(await db.importPrevia.count()).toBe(1);
  });
});

describe("confirmar", () => {
  it("cria empresas, contatos, cards, histórico e projetos; reporta erros por linha", async () => {
    const { admin } = await preparar();
    const pr = await criarPrevia({ conteudo: CSV, nomeArquivo: "export.csv" }, admin, AGORA);
    if (!pr.ok) throw new Error(pr.erro);
    const r = await confirmarPrevia(pr.token, pr.previa.hash, admin, AGORA);
    if (!r.ok) throw new Error(r.erro);
    expect(r.relatorio).toMatchObject({ total: 10, criados: 8, atualizados: 0, semMudanca: 0, pulados: 3, duplicadas: 2, projetosCriados: 3 });
    expect(r.relatorio.erros.map((e) => e.pipefyId)).toEqual(["900006", "900009", null]);

    const c1 = await card("900001");
    expect(c1).toMatchObject({ criadoVia: "IMPORT", titulo: "Site institucional Padaria Aurora", revisar: false, origem: "INDICACAO", cidade: "Campinas", estado: "SP" });
    expect(c1.fase.chave).toBe("reuniao_diagnostica");
    expect(c1.faseDesde.toISOString()).toBe("2026-01-10T17:30:00.000Z");
    expect(c1.criadoEm.toISOString()).toBe("2026-01-02T12:15:00.000Z");
    expect(c1.orcamentoPrevisto?.toFixed(2)).toBe("12000.00");
    expect(c1.responsavel.nome).toBe("Ana Souza");
    expect(c1.empresa).toMatchObject({ nome: "Padaria Aurora", cnpj: "11222333000181", dominioEmail: "padariaaurora.com.br" });
    expect(c1.contato?.nome).toBe("José Aurora");
    expect(c1.contato?.empresaId).toBe(c1.empresaId);
    expect(c1.contato?.pontos.map((p) => p.valorNormalizado).sort()).toEqual(["+5511988887777", "jose@padariaaurora.com.br"]);
    const t1 = await db.transicaoFase.findMany({ where: { oportunidadeId: c1.id }, orderBy: { em: "asc" }, include: { paraFase: true } });
    expect(t1.map((t) => [t.origem, t.deFaseId === null, t.paraFase.chave, t.em.toISOString()])).toEqual([
      ["IMPORT", true, "primeiro_contato", "2026-01-02T12:15:00.000Z"],
      ["IMPORT", false, "reuniao_diagnostica", "2026-01-10T17:30:00.000Z"],
    ]);
    const tl1 = await db.timeline.findMany({ where: { oportunidadeId: c1.id } });
    expect(tl1).toHaveLength(1);
    expect(tl1[0]).toMatchObject({ tipo: "IMPORT", usuarioId: admin.id, payload: expect.objectContaining({ acao: "criado", pipefyId: "900001" }) });

    // Contrato assinado → ganho com valor e data de entrada; projeto em em_execucao pelo gancho do GAB-32.
    const c2 = await card("900002");
    expect(c2.fase.chave).toBe("contrato_assinado");
    expect(c2.valorFechado?.toFixed(2)).toBe("45000.00");
    expect(c2.dataGanho?.toISOString()).toBe("2026-02-01T21:00:00.000Z");
    expect(c2.projeto?.fase.chave).toBe("em_execucao");
    expect(c2.projeto).toMatchObject({ titulo: c2.titulo, responsavelId: c2.responsavelId, empresaId: c2.empresaId });

    // Pipefy em "Em execução" → venda ganha + projeto, fase_desde = entrada no Pipefy.
    const c3 = await card("900003");
    expect(c3.fase.chave).toBe("contrato_assinado");
    expect(c3.dataGanho?.toISOString()).toBe("2025-11-20T19:00:00.000Z");
    expect(c3.projeto?.fase.chave).toBe("em_execucao");
    expect(c3.projeto?.faseDesde.toISOString()).toBe("2025-12-01T12:00:00.000Z");
    expect(c3.empresa).toMatchObject({ nome: "Metalúrgica Forte", cnpj: null });

    // "Finalizado" → projeto movido até o terminal de Projetos, com transições retroativas.
    const c4 = await card("900004");
    expect(c4.projeto?.fase.chave).toBe("finalizado");
    const tp4 = await db.transicaoFase.findMany({ where: { oportunidadeId: c4.projeto!.id }, orderBy: { em: "asc" }, include: { paraFase: true } });
    expect(tp4.map((t) => [t.origem, t.paraFase.chave])).toEqual([
      ["SISTEMA", "em_execucao"],
      ["IMPORT", "finalizado"],
    ]);

    // Perdido: motivo do CSV pela regra do GAB-32.
    const c5 = await card("900005");
    expect(c5).toMatchObject({ motivoPerda: "Preço: achou caro", origem: "COLD_CALL" });
    expect(c5.projeto).toBeNull();

    // Responsável sem usuário → quem importou + revisar.
    const c7 = await card("900007");
    expect(c7).toMatchObject({ responsavelId: admin.id, revisar: true });
    // Sem histórico: só fase_desde (= agora), nenhuma transição.
    const c8 = await card("900008");
    expect(c8.faseDesde.toISOString()).toBe(AGORA.toISOString());
    expect(await db.transicaoFase.count({ where: { oportunidadeId: c8.id } })).toBe(0);
    // Responsável por email.
    expect((await card("900010")).responsavel.nome).toBe("Carla Dias");
    // Email pessoal não vira domínio de empresa; sem empresa no CSV, nenhuma criada.
    expect((await card("900010")).empresaId).toBeNull();

    expect(await db.oportunidade.count({ where: { pipefyId: { in: ["900006", "900009"] } } })).toBe(0);
    expect(await db.oportunidade.count({ where: { pipeline: { chave: "projetos" } } })).toBe(3);
  });

  it("idempotente: importar 2x dá o mesmo estado e conta tudo como atualizado", async () => {
    const { admin } = await preparar();
    const r1 = await importarConteudo(CSV, undefined, admin, AGORA);
    if (!r1.ok) throw new Error(r1.erro);
    const depois1 = await contagens();
    const r2 = await importarConteudo(CSV, undefined, admin, new Date(AGORA.getTime() + 3600_000));
    if (!r2.ok) throw new Error(r2.erro);
    expect(r2.relatorio).toMatchObject({ criados: 0, atualizados: 8, semMudanca: 8, projetosCriados: 0, pulados: 3 });
    expect(await contagens()).toEqual(depois1);
  });

  it("reimport com o card em outra fase move (com transição e Timeline) e não duplica o resto", async () => {
    const { admin } = await preparar();
    await importarConteudo(CSV, undefined, admin, AGORA);
    const c1 = await card("900001");
    const novo = CSV.replaceAll("900001;Site institucional Padaria Aurora;Reunião Diagnóstica", "900001;Site institucional Padaria Aurora;Contrato assinado");
    const r = await importarConteudo(novo, undefined, admin, new Date("2026-03-02T12:00:00Z"));
    if (!r.ok) throw new Error(r.erro);
    expect(r.relatorio).toMatchObject({ criados: 0, atualizados: 8, semMudanca: 7, projetosCriados: 1 });
    const depois = await card("900001");
    expect(depois.fase.chave).toBe("contrato_assinado");
    expect(depois.projeto?.fase.chave).toBe("em_execucao");
    const ts = await db.transicaoFase.findMany({ where: { oportunidadeId: c1.id }, orderBy: { em: "asc" }, include: { paraFase: true } });
    expect(ts.map((t) => t.paraFase.chave)).toEqual(["primeiro_contato", "reuniao_diagnostica", "contrato_assinado"]);
    const tl = await db.timeline.findMany({ where: { oportunidadeId: c1.id, tipo: { in: ["IMPORT", "MOVIMENTACAO"] } }, orderBy: [{ em: "asc" }, { id: "asc" }] });
    expect(tl.map((t) => [t.tipo, (t.payload as { acao?: string }).acao ?? null])).toEqual([
      ["IMPORT", "criado"],
      ["MOVIMENTACAO", null],
      ["IMPORT", "atualizado"],
    ]);
    // 3ª vez com o mesmo arquivo: nada muda, nem um 2º projeto.
    const r3 = await importarConteudo(novo, undefined, admin, new Date("2026-03-03T12:00:00Z"));
    expect(r3.ok && r3.relatorio).toMatchObject({ semMudanca: 8, projetosCriados: 0 });
    expect(await db.oportunidade.count({ where: { origemOportunidadeId: c1.id } })).toBe(1);
  });

  it("CSV com campo vazio não apaga o que o CRM tem; card na lixeira é pulado", async () => {
    const { admin } = await preparar();
    await importarConteudo(CSV, undefined, admin, AGORA);
    await db.oportunidade.update({ where: { pipefyId: "900008" }, data: { dor: "anotado no CRM" } });
    await db.oportunidade.update({ where: { pipefyId: "900010" }, data: { deletadoEm: new Date() } });
    const r = await importarConteudo(CSV, undefined, admin, AGORA);
    if (!r.ok) throw new Error(r.erro);
    expect((await card("900008")).dor).toBe("anotado no CRM");
    expect(r.relatorio.erros).toContainEqual({ linha: 15, pipefyId: "900010", mensagem: "Card excluído no CRM (está na lixeira): não é reimportado." });
  });

  it("mapeamento editado na prévia vale na confirmação", async () => {
    const { admin } = await preparar();
    const p1 = await criarPrevia({ conteudo: CSV, nomeArquivo: "x.csv" }, admin, AGORA);
    if (!p1.ok) throw new Error(p1.erro);
    const mapa = Object.fromEntries(p1.previa.fases.map((f) => [f.chave, f.faseId]));
    mapa["backlog antigo"] = (await fase("vendas", "primeiro_contato")).id;
    const p2 = await remapearPrevia(p1.token, mapa, admin, AGORA);
    if (!p2.ok) throw new Error(p2.erro);
    expect(p2.previa.hash).not.toBe(p1.previa.hash);
    // Token antigo morreu com a remapeação.
    expect(await confirmarPrevia(p1.token, p1.previa.hash, admin, AGORA)).toEqual({ ok: false, erro: "Prévia expirada ou já usada. Envie o arquivo de novo." });
    const r = await confirmarPrevia(p2.token, p2.previa.hash, admin, AGORA);
    if (!r.ok) throw new Error(r.erro);
    expect((await card("900006")).fase.chave).toBe("primeiro_contato");
  });

  it("confirmação recusa hash diferente, outro usuário, prévia vencida e uso duplo", async () => {
    const { admin } = await preparar();
    const outro = await db.usuario.create({ data: { nome: "Outro Gestor", email: "outro@ij.test", papel: "GESTOR" } });
    const p = await criarPrevia({ conteudo: CSV, nomeArquivo: "x.csv" }, admin, AGORA);
    if (!p.ok) throw new Error(p.erro);
    const falha = { ok: false, erro: "Prévia expirada ou já usada. Envie o arquivo de novo." };
    expect(await confirmarPrevia(p.token, "0".repeat(64), admin, AGORA)).toEqual(falha);
    expect(await confirmarPrevia(p.token, p.previa.hash, outro, AGORA)).toEqual(falha);
    expect(await confirmarPrevia(p.token, p.previa.hash, admin, new Date(AGORA.getTime() + 31 * 60_000))).toEqual(falha);
    expect(await db.oportunidade.count()).toBe(0);
    expect((await confirmarPrevia(p.token, p.previa.hash, admin, AGORA)).ok).toBe(true);
    expect(await confirmarPrevia(p.token, p.previa.hash, admin, AGORA)).toEqual(falha);
  });

  it("card que falha no meio do lote vai para os erros; o resto do lote é gravado", async () => {
    const { admin } = await preparar();
    // Sem em_execucao ativa, ganho em Vendas não consegue criar o projeto (regra do GAB-32).
    await db.fase.update({ where: { id: (await fase("projetos", "em_execucao")).id }, data: { arquivadaEm: new Date() } });
    const r = await importarConteudo(CSV, undefined, admin, AGORA);
    if (!r.ok) throw new Error(r.erro);
    const msg = (id: string) => r.relatorio.erros.find((e) => e.pipefyId === id)?.mensagem;
    expect(msg("900002")).toBe('Projetos não tem a fase "em_execucao" ativa: o projeto da venda ganha não pôde ser criado.');
    expect(msg("900004")).toBe('Projetos não tem a fase "em_execucao" ativa: o projeto da venda ganha não pôde ser criado.');
    expect(r.relatorio.criados).toBe(5); // 900001, 900005, 900007, 900008, 900010
    expect(await db.oportunidade.count({ where: { pipefyId: { in: ["900002", "900003", "900004"] } } })).toBe(0);
    expect(await db.oportunidade.count()).toBe(5);
  });

  it("prévia sem gravar (dry-run do CLI) não cria import_previa", async () => {
    await preparar();
    const r = await calcularPrevia(CSV, { nomeArquivo: "x.csv" });
    expect(r.ok).toBe(true);
    expect(await db.importPrevia.count()).toBe(0);
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { semear } from "../../../../prisma/seed";
import { decodificarArquivo } from "./csv";
import { editarCard } from "@/lib/oportunidades/oportunidades";
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
    // Sem histórico: fase_desde = agora e só a transição de entrada no funil.
    const c8 = await card("900008");
    expect(c8.faseDesde.toISOString()).toBe(AGORA.toISOString());
    const t8 = await db.transicaoFase.findMany({ where: { oportunidadeId: c8.id }, include: { paraFase: true } });
    expect(t8.map((t) => [t.origem, t.deFaseId, t.paraFase.chave, t.em.toISOString()])).toEqual([["IMPORT", null, "primeiro_contato", AGORA.toISOString()]]);
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
    expect(await db.oportunidade.count()).toBe(0);
    expect((await confirmarPrevia(p.token, p.previa.hash, admin, AGORA)).ok).toBe(true);
    expect(await confirmarPrevia(p.token, p.previa.hash, admin, AGORA)).toEqual(falha);
    const q = await criarPrevia({ conteudo: CSV, nomeArquivo: "x.csv" }, admin, AGORA);
    if (!q.ok) throw new Error(q.erro);
    expect(await confirmarPrevia(q.token, q.previa.hash, admin, new Date(AGORA.getTime() + 31 * 60_000))).toEqual(falha);
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

  it("confirmar apaga o CSV guardado da prévia usada e limpa prévias vencidas (de qualquer usuário)", async () => {
    const { admin } = await preparar();
    const outro = await db.usuario.create({ data: { nome: "Outro Gestor", email: "outro@ij.test", papel: "GESTOR" } });
    await db.importPrevia.create({ data: { id: "v".repeat(64), usuarioId: outro.id, hash: "h", nomeArquivo: "velho.csv", conteudo: CSV, mapeamento: {}, expiraEm: new Date(AGORA.getTime() - 1) } });
    const p = await criarPrevia({ conteudo: CSV, nomeArquivo: "x.csv" }, admin, AGORA);
    if (!p.ok) throw new Error(p.erro);
    // A prévia já limpou a vencida do outro usuário.
    expect(await db.importPrevia.count({ where: { id: "v".repeat(64) } })).toBe(0);
    await db.importPrevia.create({ data: { id: "w".repeat(64), usuarioId: outro.id, hash: "h", nomeArquivo: "velho.csv", conteudo: CSV, mapeamento: {}, expiraEm: new Date(AGORA.getTime() - 1) } });
    expect((await confirmarPrevia(p.token, p.previa.hash, admin, AGORA)).ok).toBe(true);
    expect(await db.importPrevia.count({ where: { id: "w".repeat(64) } })).toBe(0);
    const usada = await db.importPrevia.findUniqueOrThrow({ where: { id: p.token } });
    expect(usada.usadaEm).not.toBeNull();
    expect(usada.conteudo).toBe("");
  });

  it("prévia com mais de 32.767 telefones/emails: consulta em lotes (limite de parâmetros do Postgres)", async () => {
    await preparar();
    const linhas = ["ID;Título;Fase atual;Telefone;E-mail"];
    for (let i = 0; i < 3300; i++) {
      const tels = Array.from({ length: 5 }, (_, j) => `11 9${String(i * 5 + j).padStart(8, "0")}`).join(", ");
      const emails = Array.from({ length: 5 }, (_, j) => `c${i}x${j}@empresa${i}.com.br`).join(", ");
      linhas.push(`${i + 1};Card ${i + 1};Primeiro Contato;${tels};${emails}`);
    }
    const r = await calcularPrevia(linhas.join("\n"), { nomeArquivo: "grande.csv" });
    if (!r.ok) throw new Error(r.erro);
    expect(r.previa.cards).toBe(3300);
    expect(r.previa.novos).toBe(3300);
  }, 60_000);

  it("prévia sem gravar (dry-run do CLI) não cria import_previa", async () => {
    await preparar();
    const r = await calcularPrevia(CSV, { nomeArquivo: "x.csv" });
    expect(r.ok).toBe(true);
    expect(await db.importPrevia.count()).toBe(0);
  });
});

// ---------------------------------------------------------------- review do PR #15
const CAB = "ID;Título;Fase atual;Criado em;Atualizado em;Empresa;CNPJ;Nome do contato;Telefone;Motivo da perda;Primeira entrada na fase Primeiro Contato;Primeira entrada na fase Reunião Diagnóstica";
const mini = (...linhas: string[]) => [CAB, ...linhas].join("\n") + "\n";

describe("PERDIDO sem motivo", () => {
  const arq = mini("1;Perdido sem motivo;Perdido;10/01/2026 10:00;;;;;;;;", "2;Perdido com motivo;Perdido;10/01/2026 10:00;;;;;;Timing: ficou pra 2027;;");

  it("sem escolha do gestor: erro da linha na prévia e card pulado (nunca inventa motivo)", async () => {
    const { admin } = await preparar();
    const p = await calcularPrevia(arq, { nomeArquivo: "x.csv" });
    if (!p.ok) throw new Error(p.erro);
    expect(p.previa.erros).toEqual([{ linha: 2, pipefyId: "1", mensagem: "PERDIDO sem motivo no export." }]);
    expect(p.previa.perdidosSemMotivo).toBe(1);
    const r = await importarConteudo(arq, undefined, admin, AGORA);
    if (!r.ok) throw new Error(r.erro);
    expect(r.relatorio).toMatchObject({ criados: 1, pulados: 1 });
    expect(await db.oportunidade.count({ where: { pipefyId: "1" } })).toBe(0);
    expect((await card("2")).motivoPerda).toBe("Timing: ficou pra 2027");
  });

  it("com motivo padrão escolhido: aplica com o detalhe de quem definiu", async () => {
    const { admin } = await preparar();
    const opcoes = { motivoPerdaPadrao: "sem_resposta" as const };
    const p = await calcularPrevia(arq, { nomeArquivo: "x.csv", opcoes });
    if (!p.ok) throw new Error(p.erro);
    expect(p.previa.erros).toEqual([]);
    const r = await importarConteudo(arq, undefined, admin, AGORA, { opcoes });
    if (!r.ok) throw new Error(r.erro);
    expect(r.relatorio).toMatchObject({ criados: 2, pulados: 0 });
    expect((await card("1")).motivoPerda).toBe("Sem resposta: Motivo definido na importação por Admin Import");
    expect((await card("2")).motivoPerda).toBe("Timing: ficou pra 2027");
  });

  it("o motivo padrão entra no hash: confirmar exige a prévia com a mesma escolha", async () => {
    const { admin } = await preparar();
    const p1 = await criarPrevia({ conteudo: arq, nomeArquivo: "x.csv" }, admin, AGORA);
    if (!p1.ok) throw new Error(p1.erro);
    const p2 = await remapearPrevia(p1.token, Object.fromEntries(p1.previa.fases.map((f) => [f.chave, f.faseId])), admin, AGORA, { motivoPerdaPadrao: "preco" });
    if (!p2.ok) throw new Error(p2.erro);
    expect(p2.previa.hash).not.toBe(p1.previa.hash);
    expect(p2.previa.opcoes).toEqual({ motivoPerdaPadrao: "preco" });
    const r = await confirmarPrevia(p2.token, p2.previa.hash, admin, AGORA);
    if (!r.ok) throw new Error(r.erro);
    expect((await card("1")).motivoPerda).toBe("Preço: Motivo definido na importação por Admin Import");
  });
});

describe("PERDIDO sem motivo em Projetos", () => {
  it("projeto em fase PERDIDO sem motivo: pulado sem escolha; com motivo padrão, o projeto recebe o motivo", async () => {
    const { admin } = await preparar();
    const projetos = await db.pipeline.findUniqueOrThrow({ where: { chave: "projetos" } });
    await db.fase.create({ data: { pipelineId: projetos.id, chave: "cancelado", nome: "Cancelado", ordem: 99, cor: "#888888", tipoTerminal: "PERDIDO", isTerminal: true } });
    invalidarCachePipelines();
    const arq = mini("1;Projeto cancelado;Cancelado;10/01/2026 10:00;;;;;;;;");
    const sem = await importarConteudo(arq, undefined, admin, AGORA);
    if (!sem.ok) throw new Error(sem.erro);
    expect(sem.relatorio.erros).toEqual([{ linha: 2, pipefyId: "1", mensagem: "PERDIDO sem motivo no export." }]);
    expect(await db.oportunidade.count()).toBe(0);
    const com = await importarConteudo(arq, undefined, admin, AGORA, { opcoes: { motivoPerdaPadrao: "timing" } });
    if (!com.ok) throw new Error(com.erro);
    const venda = await card("1");
    expect(venda.projeto?.fase.chave).toBe("cancelado");
    const proj = await db.oportunidade.findUniqueOrThrow({ where: { id: venda.projeto!.id } });
    expect(proj.motivoPerda).toBe("Timing: Motivo definido na importação por Admin Import");
  });
});

describe("transições do import", () => {
  it("histórico corrigido no arquivo: troca só as transições IMPORT divergentes, nunca as de outra origem", async () => {
    const { admin } = await preparar();
    const v1 = mini("1;Card;Reunião Diagnóstica;05/01/2026 10:00;06/01/2026 10:00;;;;;;05/01/2026 10:00;06/01/2026 10:00");
    await importarConteudo(v1, undefined, admin, AGORA);
    const c = await card("1");
    const ui = await db.transicaoFase.create({
      data: { oportunidadeId: c.id, deFaseId: null, paraFaseId: (await fase("vendas", "reuniao_diagnostica")).id, usuarioId: admin.id, origem: "UI", em: new Date("2026-01-01T00:00:00Z") },
    });
    const v2 = mini("1;Card;Reunião Diagnóstica;05/01/2026 10:00;08/01/2026 10:00;;;;;;05/01/2026 10:00;08/01/2026 10:00");
    const r = await importarConteudo(v2, undefined, admin, AGORA);
    if (!r.ok) throw new Error(r.erro);
    const ts = await db.transicaoFase.findMany({ where: { oportunidadeId: c.id }, orderBy: { em: "asc" }, include: { paraFase: true } });
    expect(ts.map((t) => [t.origem, t.paraFase.chave, t.em.toISOString()])).toEqual([
      ["UI", "reuniao_diagnostica", "2026-01-01T00:00:00.000Z"],
      ["IMPORT", "primeiro_contato", "2026-01-05T13:00:00.000Z"],
      ["IMPORT", "reuniao_diagnostica", "2026-01-08T13:00:00.000Z"],
    ]);
    expect(ts[0].id).toBe(ui.id);
  });
});

describe("reimport não desfaz o CRM", () => {
  it("card editado no CRM depois do export: não é atualizado e aparece no relatório", async () => {
    const { admin } = await preparar();
    const arq = mini("1;Título do Pipefy;Primeiro Contato;05/01/2026 10:00;06/01/2026 10:00;;;;;;;");
    await importarConteudo(arq, undefined, admin, AGORA);
    const c = await card("1");
    const e = await editarCard(c.id, { titulo: "Título ajustado no CRM" }, admin);
    expect(e.ok).toBe(true);
    const mudado = arq.replace("Título do Pipefy", "Título novo do Pipefy");
    const r = await importarConteudo(mudado, undefined, admin, AGORA);
    if (!r.ok) throw new Error(r.erro);
    expect(r.relatorio).toMatchObject({ atualizados: 0, pulados: 1 });
    expect(r.relatorio.erros[0].mensagem).toMatch(/^Card editado no CRM depois do export/);
    expect((await card("1")).titulo).toBe("Título ajustado no CRM");
  });

  it("export mais novo que a edição do CRM: o Pipefy vale", async () => {
    const { admin } = await preparar();
    const arq = mini("1;Título do Pipefy;Primeiro Contato;05/01/2026 10:00;06/01/2026 10:00;;;;;;;");
    await importarConteudo(arq, undefined, admin, AGORA);
    await editarCard((await card("1")).id, { titulo: "Título ajustado no CRM" }, admin);
    const futuro = arq.replace("Título do Pipefy;Primeiro Contato;05/01/2026 10:00;06/01/2026 10:00", "Título novo do Pipefy;Primeiro Contato;05/01/2026 10:00;01/01/2099 10:00");
    const r = await importarConteudo(futuro, undefined, admin, AGORA);
    if (!r.ok) throw new Error(r.erro);
    expect(r.relatorio).toMatchObject({ atualizados: 1, pulados: 0 });
    expect((await card("1")).titulo).toBe("Título novo do Pipefy");
  });

  it("nunca tira um card de fase terminal no reimport", async () => {
    const { admin } = await preparar();
    await importarConteudo(mini("1;Card;Perdido;05/01/2026 10:00;06/01/2026 10:00;;;;;Preço;;"), undefined, admin, AGORA);
    const r = await importarConteudo(mini("1;Card;Primeiro Contato;05/01/2026 10:00;07/01/2026 10:00;;;;;;;"), undefined, admin, AGORA);
    if (!r.ok) throw new Error(r.erro);
    expect((await card("1")).fase.chave).toBe("perdido");
    expect(r.relatorio.avisos.map((a) => a.mensagem)).toContain('Card fechado no CRM (fase terminal): não foi movido para "Primeiro Contato".');
  });
});

describe("empresa e contato", () => {
  it("contato achado pelo telefone traz a empresa dele; nome diferente no CSV → revisar + aviso", async () => {
    const { admin } = await preparar();
    const acme = await db.empresa.create({ data: { nome: "Acme Ltda" } });
    await db.contato.create({ data: { nome: "Zé", empresaId: acme.id, pontos: { create: [{ tipo: "TELEFONE", valorNormalizado: "+5511912345678", valorOriginal: "11 91234-5678" }] } } });
    const r = await importarConteudo(mini("1;Card;Primeiro Contato;;;Outra Empresa SA;;Zé;11 91234-5678;;;", "2;Card 2;Primeiro Contato;;;ACME LTDA.;;Zé;11 91234-5678;;;"), undefined, admin, AGORA);
    if (!r.ok) throw new Error(r.erro);
    const c1 = await card("1");
    expect(c1).toMatchObject({ empresaId: acme.id, revisar: true });
    expect(r.relatorio.avisos).toContainEqual({ linha: 2, pipefyId: "1", mensagem: 'O contato achado pelo telefone/email é da empresa "Acme Ltda", mas o CSV diz "Outra Empresa SA": confira.' });
    expect(await card("2")).toMatchObject({ empresaId: acme.id, revisar: true }); // sem responsável → revisar de qualquer jeito
    expect(r.relatorio.avisos.some((a) => a.pipefyId === "2" && a.mensagem.startsWith("O contato achado"))).toBe(false);
    expect(await db.empresa.count()).toBe(1);
  });

  it("empresa sem CNPJ com o mesmo nome de uma existente: cria outra, marca revisar e sugere a existente", async () => {
    const { admin } = await preparar();
    const antiga = await db.empresa.create({ data: { nome: "Padaria Aurora" } });
    const arq = mini("1;Card;Primeiro Contato;;;padaria  AURORA;;;;;;");
    const r = await importarConteudo(arq, undefined, admin, AGORA);
    if (!r.ok) throw new Error(r.erro);
    const c = await card("1");
    expect(c.empresaId).not.toBe(antiga.id);
    expect(c.revisar).toBe(true);
    expect(r.relatorio.avisos).toContainEqual({ linha: 2, pipefyId: "1", mensagem: `Já existe a empresa "Padaria Aurora" no CRM com o mesmo nome (id ${antiga.id}): criada outra. Se for a mesma, mescle.` });
    // Reimport do mesmo card reaproveita a empresa dele: nenhuma nova.
    await importarConteudo(arq, undefined, admin, AGORA);
    expect(await db.empresa.count()).toBe(2);
  });

  it("telefone cadastrado por outro escritor no meio do lote (P2002): refaz o match e vincula ao contato existente", async () => {
    const { admin } = await preparar();
    const arq = mini("1;Card;Primeiro Contato;;;;;José;11 98888-1111;;;");
    let outro = "";
    const r = await importarConteudo(arq, undefined, admin, AGORA, {
      ganchosTeste: {
        depoisDaPreCarga: async () => {
          const c = await db.contato.create({ data: { nome: "José (WhatsApp)", pontos: { create: [{ tipo: "TELEFONE", valorNormalizado: "+5511988881111", valorOriginal: "11988881111" }] } } });
          outro = c.id;
        },
      },
    });
    if (!r.ok) throw new Error(r.erro);
    expect(r.relatorio).toMatchObject({ criados: 1, pulados: 0 });
    expect((await card("1")).contatoId).toBe(outro);
    expect(await db.contato.count()).toBe(2); // o "Ex-contato" do preparar + o do WhatsApp; nenhum órfão
  });
});

describe("import interrompido", () => {
  it("falha inesperada depois de lotes gravados: devolve o relatório parcial com a ref", async () => {
    const { admin } = await preparar();
    const arq = mini(...Array.from({ length: 5 }, (_, i) => `${i + 1};Card ${i + 1};Primeiro Contato;;;;;;;;;`));
    const r = await importarConteudo(arq, undefined, admin, AGORA, {
      tamanhoLote: 2,
      ganchosTeste: {
        antesDoLote: async (i) => {
          if (i === 1) throw new Error("conexão caiu");
        },
      },
    });
    if (!r.ok) throw new Error(r.erro);
    expect(r.relatorio).toMatchObject({ criados: 2, interrompido: { ref: expect.stringMatching(/^[0-9a-f]{8}$/), naoProcessados: 3 } });
    expect(await db.oportunidade.count()).toBe(2);
  });
});

describe("descrição do Pipefy", () => {
  it("coluna “Descrição” vira a descrição do card; reimport atualiza, vazio não apaga", async () => {
    const { admin } = await preparar();
    const csv = (d: string) => `ID;Título;Fase atual;Descrição\n700001;Padaria;Primeiro Contato;${d}\n`;
    const r1 = await importarConteudo(csv('"Quer loja\nonline"'), undefined, admin, AGORA);
    if (!r1.ok) throw new Error(r1.erro);
    expect((await card("700001")).descricao).toBe("Quer loja\nonline");

    const r2 = await importarConteudo(csv("Quer loja e blog"), undefined, admin, AGORA);
    if (!r2.ok) throw new Error(r2.erro);
    expect((await card("700001")).descricao).toBe("Quer loja e blog");

    await importarConteudo(csv(""), undefined, admin, AGORA);
    expect((await card("700001")).descricao).toBe("Quer loja e blog");
  });

  it("descrição editada no CRM depois do export conta como edição: o reimport pula o card (regra do GAB-37)", async () => {
    const { admin } = await preparar();
    const csv = (d: string, atualizado = "06/01/2026 10:00") => `ID;Título;Fase atual;Atualizado em;Descrição\n700002;Padaria;Primeiro Contato;${atualizado};${d}\n`;
    const r1 = await importarConteudo(csv("do Pipefy"), undefined, admin, AGORA);
    if (!r1.ok) throw new Error(r1.erro);
    expect((await editarCard((await card("700002")).id, { descricao: "ajustada no CRM" }, admin)).ok).toBe(true);

    const r2 = await importarConteudo(csv("nova do Pipefy"), undefined, admin, AGORA);
    if (!r2.ok) throw new Error(r2.erro);
    expect(r2.relatorio).toMatchObject({ atualizados: 0, pulados: 1 });
    expect(r2.relatorio.erros[0].mensagem).toMatch(/^Card editado no CRM depois do export/);
    expect((await card("700002")).descricao).toBe("ajustada no CRM");

    // Export mais novo que a edição: o Pipefy vale.
    const r3 = await importarConteudo(csv("nova do Pipefy", "01/01/2099 10:00"), undefined, admin, AGORA);
    if (!r3.ok) throw new Error(r3.erro);
    expect((await card("700002")).descricao).toBe("nova do Pipefy");
  });

  it("IMPORT “atualizado” guarda só prévia da descrição longa", async () => {
    const { admin } = await preparar();
    const csv = (d: string) => `ID;Título;Fase atual;Descrição\n700003;Padaria;Primeiro Contato;${d}\n`;
    await importarConteudo(csv("curta"), undefined, admin, AGORA);
    const longa = "y".repeat(1000);
    const r = await importarConteudo(csv(longa), undefined, admin, AGORA);
    if (!r.ok) throw new Error(r.erro);
    expect((await card("700003")).descricao).toBe(longa);
    const tl = await db.timeline.findFirstOrThrow({ where: { oportunidade: { pipefyId: "700003" }, tipo: "IMPORT", payload: { path: ["acao"], equals: "atualizado" } } });
    expect((tl.payload as { mudancas: unknown[] }).mudancas).toContainEqual({ campo: "descricao", antes: "curta", depois: "y".repeat(300), truncado: true });
  });
});

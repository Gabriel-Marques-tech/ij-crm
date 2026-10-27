// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { inicioDoDia } from "@/lib/oportunidades/campos";
import { ESTADO_PADRAO, FILTROS_TABELA_VAZIOS, type EstadoTabela, type FiltrosTabela } from "./params";
import { exportarCsv, listarTabela, POR_PAGINA, textoNaTabela } from "./tabela";

const db = dbTeste();
const sp = (iso: string) => new Date(`${iso}-03:00`);
const AGORA = sp("2026-10-24T15:00:00");

async function semear() {
  const vendas = await db.pipeline.create({
    data: {
      chave: "vendas",
      nome: "Vendas",
      ordem: 0,
      fases: {
        create: [
          { chave: "primeiro_contato", nome: "Primeiro Contato", ordem: 0, limiteDiasAlerta: 10 },
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
  const ana = await db.usuario.create({ data: { nome: "Ana Vendas", email: "ana@ij.test" } });
  const bruno = await db.usuario.create({ data: { nome: "Bruno Lima", email: "bruno@ij.test" } });
  const acme = await db.empresa.create({ data: { nome: "Acme Ltda" } });
  const velha = await db.empresa.create({ data: { nome: "Velha SA", deletadoEm: new Date() } });
  const dup = await db.empresa.create({ data: { nome: "Acme Dup", mergedIntoId: acme.id } });
  const maria = await db.contato.create({ data: { nome: "Maria 50% Silva" } });
  return { vendas, projetos, ana, bruno, acme, velha, dup, maria };
}

type S = Awaited<ReturnType<typeof semear>>;
const fase = (p: { fases: { chave: string; id: string }[] }, chave: string) => p.fases.find((f) => f.chave === chave)!.id;

let seq = 0;
async function card(
  s: S,
  titulo: string,
  x: {
    resp?: string;
    faseChave?: string;
    projeto?: boolean;
    origem?: "RD" | "COLD_CALL" | null;
    revisar?: boolean;
    acao?: string | null;
    criado?: Date;
    faseDesde?: Date;
    orcamento?: string | null;
    empresaId?: string;
    contatoId?: string;
    deletado?: boolean;
  } = {},
) {
  const p = x.projeto ? s.projetos : s.vendas;
  seq += 1;
  return db.oportunidade.create({
    data: {
      titulo,
      pipelineId: p.id,
      faseId: fase(p, x.faseChave ?? (x.projeto ? "em_execucao" : "primeiro_contato")),
      responsavelId: x.resp ?? s.ana.id,
      criadoVia: "UI",
      origem: x.origem ?? null,
      revisar: x.revisar ?? false,
      proximaAcao: x.acao ? `fazer ${titulo}` : null,
      proximaAcaoEm: x.acao ? inicioDoDia(x.acao) : null,
      criadoEm: x.criado ?? new Date(sp("2026-10-01T10:00:00").getTime() + seq * 60_000),
      faseDesde: x.faseDesde ?? sp("2026-10-20T10:00:00"),
      orcamentoPrevisto: x.orcamento ?? null,
      empresaId: x.empresaId,
      contatoId: x.contatoId,
      deletadoEm: x.deletado ? new Date() : null,
    },
  });
}

const estado = (f: Partial<FiltrosTabela> = {}, extra: Partial<EstadoTabela> = {}): EstadoTabela => ({
  ...ESTADO_PADRAO,
  filtros: { ...FILTROS_TABELA_VAZIOS, ...f },
  ...extra,
});
const titulos = async (e: EstadoTabela) => (await listarTabela(e, AGORA)).linhas.map((l) => l.titulo);

async function csvTexto(e: EstadoTabela, lote?: number) {
  let s = "";
  for await (const pedaco of exportarCsv(e.filtros, e.ordem, AGORA, lote)) s += pedaco;
  return s;
}

beforeEach(async () => {
  await limparBanco(["transicao_fase", "timeline", "oportunidade", "fase", "pipeline", "contato", "empresa", "sessao", "usuario"]);
  invalidarCachePipelines();
  seq = 0;
});

describe("listarTabela", () => {
  it("todos os vivos, de qualquer responsável e pipeline; nunca soft-deletados; padrão = criado desc", async () => {
    const s = await semear();
    await card(s, "a");
    await card(s, "b", { resp: s.bruno.id, projeto: true });
    await card(s, "c", { faseChave: "perdido" });
    await card(s, "apagado", { deletado: true });
    const r = await listarTabela(estado(), AGORA);
    expect(r.total).toBe(3);
    expect(r.linhas.map((l) => l.titulo)).toEqual(["c", "b", "a"]);
    expect(r.linhas[0].fase).toMatchObject({ nome: "Perdido", isTerminal: true, tipoTerminal: "PERDIDO" });
  });

  it("filtros combinados: pipeline + fase + responsável + origem (com 'sem') + revisar + terminais", async () => {
    const s = await semear();
    await card(s, "alvo1", { origem: "RD", revisar: true });
    await card(s, "alvo2", { origem: null, revisar: true });
    await card(s, "origem errada", { origem: "COLD_CALL", revisar: true });
    await card(s, "sem revisar", { origem: "RD" });
    await card(s, "do bruno", { origem: "RD", revisar: true, resp: s.bruno.id });
    await card(s, "projeto", { origem: "RD", revisar: true, projeto: true });
    await card(s, "fase errada", { origem: "RD", revisar: true, faseChave: "proposta" });
    await card(s, "ganho", { origem: "RD", revisar: true, faseChave: "contrato_assinado" });

    const f: Partial<FiltrosTabela> = { quadro: ["vendas"], resp: [s.ana.id], origem: ["RD", "SEM"], revisar: "sim", terminais: "nao" };
    expect(await titulos(estado({ ...f, fase: [fase(s.vendas, "primeiro_contato")] }))).toEqual(["alvo2", "alvo1"]);
    expect(await titulos(estado({ ...f }))).toEqual(["fase errada", "alvo2", "alvo1"]);
    expect(await titulos(estado({ ...f, terminais: "sim" }))).toEqual(["ganho"]);
    expect(await titulos(estado({ quadro: ["projetos"] }))).toEqual(["projeto"]);
  });

  it("próxima ação nas mesmas faixas da Minha Semana (dias civis de SP)", async () => {
    const s = await semear();
    await card(s, "vencida", { acao: "2026-10-23" });
    await card(s, "hoje", { acao: "2026-10-24" });
    await card(s, "semana", { acao: "2026-10-31" });
    await card(s, "depois", { acao: "2026-11-01" });
    await card(s, "sem");
    const t = (acao: FiltrosTabela["acao"]) => titulos(estado({ acao }, { ordem: { coluna: "titulo", dir: "asc" } }));
    expect(await t(["vencida"])).toEqual(["vencida"]);
    expect(await t(["hoje"])).toEqual(["hoje"]);
    expect(await t(["semana"])).toEqual(["semana"]);
    expect(await t(["sem", "vencida"])).toEqual(["sem", "vencida"]);
  });

  it("período de criação inclusivo nas duas pontas, em dias de SP", async () => {
    const s = await semear();
    await card(s, "antes", { criado: sp("2026-09-30T23:59:00") });
    await card(s, "inicio", { criado: sp("2026-10-01T00:00:00") });
    await card(s, "fim", { criado: sp("2026-10-10T23:59:00") });
    await card(s, "depois", { criado: sp("2026-10-11T00:00:00") });
    expect(await titulos(estado({ de: "2026-10-01", ate: "2026-10-10" }))).toEqual(["fim", "inicio"]);
    expect(await titulos(estado({ de: "2026-10-11" }))).toEqual(["depois"]);
  });

  it("busca em título, empresa e contato; % e _ são literais", async () => {
    const s = await semear();
    await card(s, "Site novo", { empresaId: s.acme.id });
    await card(s, "App", { contatoId: s.maria.id });
    await card(s, "Desconto 100_000");
    await card(s, "Outro");
    const busca = (q: string) => titulos(estado({ q }, { ordem: { coluna: "titulo", dir: "asc" } }));
    expect(await busca("acme")).toEqual(["Site novo"]);
    expect(await busca("SILVA")).toEqual(["App"]);
    expect(await busca("site")).toEqual(["Site novo"]);
    expect(await busca("%")).toEqual(["App"]);
    expect(await busca("_")).toEqual(["Desconto 100_000"]);
  });

  it("busca como a do Kanban: sem acento, sem caixa, espaços colapsados (nos dois lados)", async () => {
    const s = await semear();
    const joao = await db.contato.create({ data: { nome: "João  Pereira" } });
    const sa = await db.empresa.create({ data: { nome: "Acme SA" } });
    await card(s, "Reunião técnica");
    await card(s, "Com João", { contatoId: joao.id });
    await card(s, "Da SA", { empresaId: sa.id });
    await card(s, "Outro");
    const busca = (q: string) => titulos(estado({ q }, { ordem: { coluna: "titulo", dir: "asc" } }));
    expect(await busca("joao")).toEqual(["Com João"]);
    expect(await busca("JOÃO pereira")).toEqual(["Com João"]);
    expect(await busca("reuniao TECNICA")).toEqual(["Reunião técnica"]);
    expect(await busca("acme  sa")).toEqual(["Da SA"]);
    expect(await busca("%")).toEqual([]);
  });

  it("busca casa o nome exibido: vivo; mesclado → principal viva (ou o próprio, se a principal morreu); excluído não", async () => {
    const s = await semear();
    const morto = await db.contato.create({ data: { nome: "Zeca Morto", deletadoEm: new Date() } });
    await card(s, "x", { empresaId: s.velha.id });
    await card(s, "y", { empresaId: s.dup.id });
    await card(s, "z", { contatoId: morto.id });
    await card(s, "w", { empresaId: s.acme.id });
    const busca = (q: string) => titulos(estado({ q }, { ordem: { coluna: "titulo", dir: "asc" } }));
    expect(await busca("velha")).toEqual([]);
    expect(await busca("dup")).toEqual([]);
    expect(await busca("zeca")).toEqual([]);
    expect(await busca("acme")).toEqual(["w", "y"]);
    const outra = await db.empresa.create({ data: { nome: "Principal Morta", deletadoEm: new Date() } });
    const orfa = await db.empresa.create({ data: { nome: "Orfa Ltda", mergedIntoId: outra.id } });
    await card(s, "v", { empresaId: orfa.id });
    expect(await busca("principal")).toEqual([]);
    expect(await busca("orfa")).toEqual(["v"]);
  });

  it("empresa excluída/mesclada descrita via vinculo.ts", async () => {
    const s = await semear();
    await card(s, "x", { empresaId: s.velha.id });
    await card(s, "y", { empresaId: s.dup.id });
    const r = await listarTabela(estado({}, { ordem: { coluna: "titulo", dir: "asc" } }), AGORA);
    expect(r.linhas[0].empresa).toMatchObject({ estado: "EXCLUIDO", nome: "Velha SA" });
    expect(r.linhas[1].empresa).toMatchObject({ estado: "MESCLADO", nome: "Acme Dup", destino: { id: s.acme.id, nome: "Acme Ltda" } });
  });

  it("nome exibido como no Kanban: mesclada → principal viva; principal excluída → nome próprio", async () => {
    const s = await semear();
    const morta = await db.empresa.create({ data: { nome: "Principal Morta", deletadoEm: new Date() } });
    const orfa = await db.empresa.create({ data: { nome: "Orfa Ltda", mergedIntoId: morta.id } });
    const maria2 = await db.contato.create({ data: { nome: "Maria Dup", mergedIntoId: s.maria.id } });
    await card(s, "a", { empresaId: s.dup.id, contatoId: maria2.id });
    await card(s, "b", { empresaId: orfa.id });
    await card(s, "c", { empresaId: s.velha.id });
    const r = await listarTabela(estado({}, { ordem: { coluna: "titulo", dir: "asc" } }), AGORA);
    expect(r.linhas.map((l) => [textoNaTabela("empresa", l.empresa), textoNaTabela("contato", l.contato)])).toEqual([
      ["Acme Ltda", "Maria 50% Silva"],
      ["Orfa Ltda", null],
      ["Velha SA (excluída)", null],
    ]);
    const csv = (await csvTexto(estado({}, { ordem: { coluna: "titulo", dir: "asc" } }))).slice(1).split("\r\n").filter(Boolean).slice(1);
    expect(csv.map((l) => l.split(";").slice(4, 6))).toEqual([
      ["Acme Ltda", "Maria 50% Silva"],
      ["Orfa Ltda", ""],
      ["Velha SA (excluída)", ""],
    ]);
  });

  it("ordenação no banco: vazios por último, desempate estável por id, dias na fase, aging", async () => {
    const s = await semear();
    const a = await card(s, "a", { orcamento: "100.00" });
    const b = await card(s, "b", { orcamento: "100.00" });
    await card(s, "c", { orcamento: null });
    await card(s, "d", { orcamento: "5000.00", faseDesde: sp("2026-10-10T10:00:00") });
    const empate = [a, b].sort((x, y) => (x.id < y.id ? -1 : 1)).map((x) => x.titulo);
    expect(await titulos(estado({}, { ordem: { coluna: "orcamento", dir: "asc" } }))).toEqual([...empate, "d", "c"]);
    expect(await titulos(estado({}, { ordem: { coluna: "orcamento", dir: "desc" } }))).toEqual(["d", ...empate, "c"]);
    const r = await listarTabela(estado({}, { ordem: { coluna: "diasNaFase", dir: "desc" } }), AGORA);
    expect(r.linhas[0]).toMatchObject({ titulo: "d", diasNaFase: 14, aging: "vermelho" });
    expect(r.linhas[1]).toMatchObject({ diasNaFase: 4, aging: "verde" });
    expect(r.linhas.find((l) => l.titulo === "d")!.orcamentoPrevisto).toBe("5000.00");
  });

  it("pagina de 50 em 50 com total; página além do fim cai na última", async () => {
    const s = await semear();
    for (let i = 0; i < 55; i++) await card(s, `c${String(i).padStart(2, "0")}`);
    const ordem = { coluna: "titulo", dir: "asc" } as const;
    const p1 = await listarTabela(estado({}, { ordem, pagina: 1 }), AGORA);
    expect(p1).toMatchObject({ total: 55, paginas: 2, pagina: 1 });
    expect(p1.linhas).toHaveLength(POR_PAGINA);
    const p2 = await listarTabela(estado({}, { ordem, pagina: 2 }), AGORA);
    expect(p2.linhas.map((l) => l.titulo)).toEqual(["c50", "c51", "c52", "c53", "c54"]);
    expect((await listarTabela(estado({}, { ordem, pagina: 9 }), AGORA)).pagina).toBe(2);
  });
});

describe("exportarCsv", () => {
  it("todas as linhas filtradas (sem limite de 50), na ordem da tela, BOM + ; + pt-BR + anti fórmula", async () => {
    const s = await semear();
    for (let i = 0; i < 55; i++) await card(s, `c${String(i).padStart(2, "0")}`);
    await card(s, "=HYPERLINK(\"x\")", { resp: s.bruno.id, orcamento: "12500.50", empresaId: s.velha.id, contatoId: s.maria.id, origem: "RD", acao: "2026-10-30", revisar: true });
    await card(s, "fora", { resp: s.bruno.id, deletado: true });

    const tudo = await csvTexto(estado({}, { ordem: { coluna: "titulo", dir: "asc" } }), 7);
    expect(tudo.startsWith("﻿ID;Título;Pipeline;Fase;Empresa;Contato;")).toBe(true);
    const linhas = tudo.slice(1).split("\r\n").filter(Boolean);
    expect(linhas).toHaveLength(1 + 56);
    const pos = (t: string) => linhas.findIndex((l) => l.includes(`;${t};`));
    expect(pos("c00")).toBeGreaterThan(0);
    expect(pos("c00")).toBeLessThan(pos("c01"));
    expect(pos("c53")).toBeLessThan(pos("c54"));
    expect(tudo).not.toContain("fora");

    const doBruno = await csvTexto(estado({ resp: [s.bruno.id] }));
    const [, linha] = doBruno.slice(1).split("\r\n");
    const cel = linha.split(";");
    expect(cel[1]).toBe(`"'=HYPERLINK(""x"")"`);
    expect(cel.slice(2)).toEqual([
      "Vendas",
      "Primeiro Contato",
      "Velha SA (excluída)",
      "Maria 50% Silva",
      "Bruno Lima",
      "RD Station",
      "Sim",
      "4",
      `"fazer =HYPERLINK(""x"")"`,
      "30/10/2026",
      "12500,50",
      expect.stringMatching(/^\d{2}\/10\/2026 \d{2}:\d{2}$/),
    ]);
  });

  it("cada lote reaplica os filtros: card que deixou de bater (ou foi apagado) no meio da exportação some", async () => {
    const s = await semear();
    const cards = [];
    for (let i = 0; i < 6; i++) cards.push(await card(s, `c${i}`, { revisar: true }));
    const gen = exportarCsv({ ...FILTROS_TABELA_VAZIOS, revisar: "sim", q: "c" }, { coluna: "titulo", dir: "asc" }, AGORA, 2);
    const cabecalho = await gen.next();
    expect(cabecalho.value).toContain("Título");
    // Depois de lidos os ids: c1 deixa de bater no filtro, c4 é apagado, c5 deixa de bater na busca.
    await db.oportunidade.update({ where: { id: cards[1].id }, data: { revisar: false } });
    await db.oportunidade.update({ where: { id: cards[4].id }, data: { deletadoEm: new Date() } });
    await db.oportunidade.update({ where: { id: cards[5].id }, data: { titulo: "zz" } });
    let resto = "";
    for await (const p of gen) resto += p;
    const titulosCsv = resto.split("\r\n").filter(Boolean).map((l) => l.split(";")[1]);
    expect(titulosCsv).toEqual(["c0", "c2", "c3"]);
  });

  it("sem resultados → só cabeçalho", async () => {
    await semear();
    const t = await csvTexto(estado({ q: "nada" }));
    expect(t.slice(1).split("\r\n").filter(Boolean)).toHaveLength(1);
  });
});

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db as dbApp } from "@/lib/db";
import { dbTeste, limparBanco } from "@/test/db";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { inicioDoDia } from "@/lib/oportunidades/campos";
import { ESTADO_PADRAO, FILTROS_TABELA_VAZIOS, type EstadoTabela, type FiltrosTabela } from "./params";
import { exportarCsv, listarTabela, POR_PAGINA } from "./tabela";

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

afterEach(() => {
  vi.restoreAllMocks();
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

  it("empresa excluída marcada; mesclada exibida pela principal viva", async () => {
    const s = await semear();
    await card(s, "x", { empresaId: s.velha.id });
    await card(s, "y", { empresaId: s.dup.id });
    const r = await listarTabela(estado({}, { ordem: { coluna: "titulo", dir: "asc" } }), AGORA);
    expect(r.linhas[0].empresa).toEqual({ nome: "Velha SA (excluída)", excluido: true });
    expect(r.linhas[1].empresa).toEqual({ nome: "Acme Ltda", excluido: false });
  });

  it("excluída E mesclada (estado hoje inalcançável): vale o merge, como `nomeExibido`", async () => {
    const s = await semear();
    const ambas = await db.empresa.create({ data: { nome: "Zumbi SA", deletadoEm: new Date(), mergedIntoId: s.acme.id } });
    await card(s, "z", { empresaId: ambas.id });
    const r = await listarTabela(estado({}), AGORA);
    expect(r.linhas[0].empresa).toEqual({ nome: "Acme Ltda", excluido: false });
    expect(await titulos(estado({ q: "acme" }))).toEqual(["z"]);
    expect(await titulos(estado({ q: "zumbi" }))).toEqual([]);
  });

  it("merge tem 1 nível (validarMerge): cadeia A→B→C forçada no banco é exibida e buscada igual, por B", async () => {
    const s = await semear();
    const c = await db.empresa.create({ data: { nome: "Cume Final" } });
    const b = await db.empresa.create({ data: { nome: "Beta Meio", mergedIntoId: c.id } });
    const a = await db.empresa.create({ data: { nome: "Alfa Ponta", mergedIntoId: b.id } });
    await card(s, "cadeia", { empresaId: a.id });
    const exibido = (await listarTabela(estado({}), AGORA)).linhas[0].empresa?.nome;
    expect(exibido).toBe("Beta Meio");
    expect(await titulos(estado({ q: "beta meio" }))).toEqual(["cadeia"]);
    expect(await titulos(estado({ q: "cume" }))).toEqual([]);
    expect(await titulos(estado({ q: "alfa" }))).toEqual([]);
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
    expect(r.linhas.map((l) => [l.empresa?.nome ?? null, l.contato?.nome ?? null])).toEqual([
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

  it("ordena empresa/contato pelo nome exibido (mesclada → principal viva; excluída → o próprio), pt-BR, vazios por último", async () => {
    const s = await semear();
    const bravo = await db.empresa.create({ data: { nome: "Bravo" } });
    const zulu = await db.empresa.create({ data: { nome: "Zulu Dup", mergedIntoId: bravo.id } });
    const agil = await db.empresa.create({ data: { nome: "Ágil" } });
    const carlos = await db.empresa.create({ data: { nome: "carlos" } });
    const contatoZ = await db.contato.create({ data: { nome: "Zé Dup", mergedIntoId: s.maria.id } });
    const contatoB = await db.contato.create({ data: { nome: "Beto" } });
    await card(s, "zulu", { empresaId: zulu.id, contatoId: contatoZ.id });
    await card(s, "velha", { empresaId: s.velha.id, contatoId: contatoB.id });
    await card(s, "sem");
    await card(s, "agil", { empresaId: agil.id });
    await card(s, "carlos", { empresaId: carlos.id });
    const asc = await listarTabela(estado({}, { ordem: { coluna: "empresa", dir: "asc" } }), AGORA);
    expect(asc.linhas.map((l) => l.empresa?.nome ?? null)).toEqual(["Ágil", "Bravo", "carlos", "Velha SA (excluída)", null]);
    expect(await titulos(estado({}, { ordem: { coluna: "empresa", dir: "desc" } }))).toEqual(["velha", "carlos", "zulu", "agil", "sem"]);
    // Contato: "Zé Dup" é exibido como "Maria 50% Silva" → vem depois de "Beto".
    const contatos = await listarTabela(estado({}, { ordem: { coluna: "contato", dir: "asc" } }), AGORA);
    expect(contatos.linhas.map((l) => l.contato?.nome ?? null).slice(0, 2)).toEqual(["Beto", "Maria 50% Silva"]);
  });

  it("ordem por empresa pagina sem duplicar nem pular (mesclada, empates por id) e o CSV segue a mesma ordem", async () => {
    const s = await semear();
    const bravo = await db.empresa.create({ data: { nome: "Bravo" } });
    const zulu = await db.empresa.create({ data: { nome: "Zulu Dup", mergedIntoId: bravo.id } });
    const charlie = await db.empresa.create({ data: { nome: "Charlie" } });
    const criados = [];
    for (let i = 0; i < 55; i++) criados.push(await card(s, `c${String(i).padStart(2, "0")}`, { empresaId: i % 2 ? zulu.id : charlie.id }));
    const porId = (x: { id: string }, y: { id: string }) => (x.id < y.id ? -1 : 1);
    const esperado = [...criados.filter((_, i) => i % 2).sort(porId), ...criados.filter((_, i) => !(i % 2)).sort(porId)].map((c) => c.id);
    const ordem = { coluna: "empresa", dir: "asc" } as const;
    const p1 = await listarTabela(estado({}, { ordem, pagina: 1 }), AGORA);
    const p2 = await listarTabela(estado({}, { ordem, pagina: 2 }), AGORA);
    expect(p1).toMatchObject({ total: 55, paginas: 2 });
    expect([...p1.linhas, ...p2.linhas].map((l) => l.id)).toEqual(esperado);
    const csv = (await csvTexto(estado({}, { ordem }), 7)).slice(1).split("\r\n").filter(Boolean).slice(1);
    expect(csv.map((l) => l.split(";")[0])).toEqual(esperado);
    // Com busca + filtro: a busca pelo nome exibido continua valendo junto da ordem.
    const filtrada = await listarTabela(estado({ q: "bravo" }, { ordem: { coluna: "empresa", dir: "desc" } }), AGORA);
    expect(filtrada.linhas.map((l) => l.id)).toEqual(esperado.slice(0, 27));
  });

  it("título e responsável também em pt-BR (ij_ptbr): acento e caixa só desempatam, nos dois sentidos", async () => {
    const s = await semear();
    const nomes = ["Zebra", "abc", "Ágil", "ágil"];
    for (const n of nomes) {
      const u = await db.usuario.create({ data: { nome: n, email: `${n.normalize("NFD").replace(/\p{Diacritic}/gu, "")}-${n === "Ágil" ? 1 : 2}@ij.test` } });
      await card(s, n, { resp: u.id });
    }
    const ordemTitulo = async (dir: "asc" | "desc") => titulos(estado({}, { ordem: { coluna: "titulo", dir } }));
    const ordemResp = async (dir: "asc" | "desc") =>
      (await listarTabela(estado({}, { ordem: { coluna: "responsavel", dir } }), AGORA)).linhas.map((l) => l.responsavel.nome);
    expect(await ordemTitulo("asc")).toEqual(["abc", "ágil", "Ágil", "Zebra"]);
    expect(await ordemTitulo("desc")).toEqual(["Zebra", "Ágil", "ágil", "abc"]);
    expect(await ordemResp("asc")).toEqual(["abc", "ágil", "Ágil", "Zebra"]);
    expect(await ordemResp("desc")).toEqual(["Zebra", "Ágil", "ágil", "abc"]);
  });

  it("título e responsável empatados na virada da página: id desempata, sem duplicar nem pular, nos dois sentidos; CSV na mesma ordem", async () => {
    const s = await semear();
    const igual1 = await db.usuario.create({ data: { nome: "Igual", email: "igual1@ij.test" } });
    const igual2 = await db.usuario.create({ data: { nome: "Igual", email: "igual2@ij.test" } });
    const agil = await db.usuario.create({ data: { nome: "Ágil", email: "agil@ij.test" } });
    const empatados = [];
    for (let i = 0; i < 55; i++) empatados.push(await card(s, "mesmo", { resp: i % 2 ? igual1.id : igual2.id }));
    const doAgil = [];
    for (let i = 0; i < 5; i++) doAgil.push(await card(s, "mesmo", { resp: agil.id }));
    const porId = (xs: { id: string }[]) => xs.map((x) => x.id).sort((a, b) => (a < b ? -1 : 1));
    const todos = porId([...empatados, ...doAgil]);
    const esperado = {
      titulo: { asc: todos, desc: todos },
      // "Ágil" < "Igual" em pt-BR; dentro de cada nome, id asc nos dois sentidos.
      responsavel: { asc: [...porId(doAgil), ...porId(empatados)], desc: [...porId(empatados), ...porId(doAgil)] },
    };
    for (const coluna of ["titulo", "responsavel"] as const) {
      for (const dir of ["asc", "desc"] as const) {
        const ordem = { coluna, dir };
        const p1 = await listarTabela(estado({}, { ordem, pagina: 1 }), AGORA);
        const p2 = await listarTabela(estado({}, { ordem, pagina: 2 }), AGORA);
        expect(p1).toMatchObject({ total: 60, paginas: 2 });
        expect(p2.linhas).toHaveLength(10);
        expect([...p1.linhas, ...p2.linhas].map((l) => l.id), `${coluna} ${dir}`).toEqual(esperado[coluna][dir]);
        const csv = (await csvTexto(estado({}, { ordem }), 7)).slice(1).split("\r\n").filter(Boolean).slice(1);
        expect(csv.map((l) => l.split(";")[0]), `csv ${coluna} ${dir}`).toEqual(esperado[coluna][dir]);
      }
    }
  });

  it("ordem por nome: a página reaplica os filtros (card apagado entre a leitura dos ids e a da página some)", async () => {
    const s = await semear();
    const a = await card(s, "a", { empresaId: s.acme.id });
    await card(s, "b", { empresaId: s.acme.id });
    const original = dbApp.$queryRaw.bind(dbApp);
    vi.spyOn(dbApp, "$queryRaw").mockImplementationOnce((async (...args: Parameters<typeof dbApp.$queryRaw>) => {
      const r = await original(...args);
      await db.oportunidade.update({ where: { id: a.id }, data: { deletadoEm: new Date() } });
      return r;
    }) as typeof dbApp.$queryRaw);
    const r = await listarTabela(estado({}, { ordem: { coluna: "empresa", dir: "asc" } }), AGORA);
    expect(r.linhas.map((l) => l.titulo)).toEqual(["b"]);
  });

  it("busca que casa mais de 32.767 ids (limite de bind do Postgres) pagina por nome e por título", { timeout: 60_000 }, async () => {
    const s = await semear();
    const N = 33_000;
    await db.$executeRaw`
      INSERT INTO oportunidade (id, titulo, pipeline_id, fase_id, responsavel_id, criado_via, empresa_id, fase_desde, criado_em, atualizado_em)
      SELECT 'massa' || lpad(g::text, 6, '0'), 'massa ' || lpad(g::text, 6, '0'), ${s.vendas.id}, ${fase(s.vendas, "primeiro_contato")},
             ${s.ana.id}, 'UI', CASE WHEN g % 2 = 0 THEN ${s.dup.id} ELSE NULL END, now(), now(), now()
      FROM generate_series(1, ${N}) g`;
    const porNome = await listarTabela(estado({ q: "massa" }, { ordem: { coluna: "empresa", dir: "asc" }, pagina: 2 }), AGORA);
    expect(porNome.total).toBe(N);
    expect(porNome.linhas.map((l) => l.id)).toEqual(Array.from({ length: POR_PAGINA }, (_, i) => `massa${String(2 * (POR_PAGINA + i + 1)).padStart(6, "0")}`));
    expect(porNome.linhas[0].empresa?.nome).toBe("Acme Ltda");
    const porTitulo = await listarTabela(estado({ q: "massa" }, { ordem: { coluna: "titulo", dir: "desc" } }), AGORA);
    expect(porTitulo.total).toBe(N);
    expect(porTitulo.linhas[0].titulo).toBe("massa 033000");
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

  it("lotes + busca pelo nome exibido da mesclada: todas as linhas, na ordem, com o nome da principal", async () => {
    const s = await semear();
    for (let i = 0; i < 5; i++) await card(s, `m${i}`, { empresaId: s.dup.id });
    await card(s, "fora", { empresaId: s.velha.id });
    const t = await csvTexto(estado({ q: "acme ltda" }, { ordem: { coluna: "titulo", dir: "asc" } }), 2);
    const linhas = t.slice(1).split("\r\n").filter(Boolean).slice(1).map((l) => l.split(";"));
    expect(linhas.map((c) => [c[1], c[4]])).toEqual(["m0", "m1", "m2", "m3", "m4"].map((m) => [m, "Acme Ltda"]));
  });

  it("sem resultados → só cabeçalho", async () => {
    await semear();
    const t = await csvTexto(estado({ q: "nada" }));
    expect(t.slice(1).split("\r\n").filter(Boolean)).toHaveLength(1);
  });
});

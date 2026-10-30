/**
 * GAB-81: migration 20261030130000_ciclo_unico contra dados no formato da v1
 * (pares venda → projeto, órfãos, reaberturas, pipefy_id, perdidos, lixeira,
 * fases customizadas e arquivadas). O schema de teste já está migrado (global
 * setup); aqui o banco é montado como a v1 deixava (fases sem marco, dois
 * cards por ganho) e o SQL da migration roda de novo — o mesmo arquivo que o
 * `prisma migrate deploy` roda. Rodar 2x não pode mudar nada.
 *
 * As contagens antes/depois vêm de `scripts/verificar-ciclo-unico.sql`, o
 * mesmo script só-leitura para rodar contra uma cópia de produção.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { OrigemTransicao, Prisma, TipoTimeline } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { invalidarCachePipelines } from "./cache";
import { listarQuadro, moverCard } from "@/lib/projetos/projetos";
import { listarCardsNaLixeira } from "@/lib/lixeira/lixeira";
import { restaurarCard } from "@/lib/lixeira/cards";
import { carregarDados } from "@/lib/ranking/servico";

const db = dbTeste();
const raiz = path.resolve(import.meta.dirname, "../../..");
const SQL_MIGRACAO = readFileSync(path.join(raiz, "prisma/migrations/20261030130000_ciclo_unico/migration.sql"), "utf8");
const SQL_VERIFICAR_ARQ = readFileSync(path.join(raiz, "scripts/verificar-ciclo-unico.sql"), "utf8");

/** Divide o SQL em comandos, respeitando '…', $tag$…$tag$ e comentários `--`. */
export function comandos(sql: string): string[] {
  const out: string[] = [];
  let atual = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "-" && sql[i + 1] === "-") {
      const fim = sql.indexOf("\n", i);
      i = fim < 0 ? sql.length : fim;
      continue;
    }
    if (c === "'") {
      const fim = sql.indexOf("'", i + 1);
      atual += sql.slice(i, fim + 1);
      i = fim + 1;
      continue;
    }
    if (c === "$") {
      const m = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const fim = sql.indexOf(m[0], i + m[0].length);
        atual += sql.slice(i, fim + m[0].length);
        i = fim + m[0].length;
        continue;
      }
    }
    if (c === ";") {
      if (atual.trim()) out.push(atual.trim());
      atual = "";
      i++;
      continue;
    }
    atual += c;
    i++;
  }
  if (atual.trim()) out.push(atual.trim());
  return out;
}

/** O arquivo da migration, comando a comando, numa transação (BEGIN/COMMIT do arquivo = a do teste). */
async function rodarMigracao() {
  const lista = comandos(SQL_MIGRACAO).filter((c) => !/^(BEGIN|COMMIT)$/i.test(c));
  await db.$transaction(async (tx) => {
    for (const c of lista) await tx.$executeRawUnsafe(c);
  });
  invalidarCachePipelines();
}

/** As consultas do script (fora o BEGIN READ ONLY / ROLLBACK): [contagens, pares em conflito]. */
const [SQL_CONTAGENS, SQL_CONFLITOS] = comandos(SQL_VERIFICAR_ARQ).filter((c) => !/^(BEGIN|ROLLBACK|COMMIT)\b/i.test(c));

type Conflito = { conflito: string; venda_id: string; venda_fase: string; venda_responsavel: string; projeto_id: string; projeto_fase: string; projeto_responsavel: string };
const conflitos = () => db.$queryRawUnsafe<Conflito[]>(SQL_CONFLITOS);

async function contagens(): Promise<Record<string, number>> {
  const linhas = await db.$queryRawUnsafe<{ metrica: string; valor: bigint }[]>(SQL_CONTAGENS);
  return Object.fromEntries(linhas.map((l) => [l.metrica, Number(l.valor)]));
}

/** Tudo o que a migration pode tocar, para comparar a 1ª e a 2ª execução. */
async function retrato(): Promise<string> {
  const tabelas = ["pipeline", "fase", "oportunidade", "timeline", "transicao_fase", "prazo", "mensagem_enviada"];
  const partes: unknown[] = [];
  for (const t of tabelas) partes.push(await db.$queryRawUnsafe(`SELECT to_jsonb(x) AS l FROM "${t}" x ORDER BY to_jsonb(x)::text`));
  return JSON.stringify(partes);
}

// ---------------------------------------------------------------- dados no formato da v1

const T = (dia: number, hora = 12) => new Date(Date.UTC(2026, 8, dia, hora));

type Fx = Awaited<ReturnType<typeof montarV1>>;

async function montarV1() {
  const ana = await db.usuario.create({ data: { nome: "Ana Vendas", email: "ana@ij.test", papel: "VENDEDOR" } });
  const paulo = await db.usuario.create({ data: { nome: "Paulo Projetos", email: "paulo@ij.test", papel: "VENDEDOR" } });
  const fasesVendas: [string, string, ("GANHO" | "PERDIDO")?, boolean?][] = [
    ["primeiro_contato", "Primeiro Contato"],
    ["reuniao_diagnostica", "Reunião Diagnóstica"],
    ["qualificacao", "Qualificação"], // customizada pela gestão
    ["montando_proposta", "Montando Proposta"],
    ["em_negociacao", "Em negociação"],
    ["montando_contrato", "Montando Contrato"],
    ["aguardando_assinatura", "Aguardando assinatura"], // customizada, depois de Montando contrato
    ["contrato_assinado", "Contrato assinado", "GANHO"],
    ["perdido", "Perdido", "PERDIDO"],
    ["perdido_sem_verba", "Perdido — sem verba", "PERDIDO"], // terminal customizado
    ["velha", "Fase velha", undefined, true], // arquivada
  ];
  const vendas = await db.pipeline.create({
    data: {
      chave: "vendas",
      nome: "Vendas",
      ordem: 0,
      fases: {
        create: fasesVendas.map(([chave, nome, tipo, arq], ordem) => ({
          chave,
          nome,
          ordem,
          isTerminal: !!tipo,
          tipoTerminal: tipo ?? null,
          arquivadaEm: arq ? T(1) : null,
        })),
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
          { chave: "kickoff", nome: "Kickoff", ordem: 0 }, // customizada, antes de em_execucao
          { chave: "em_execucao", nome: "Em execução", ordem: 1 },
          { chave: "conclusao", nome: "Conclusão", ordem: 2 },
          { chave: "coleta_dados", nome: "Coleta de dados", ordem: 3 },
          { chave: "finalizado", nome: "Finalizado", ordem: 4, isTerminal: true, tipoTerminal: "GANHO" },
        ],
      },
    },
    include: { fases: true },
  });
  const f = (p: { fases: { chave: string; id: string }[] }, chave: string) => p.fases.find((x) => x.chave === chave)!.id;
  const V = (chave: string) => f(vendas, chave);
  const P = (chave: string) => f(projetos, chave);

  async function card(d: {
    titulo: string;
    pipelineId: string;
    faseId: string;
    resp?: string;
    criadoEm: Date;
    faseDesde: Date;
    trans: [string | null, string, Date, OrigemTransicao?][];
    tl?: [TipoTimeline, Prisma.InputJsonValue, Date][];
    extra?: Partial<Prisma.ProjetoUncheckedCreateInput>;
  }) {
    const c = await db.projeto.create({
      data: {
        titulo: d.titulo,
        pipelineId: d.pipelineId,
        faseId: d.faseId,
        responsavelId: d.resp ?? ana.id,
        criadoVia: "UI",
        criadoEm: d.criadoEm,
        faseDesde: d.faseDesde,
        ...d.extra,
      },
    });
    for (const [de, para, em, origem] of d.trans) {
      await db.transicaoFase.create({ data: { projetoId: c.id, deFaseId: de, paraFaseId: para, em, origem: origem ?? "UI", usuarioId: ana.id } });
    }
    for (const [tipo, payload, em] of d.tl ?? []) await db.timeline.create({ data: { projetoId: c.id, tipo, payload, em, usuarioId: ana.id } });
    return c.id;
  }

  const venda = (titulo: string, faseId: string, faseDesde: Date, extra: Partial<Prisma.ProjetoUncheckedCreateInput> = {}, trans?: [string | null, string, Date][]) =>
    card({
      titulo,
      pipelineId: vendas.id,
      faseId,
      criadoEm: T(2),
      faseDesde,
      trans: trans ?? [
        [null, V("primeiro_contato"), T(2)],
        [V("primeiro_contato"), V("em_negociacao"), T(3)],
        [V("em_negociacao"), V("contrato_assinado"), T(4)],
      ],
      tl: [
        ["CRIACAO", { faseId: V("primeiro_contato"), via: "UI" }, T(2)],
        ["NOTA", { texto: "liguei", feito: true }, T(3)],
      ],
      extra,
    });
  const projeto = (titulo: string, faseId: string, vendaId: string | null, faseDesde: Date, extra: Partial<Prisma.ProjetoUncheckedCreateInput> = {}) =>
    card({
      titulo,
      pipelineId: projetos.id,
      faseId,
      resp: paulo.id,
      criadoEm: T(4),
      faseDesde,
      trans: [
        [null, P("em_execucao"), T(4, 13), "SISTEMA"],
        ...(faseId !== P("em_execucao") ? ([[P("em_execucao"), faseId, faseDesde]] as [string, string, Date][]) : []),
      ],
      tl: [
        ["CRIACAO", vendaId ? { faseId: P("em_execucao"), via: "GANHO", origemOportunidadeId: vendaId } : { faseId: P("em_execucao"), via: "UI" }, T(4, 13)],
        ["NOTA", { texto: "reunião de kickoff" }, T(5)],
      ],
      extra: { ...extra, vendaOrigemId: vendaId },
    });

  const ganho = { dataGanho: T(4), valorFechado: "12000.00" };
  // A: par clássico (venda ganha, projeto andou), com pipefy_id, prazo, mensagem e reaberturas.
  const vA = await venda("A — Padaria", V("contrato_assinado"), T(4), { ...ganho, pipefyId: "pf-A", descricao: "escopo de vendas" });
  const pA = await projeto("A — Padaria (projeto)", P("conclusao"), vA, T(6), { proximaAcao: "entregar relatório", proximaAcaoEm: T(20) });
  await db.timeline.create({ data: { projetoId: vA, tipo: "VINCULO_PROJETO", payload: { projetoId: pA, criado: true }, em: new Date(T(4).getTime() + 60_000) } });
  await db.prazo.create({ data: { titulo: "Entrega", data: T(25), responsavelId: paulo.id, criadoPorId: paulo.id, projetoId: pA } });
  await db.mensagemEnviada.create({ data: { eventoId: "ev-A", grupoJid: "g@g.us", texto: "ok", projetoId: pA } });
  const rDeP = await venda("A — reaberto do projeto", V("primeiro_contato"), T(7), { reabertaDeId: pA }, [[null, V("primeiro_contato"), T(7)]]);
  const rDeV = await venda("A — reaberto da venda", V("primeiro_contato"), T(7), { reabertaDeId: vA }, [[null, V("primeiro_contato"), T(7)]]);
  // B: venda reaberta DEPOIS do ganho, projeto vivo (em Conclusão) → NÃO unidos: 2 Projetos.
  const vB = await venda("B — Oficina", V("em_negociacao"), T(9), { ...ganho });
  const pB = await projeto("B — Oficina (projeto)", P("conclusao"), vB, T(6));
  // C: projeto na lixeira, venda viva no ganho → une e fica parada em Ganho (Vendas);
  // descrições longas (> 5000 juntas) → fica a da venda, a do projeto vira NOTA.
  const vC = await venda("C — Mercado", V("contrato_assinado"), T(4), { ...ganho, descricao: "v".repeat(3000) });
  const pC = await projeto("C — Mercado (projeto)", P("em_execucao"), vC, T(4), { deletadoEm: T(8), descricao: "p".repeat(3000) });
  // D: venda na lixeira, projeto vivo → Projeto vivo em Projetos.
  // (a venda tinha próxima ação e revisar; o projeto não: no unido ficam as da venda)
  const vD = await venda("D — Escola", V("contrato_assinado"), T(4), { ...ganho, deletadoEm: T(8), proximaAcao: "ligar", proximaAcaoEm: T(21), revisar: true });
  const pD = await projeto("D — Escola (projeto)", P("em_execucao"), vD, T(4));
  // E: pipefy_id só no projeto; descrições diferentes nos dois.
  const vE = await venda("E — Clínica", V("contrato_assinado"), T(4), { ...ganho, descricao: "da venda" });
  const pE = await projeto("E — Clínica (projeto)", P("coleta_dados"), vE, T(6), { pipefyId: "pf-E", descricao: "do projeto" });
  // F: venda PERDIDA depois do ganho, projeto vivo → NÃO unidos.
  const vF = await venda("F — Hotel", V("perdido"), T(9), { ...ganho, motivoPerda: "Timing" }, [
    [null, V("primeiro_contato"), T(2)],
    [V("primeiro_contato"), V("contrato_assinado"), T(4)],
    [V("contrato_assinado"), V("perdido"), T(9)],
  ]);
  const pF = await projeto("F — Hotel (projeto)", P("em_execucao"), vF, T(4));
  // Soltos: órfão de Projetos, perdido, aberto.
  const orfao = await projeto("Órfão (só projetos)", P("kickoff"), null, T(4));
  const perdido = await venda("Perdido", V("perdido_sem_verba"), T(5), { motivoPerda: "Preço" });
  const aberto = await venda("Aberto", V("reuniao_diagnostica"), T(3), {}, [[null, V("primeiro_contato"), T(2)], [V("primeiro_contato"), V("reuniao_diagnostica"), T(3)]]);

  return { ana, paulo, vendas, projetos, V, P, vA, pA, rDeP, rDeV, vB, pB, vC, pC, vD, pD, vE, pE, vF, pF, orfao, perdido, aberto };
}

beforeEach(async () => {
  await limparBanco(["mensagem_enviada", "prazo", "transicao_fase", "timeline", "oportunidade", "fase", "pipeline", "sessao", "usuario"]);
  invalidarCachePipelines();
});

const ordemAtiva = async (pipelineId: string) =>
  (await db.fase.findMany({ where: { pipelineId, arquivadaEm: null }, orderBy: { ordem: "asc" } })).map((f) => (f.marco ? `${f.chave}*` : f.chave));

describe("migration do ciclo único (GAB-81)", () => {
  let fx: Fx;

  it("une os pares, preserva histórico e é idempotente", async () => {
    fx = await montarV1();
    const antes = await contagens();
    // Pares NÃO unidos (decisão do usuário): B reaberta, F perdida depois do ganho.
    const naoUnidos = async () =>
      (await conflitos()).map((c) => [c.conflito, c.venda_id, c.venda_fase, c.projeto_id, c.projeto_fase, c.venda_responsavel, c.projeto_responsavel]);
    const esperadosNaoUnidos = [
      ["nao_unido_perdida", fx.vF, "Perdido", fx.pF, "Em execução", "Ana Vendas", "Paulo Projetos"],
      ["nao_unido_reaberta", fx.vB, "Em negociação", fx.pB, "Conclusão", "Ana Vendas", "Paulo Projetos"],
    ];
    expect(await naoUnidos()).toEqual(esperadosNaoUnidos);
    // Instantes do par A antes: a migration não pode trocá-los pelo instante do deploy.
    const maxEmA = (await db.timeline.aggregate({ where: { projetoId: { in: [fx.vA, fx.pA] } }, _max: { em: true } }))._max.em!;
    const [atuVA, atuPA] = await Promise.all([fx.vA, fx.pA].map(async (id) => (await db.projeto.findUniqueOrThrow({ where: { id } })).atualizadoEm));
    await rodarMigracao();
    const depois = await contagens();
    const r1 = await retrato();
    await rodarMigracao();
    expect(await retrato()).toBe(r1); // 2ª execução: nenhuma linha muda
    expect(await contagens()).toEqual(depois);

    // Tabela para o PR.
    console.log(
      "contagens antes → depois\n" +
        Object.keys(depois)
          .map((k) => `  ${k.padEnd(30)} ${String(antes[k]).padStart(4)} → ${depois[k]}`)
          .join("\n"),
    );

    // ---- contagens
    expect(antes).toMatchObject({ cards_total: 17, pares_venda_projeto: 6, pares_nao_unidos: 2, orfaos_projetos: 1, cards_absorvidos: 0, marcos: 0 });
    expect(depois.projetos_entidades).toBe(antes.cards_total - depois.cards_absorvidos); // 13
    expect(await naoUnidos()).toEqual(esperadosNaoUnidos); // a lista não muda: eles ficam separados
    expect(depois.vivos_em_projetos).toBe(6); // A, D, E (unidos) + B, F (projetos não unidos) + órfão
    expect(depois).toMatchObject({
      cards_total: antes.cards_total,
      cards_absorvidos: antes.pares_venda_projeto - antes.pares_nao_unidos, // 4
      pares_venda_projeto: antes.pares_nao_unidos,
      pares_nao_unidos: antes.pares_nao_unidos,
      orfaos_projetos: 1,
      // + auditoria por par unido + NOTA da descrição longa (C) + auditoria nos 2 cards de cada par não unido
      timeline_total: antes.timeline_total + (antes.pares_venda_projeto - antes.pares_nao_unidos) + 1 + 2 * antes.pares_nao_unidos,
      transicoes_total: antes.transicoes_total,
      prazos_total: antes.prazos_total,
      mensagens_enviadas_total: antes.mensagens_enviadas_total,
      pipefy_ids: antes.pipefy_ids,
      reaberturas: antes.reaberturas,
      historico_em_card_absorvido: 0,
      marcos: 7,
      cards_em_fase_de_outro_quadro: 0,
      vivos: antes.vivos - 2, // pares unidos com os dois vivos: A, E
    });

    // ---- marcos e ordem (posição relativa das customizadas preservada)
    expect(await ordemAtiva(fx.vendas.id)).toEqual([
      "primeiro_contato",
      "reuniao_diagnostica",
      "qualificacao",
      "montando_proposta",
      "em_negociacao",
      "proposta*",
      "montando_contrato*",
      "aguardando_assinatura",
      "contrato_assinado*",
      "perdido_sem_verba",
      "perdido*",
    ]);
    expect(await ordemAtiva(fx.projetos.id)).toEqual(["handoff*", "execucao*", "kickoff", "em_execucao", "conclusao", "coleta_dados", "finalizado*"]);
    const marcos = await db.fase.findMany({ where: { marco: { not: null } }, select: { chave: true, marco: true } });
    expect(Object.fromEntries(marcos.map((m) => [m.marco, m.chave]))).toEqual({
      PROPOSTA: "proposta",
      MONTANDO_CONTRATO: "montando_contrato",
      GANHO: "contrato_assinado",
      PERDIDO: "perdido",
      HANDOFF: "handoff",
      EXECUCAO: "execucao",
      FINALIZADO: "finalizado",
    });
    expect(await db.fase.findFirstOrThrow({ where: { chave: "velha" } })).toMatchObject({ arquivadaEm: T(1), ordem: 10, marco: null });

    // ---- A: o Projeto é a venda, na posição do projeto, com tudo junto
    const a = await db.projeto.findUniqueOrThrow({ where: { id: fx.vA } });
    expect(a).toMatchObject({
      pipelineId: fx.projetos.id,
      faseId: fx.P("conclusao"),
      faseDesde: T(6),
      responsavelId: fx.paulo.id,
      proximaAcao: "entregar relatório",
      titulo: "A — Padaria (projeto)",
      pipefyId: "pf-A",
      dataGanho: T(4),
      descricao: "escopo de vendas",
      deletadoEm: null,
      criadoEm: T(2),
    });
    // vendedor = responsável da venda (Ana), mesmo com o projeto em nome do Paulo.
    expect(a.vendedorId).toBe(fx.ana.id);
    // Auditoria datada pelo histórico do par; atualizado_em = o maior dos dois (não o deploy).
    expect((await db.timeline.aggregate({ where: { projetoId: fx.vA }, _max: { em: true } }))._max.em).toEqual(maxEmA);
    expect(a.atualizadoEm).toEqual(new Date(Math.max(atuVA.getTime(), atuPA.getTime())));
    const tlA = await db.timeline.findMany({ where: { projetoId: fx.vA }, orderBy: [{ em: "asc" }, { id: "asc" }] });
    expect(tlA.map((t) => t.tipo)).toEqual(["CRIACAO", "NOTA", "VINCULO_PROJETO", "CRIACAO", "NOTA", "VINCULO_PROJETO"]);
    expect(tlA.at(-1)!.payload).toMatchObject({ evento: "ciclo_unico", projetoAbsorvidoId: fx.pA, antes: { pipeline_id: fx.vendas.id, fase_id: fx.V("contrato_assinado") } });
    const trA = await db.transicaoFase.findMany({ where: { projetoId: fx.vA }, orderBy: { em: "asc" } });
    expect(trA.map((t) => t.paraFaseId)).toEqual([fx.V("primeiro_contato"), fx.V("em_negociacao"), fx.V("contrato_assinado"), fx.P("em_execucao"), fx.P("conclusao")]);
    expect(await db.prazo.count({ where: { projetoId: fx.vA } })).toBe(1);
    expect(await db.mensagemEnviada.count({ where: { projetoId: fx.vA } })).toBe(1);
    expect((await db.projeto.findUniqueOrThrow({ where: { id: fx.rDeP } })).reabertaDeId).toBe(fx.vA);
    expect((await db.projeto.findUniqueOrThrow({ where: { id: fx.rDeV } })).reabertaDeId).toBe(fx.vA);

    // A casca do projeto fica (soft-deletada, marcada), sem histórico próprio.
    const pA = await db.projeto.findUniqueOrThrow({ where: { id: fx.pA } });
    expect(pA.absorvidoPorId).toBe(fx.vA);
    expect(pA.deletadoEm).not.toBeNull();
    expect(pA.vendaOrigemId).toBe(fx.vA);

    // ---- B, C, D, E
    expect(await db.projeto.findUniqueOrThrow({ where: { id: fx.vB } })).toMatchObject({ pipelineId: fx.vendas.id, faseId: fx.V("em_negociacao"), responsavelId: fx.ana.id });
    expect(await db.projeto.findUniqueOrThrow({ where: { id: fx.vC } })).toMatchObject({ pipelineId: fx.vendas.id, faseId: fx.V("contrato_assinado"), deletadoEm: null });
    expect(await db.projeto.findUniqueOrThrow({ where: { id: fx.pC } })).toMatchObject({ absorvidoPorId: fx.vC, deletadoEm: T(8) });
    // D: lado atual = projeto sem próxima ação → fica a da venda; revisar = OU dos dois.
    expect(await db.projeto.findUniqueOrThrow({ where: { id: fx.vD } })).toMatchObject({
      pipelineId: fx.projetos.id,
      faseId: fx.P("em_execucao"),
      deletadoEm: null,
      responsavelId: fx.paulo.id,
      vendedorId: fx.ana.id,
      proximaAcao: "ligar",
      proximaAcaoEm: T(21),
      revisar: true,
    });
    // C: descrição > 5000 juntas → fica a da venda, a do projeto vira NOTA (sem autor).
    expect((await db.projeto.findUniqueOrThrow({ where: { id: fx.vC } })).descricao).toBe("v".repeat(3000));
    const notaC = await db.timeline.findFirstOrThrow({ where: { projetoId: fx.vC, tipo: "NOTA", usuarioId: null } });
    expect(notaC.payload).toEqual({ texto: "p".repeat(3000), origem: "ciclo_unico_descricao_projeto" });
    // B e F (não unidos): dois Projetos cada, um em cada quadro; vínculo da v1 intacto; auditoria nos dois.
    for (const [venda, proj, faseVenda, faseProj] of [
      [fx.vB, fx.pB, fx.V("em_negociacao"), fx.P("conclusao")],
      [fx.vF, fx.pF, fx.V("perdido"), fx.P("em_execucao")],
    ]) {
      expect(await db.projeto.findUniqueOrThrow({ where: { id: venda } })).toMatchObject({ pipelineId: fx.vendas.id, faseId: faseVenda, absorvidoPorId: null, deletadoEm: null, vendedorId: fx.ana.id });
      expect(await db.projeto.findUniqueOrThrow({ where: { id: proj } })).toMatchObject({
        pipelineId: fx.projetos.id,
        faseId: faseProj,
        absorvidoPorId: null,
        deletadoEm: null,
        vendaOrigemId: venda,
        responsavelId: fx.paulo.id,
      });
      for (const id of [venda, proj]) {
        expect(await db.timeline.count({ where: { projetoId: id, tipo: "VINCULO_PROJETO", payload: { path: ["evento"], equals: "ciclo_unico_nao_unido" } } })).toBe(1);
      }
      // Histórico de cada um continua no próprio card.
      expect(await db.transicaoFase.count({ where: { projetoId: proj } })).toBeGreaterThan(0);
    }
    // Cards de Vendas que já tinham ganho ganham vendedor = responsável; os sem ganho, não.
    expect((await db.projeto.findUniqueOrThrow({ where: { id: fx.vC } })).vendedorId).toBe(fx.ana.id);
    expect((await db.projeto.findUniqueOrThrow({ where: { id: fx.aberto } })).vendedorId).toBeNull();
    // Ranking: ganho do par A conta para a Ana (vendedora), não para o Paulo (responsável em Projetos).
    const dados = await carregarDados({ inicio: T(1), fim: T(30) });
    expect(dados.ganhos.find((g) => g.projetoId === fx.vA)?.responsavelId).toBe(fx.ana.id);
    expect(await db.projeto.findUniqueOrThrow({ where: { id: fx.vE } })).toMatchObject({
      pipefyId: "pf-E",
      faseId: fx.P("coleta_dados"),
      descricao: "da venda\n\n— Projetos —\ndo projeto",
    });
    expect((await db.projeto.findUniqueOrThrow({ where: { id: fx.pE } })).pipefyId).toBeNull();
    expect(await db.projeto.findUniqueOrThrow({ where: { id: fx.orfao } })).toMatchObject({ pipelineId: fx.projetos.id, faseId: fx.P("kickoff"), absorvidoPorId: null });

    // ---- telas: cada Projeto em exatamente um quadro; casca fora da lixeira
    const qv = (await listarQuadro("vendas"))!.cards.map((c) => c.id);
    const qp = (await listarQuadro("projetos"))!.cards.map((c) => c.id);
    expect(qv.filter((id) => qp.includes(id))).toEqual([]);
    expect(new Set(qp)).toEqual(new Set([fx.vA, fx.vD, fx.vE, fx.pB, fx.pF, fx.orfao]));
    expect(new Set(qv)).toEqual(new Set([fx.vB, fx.vC, fx.vF, fx.rDeP, fx.rDeV, fx.perdido, fx.aberto]));
    expect((await listarCardsNaLixeira()).map((c) => c.id)).toEqual([]);
    expect(await restaurarCard(fx.pA, { id: fx.ana.id, papel: "GESTOR" })).toMatchObject({ ok: false, erro: "CARD_NAO_ENCONTRADO" });

    // ---- depois da migration, ganhar não cria card: o mesmo vai para Handoff
    const r = await moverCard(fx.aberto, fx.V("contrato_assinado"), fx.ana, { dadosTerminal: { valorFechado: "5.000,00" } });
    expect(r).toMatchObject({ ok: true });
    const ganhou = await db.projeto.findUniqueOrThrow({ where: { id: fx.aberto }, include: { fase: true } });
    expect(ganhou).toMatchObject({ pipelineId: fx.projetos.id, fase: { marco: "HANDOFF" } });
    expect(await db.projeto.count()).toBe(antes.cards_total);
  });

  it("banco sem quadros (instalação nova): não faz nada", async () => {
    await rodarMigracao();
    expect(await db.fase.count()).toBe(0);
  });

  it("marco faltando na v1 (gestão apagou montando_contrato; ganho com outra chave) é criado/adotado", async () => {
    const vendas = await db.pipeline.create({
      data: {
        chave: "vendas",
        nome: "Vendas",
        fases: {
          create: [
            { chave: "inicio", nome: "Início", ordem: 0 },
            { chave: "fechou", nome: "Fechou", ordem: 1, isTerminal: true, tipoTerminal: "GANHO" },
            { chave: "perdido", nome: "Perdido", ordem: 2, isTerminal: true, tipoTerminal: "PERDIDO", arquivadaEm: T(1) },
            { chave: "perdeu", nome: "Perdeu", ordem: 3, isTerminal: true, tipoTerminal: "PERDIDO" },
          ],
        },
      },
    });
    const projetos = await db.pipeline.create({
      data: { chave: "projetos", nome: "Projetos", ordem: 1, fases: { create: [{ chave: "handoff", nome: "Handoff antigo", ordem: 0, isTerminal: true, tipoTerminal: "GANHO" }] } },
    });
    await rodarMigracao();
    expect(await ordemAtiva(vendas.id)).toEqual(["inicio", "proposta*", "montando_contrato*", "fechou*", "perdeu", "perdido*"]);
    // "handoff" terminal não serve de marco aberto: cria handoff_2; o terminal vira Finalizado.
    expect(await ordemAtiva(projetos.id)).toEqual(["handoff_2*", "execucao*", "handoff*"]);
    expect((await db.fase.findFirstOrThrow({ where: { marco: "FINALIZADO" } })).chave).toBe("handoff");
  });
});

/**
 * G&G · fase B: demandas Rosa/Azul, agenda e ausências, metas (OKR/KPI/iniciativas)
 * e RACI. Quem edita: os mesmos editores da área G&G (`ehEditorGG`). Quem lê: todo
 * usuário ativo; faltas só a própria pessoa, G&G e gestão (decisão §3.9).
 * Spec: docs/superpowers/specs/2026-11-05-gg-no-crm-design.md
 */
import type { CategoriaEvento, DirecaoKpi, PapelRaci, Prisma, TipoDemanda } from "@prisma/client";
import { temPapelMinimo } from "@/lib/auth/papeis";
import { emitirAvisos } from "@/lib/avisos/avisos";
import { diaDoPrazo, instanteDoPrazo, segundaDe } from "@/lib/calendario/semana";
import { db } from "@/lib/db";
import { diaEmFuso } from "@/lib/projetos/aging";
import { somarDias } from "@/lib/projetos/proxima-acao";
import { descendentes, LIMITE_DEMANDA, ROTULO_EVENTO, semestreDe } from "./modelo";
import { areasGG, carregarBase, ehEditorGG, postosDe, type AtorGG, type BaseOrg } from "./organizacao";

type Tx = Prisma.TransactionClient;
export type ErroRotina = "SEM_PERMISSAO" | "NAO_ENCONTRADO" | "DADOS_INVALIDOS" | "LIMITE" | "SEM_MEMBRO" | "JA_REGISTRADA" | "EVENTO_FUTURO" | "FONTE_AUTOMATICA" | "JA_MEDIDO";
export const MENSAGEM_ERRO_ROTINA: Record<ErroRotina, string> = {
  SEM_PERMISSAO: "Só a área de Gente & Gestão e a administração fazem isso.",
  NAO_ENCONTRADO: "Registro não encontrado.",
  DADOS_INVALIDOS: "Dados inválidos.",
  LIMITE: "Limite semestral atingido.",
  SEM_MEMBRO: "Ligue sua conta a um membro ativo (G&G → Membros) antes de assinar uma demanda.",
  JA_REGISTRADA: "Isso já está registrado (talvez por outra pessoa agora há pouco). Recarregue a página.",
  EVENTO_FUTURO: "Ausência só depois do evento.",
  FONTE_AUTOMATICA: "Este indicador é medido pelo CRM; não aceita medição manual.",
  JA_MEDIDO: "Já existe medição nessa data. Uma por dia.",
};
export type ResultadoRotina<T = object> = ({ ok: true } & T) | { ok: false; erro: ErroRotina; detalhe?: string };

class Recusa extends Error {
  constructor(
    readonly erro: ErroRotina,
    readonly detalhe?: string,
  ) {
    super(erro);
  }
}
function traduzir(e: unknown): { ok: false; erro: ErroRotina; detalhe?: string } {
  if (e instanceof Recusa) return { ok: false, erro: e.erro, detalhe: e.detalhe };
  if ((e as { code?: string }).code === "P2002") return { ok: false, erro: "JA_REGISTRADA" };
  throw e;
}
async function exigirEditor(ator: AtorGG) {
  if (!(await ehEditorGG(ator))) throw new Recusa("SEM_PERMISSAO");
}
const hoje = () => diaEmFuso(new Date());
const DIA = /^\d{4}-\d{2}-\d{2}$/;
function data(d: string): Date {
  if (!DIA.test(d) || diaDoPrazo(instanteDoPrazo(d)) !== d) throw new Recusa("DADOS_INVALIDOS");
  return instanteDoPrazo(d);
}

// ================================================================ demandas Rosa/Azul

export type DemandaLinha = { id: string; membroId: string; membro: string; tipo: TipoDemanda; semestre: string; justificativa: string; registrante: string; em: string; cancelada: boolean };

export async function listarDemandas(): Promise<DemandaLinha[]> {
  const ds = await db.demanda.findMany({ orderBy: { criadoEm: "desc" }, include: { membro: { select: { nome: true } } } });
  return ds.map((d) => ({ id: d.id, membroId: d.membroId, membro: d.membro.nome, tipo: d.tipo, semestre: d.semestre, justificativa: d.justificativa, registrante: d.registranteNome, em: diaEmFuso(d.criadoEm), cancelada: d.canceladaEm !== null }));
}

/** Saldo de um membro no semestre (não canceladas). */
export async function saldoDemandas(membroId: string, semestre = semestreDe(hoje()), cliente: Pick<Tx, "demanda"> = db): Promise<Record<TipoDemanda, number>> {
  const g = await cliente.demanda.groupBy({ by: ["tipo"], where: { membroId, semestre, canceladaEm: null }, _count: true });
  return { ROSA: g.find((x) => x.tipo === "ROSA")?._count ?? 0, AZUL: g.find((x) => x.tipo === "AZUL")?._count ?? 0 };
}

/**
 * Registro simples (pessoa, tipo, justificativa) assinado pela conta de quem registra, que
 * precisa estar ligada a um membro ativo. Limite com trava de transação: dois registros
 * simultâneos não furam o máximo (mesma ideia do trigger privado.validar_demanda do G&G).
 */
export async function registrarDemanda(d: { membroId: string; tipo: TipoDemanda; justificativa: string }, ator: AtorGG): Promise<ResultadoRotina<{ id: string }>> {
  try {
    await exigirEditor(ator);
    const justificativa = d.justificativa.trim();
    if (!justificativa || justificativa.length > 1000 || !(d.tipo in LIMITE_DEMANDA)) throw new Recusa("DADOS_INVALIDOS");
    const id = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(912011)`;
      const assinante = await tx.membro.findFirst({ where: { usuarioId: ator.id, status: "ATIVO" }, select: { nome: true } });
      if (!assinante) throw new Recusa("SEM_MEMBRO");
      if (!(await tx.membro.findUnique({ where: { id: d.membroId }, select: { id: true } }))) throw new Recusa("NAO_ENCONTRADO");
      const semestre = semestreDe(hoje());
      const saldo = await saldoDemandas(d.membroId, semestre, tx);
      if (saldo[d.tipo] >= LIMITE_DEMANDA[d.tipo]) throw new Recusa("LIMITE", `Limite semestral atingido: ${LIMITE_DEMANDA[d.tipo]} demandas ${d.tipo === "ROSA" ? "rosas" : "azuis"} por membro.`);
      const nova = await tx.demanda.create({ data: { membroId: d.membroId, tipo: d.tipo, semestre, justificativa, autorId: ator.id, registranteNome: assinante.nome } });
      return nova.id;
    });
    return { ok: true, id };
  } catch (e) {
    return traduzir(e);
  }
}

/** Cancelar libera a vaga no limite. Autor, data e assinatura não mudam. */
export async function cancelarDemanda(id: string, ator: AtorGG): Promise<ResultadoRotina> {
  try {
    await exigirEditor(ator);
    const r = await db.demanda.updateMany({ where: { id, canceladaEm: null }, data: { canceladaEm: new Date() } });
    if (!r.count) throw new Recusa("NAO_ENCONTRADO");
    return { ok: true };
  } catch (e) {
    return traduzir(e);
  }
}

// ================================================================ agenda e ausências

export type EventoLinha = { id: string; titulo: string; data: string; horario: string | null; categoria: CategoriaEvento; areaId: string | null; area: string | null };

export async function listarEventos(de: string, ate: string): Promise<EventoLinha[]> {
  const es = await db.eventoAgenda.findMany({
    where: { deletadoEm: null, data: { gte: instanteDoPrazo(de), lte: instanteDoPrazo(ate) } },
    orderBy: [{ data: "asc" }, { horario: "asc" }],
    include: { area: { select: { nome: true } } },
  });
  return es.map((e) => ({ id: e.id, titulo: e.titulo, data: diaDoPrazo(e.data), horario: e.horario, categoria: e.categoria, areaId: e.areaId, area: e.area?.nome ?? null }));
}

export async function criarEvento(d: { titulo: string; data: string; horario: string | null; categoria: CategoriaEvento; areaId: string | null }, ator: AtorGG): Promise<ResultadoRotina<{ id: string }>> {
  try {
    await exigirEditor(ator);
    const titulo = d.titulo.trim();
    if (!titulo || titulo.length > 200 || !(d.categoria in ROTULO_EVENTO)) throw new Recusa("DADOS_INVALIDOS");
    if (d.horario && !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.horario)) throw new Recusa("DADOS_INVALIDOS");
    const e = await db.eventoAgenda.create({ data: { titulo, data: data(d.data), horario: d.horario || null, categoria: d.categoria, areaId: d.areaId || null, criadoPorId: ator.id } });
    return { ok: true, id: e.id };
  } catch (e) {
    return traduzir(e);
  }
}

export async function excluirEvento(id: string, ator: AtorGG): Promise<ResultadoRotina> {
  try {
    await exigirEditor(ator);
    const r = await db.eventoAgenda.updateMany({ where: { id, deletadoEm: null }, data: { deletadoEm: new Date() } });
    if (!r.count) throw new Recusa("NAO_ENCONTRADO");
    return { ok: true };
  } catch (e) {
    return traduzir(e);
  }
}

/** Registra só quem faltou (ninguém é marcado presente). Evento precisa já ter acontecido. */
export async function registrarAusencia(d: { eventoId: string; membroId: string; justificada: boolean; observacao: string | null }, ator: AtorGG): Promise<ResultadoRotina> {
  try {
    await exigirEditor(ator);
    const ev = await db.eventoAgenda.findFirst({ where: { id: d.eventoId, deletadoEm: null }, select: { data: true } });
    if (!ev) throw new Recusa("NAO_ENCONTRADO");
    if (diaDoPrazo(ev.data) > hoje()) throw new Recusa("EVENTO_FUTURO");
    const obs = d.observacao?.trim() || null;
    if (obs && obs.length > 500) throw new Recusa("DADOS_INVALIDOS");
    await db.ausencia.create({ data: { eventoId: d.eventoId, membroId: d.membroId, justificada: d.justificada, observacao: obs, registradoPorId: ator.id } });
    return { ok: true };
  } catch (e) {
    return traduzir(e);
  }
}

export type AusenciaLinha = { id: string; evento: string; data: string; membroId: string; membro: string; justificada: boolean; observacao: string | null };

/** Faltas: G&G e gestão veem todas; os demais, só as próprias (decisão §3.9). */
export async function listarAusencias(ator: AtorGG): Promise<AusenciaLinha[]> {
  const todas = temPapelMinimo(ator.papel, "GESTOR") || (await ehEditorGG(ator));
  const meu = todas ? null : await db.membro.findUnique({ where: { usuarioId: ator.id }, select: { id: true } });
  if (!todas && !meu) return [];
  const as = await db.ausencia.findMany({
    where: { evento: { deletadoEm: null }, ...(meu ? { membroId: meu.id } : {}) },
    orderBy: { evento: { data: "desc" } },
    include: { evento: { select: { titulo: true, data: true } }, membro: { select: { nome: true } } },
  });
  return as.map((a) => ({ id: a.id, evento: a.evento.titulo, data: diaDoPrazo(a.evento.data), membroId: a.membroId, membro: a.membro.nome, justificada: a.justificada, observacao: a.observacao }));
}

/** O evento atinge o membro? RG e evento sem área: IJ inteira (decisão §3.12); senão, quem ocupa posição na área do evento ou numa frente dela. */
function atinge(base: BaseOrg, e: { areaId: string | null; categoria: CategoriaEvento }, membroId: string): boolean {
  if (!e.areaId || e.categoria === "RG") return true;
  const alcance = descendentes(base.areas, e.areaId);
  return postosDe(base, membroId).some((p) => alcance.has(p.areaId));
}

/** Eventos que dizem respeito a um usuário (Minha Semana): os da IJ inteira e os das áreas dele. */
export async function eventosDoUsuario(usuarioId: string, de: string, ate: string): Promise<EventoLinha[]> {
  const [eventos, membro, base] = await Promise.all([listarEventos(de, ate), db.membro.findUnique({ where: { usuarioId }, select: { id: true } }), carregarBase()]);
  return eventos.filter((e) => !e.areaId || e.categoria === "RG" || (membro !== null && atinge(base, e, membro.id)));
}

/**
 * Lembrete no sino (cron): RG para todo mundo e reunião/evento de área para quem é da área,
 * `ANTECEDENCIA` dias antes. Uma vez por evento e pessoa (`lembrete_evento`).
 */
export const ANTECEDENCIA_LEMBRETE = 2;
export async function lembrarEventosGG(agora = new Date()): Promise<{ lembretes: number; refs: string[] }> {
  const dia = diaEmFuso(agora);
  const alvo = somarDias(dia, ANTECEDENCIA_LEMBRETE);
  const eventos = await db.eventoAgenda.findMany({ where: { deletadoEm: null, data: { gte: instanteDoPrazo(dia), lte: instanteDoPrazo(alvo) } }, select: { id: true, titulo: true, data: true, horario: true, categoria: true, areaId: true, lembretes: { select: { usuarioId: true } } } });
  if (!eventos.length) return { lembretes: 0, refs: [] };
  const [base, contas] = await Promise.all([carregarBase(), db.membro.findMany({ where: { usuarioId: { not: null }, status: "ATIVO", usuario: { ativo: true } }, select: { id: true, usuarioId: true } })]);
  let lembretes = 0;
  const refs: string[] = [];
  for (const e of eventos) {
    const ja = new Set(e.lembretes.map((l) => l.usuarioId));
    const para = contas.filter((c) => !ja.has(c.usuarioId!) && atinge(base, e, c.id));
    if (!para.length) continue;
    await db.lembreteEvento.createMany({ data: para.map((c) => ({ eventoId: e.id, usuarioId: c.usuarioId! })), skipDuplicates: true });
    const quando = `${diaDoPrazo(e.data).split("-").reverse().join("/")}${e.horario ? ` às ${e.horario}` : ""}`;
    const r = await emitirAvisos(para.map((c) => ({ usuarioId: c.usuarioId!, tipo: "LEMBRETE_GG" as const, titulo: `${ROTULO_EVENTO[e.categoria]}: ${e.titulo} em ${quando}` })));
    if (r.ok) lembretes += para.length;
    else {
      refs.push(r.ref);
      await db.lembreteEvento.deleteMany({ where: { eventoId: e.id, usuarioId: { in: para.map((c) => c.usuarioId!) } } });
    }
  }
  return { lembretes, refs };
}

// ================================================================ metas: ciclos, OKR, KPI, iniciativas

/** Indicadores que o CRM mede sozinho. `chave` vai em `kpi.fonte` / `resultado_chave.fonte`. */
export const FONTES_CRM = {
  receita_trimestre: { rotulo: "Receita fechada no trimestre (R$ mil)", descricao: "Soma do valor fechado dos cards ganhos desde o início do trimestre." },
  projetos_no_prazo: { rotulo: "Entregas no prazo (%)", descricao: "Entregas realizadas até a data prevista original, sobre as realizadas no ciclo." },
  checkins_vermelhos: { rotulo: "Check-ins vermelhos na semana", descricao: "Projetos com check-in VERMELHO na semana atual." },
} as const;
export type FonteCrm = keyof typeof FONTES_CRM;
export const ehFonteCrm = (f: string | null): f is FonteCrm => !!f && f in FONTES_CRM;

/** Valor de hoje de uma fonte do CRM. */
export async function medirFonte(f: FonteCrm, agora = new Date()): Promise<number> {
  const dia = diaEmFuso(agora);
  if (f === "receita_trimestre") {
    const mes = Number(dia.slice(5, 7));
    const inicio = new Date(`${dia.slice(0, 4)}-${String(mes - ((mes - 1) % 3)).padStart(2, "0")}-01T03:00:00Z`);
    const s = await db.projeto.aggregate({ where: { deletadoEm: null, dataGanho: { gte: inicio }, valorFechado: { not: null } }, _sum: { valorFechado: true } });
    return Math.round(Number(s._sum.valorFechado ?? 0) / 100) / 10;
  }
  if (f === "projetos_no_prazo") {
    const feitas = await db.projetoEntrega.findMany({ where: { canceladaEm: null, projeto: { deletadoEm: null }, realizadoEm: { not: null, gte: instanteDoPrazo(`${dia.slice(0, 4)}-01-01`) } }, select: { realizadoEm: true, previstoOriginal: true } });
    return feitas.length ? Math.round((feitas.filter((e) => e.realizadoEm! <= e.previstoOriginal).length / feitas.length) * 100) : 0;
  }
  // Mais de um check-in na semana vale e o último é o status (registrarCheckin): conta projetos, não linhas.
  const ultimos = await db.projetoCheckin.findMany({
    where: { semana: instanteDoPrazo(segundaDe(dia)), projeto: { deletadoEm: null } },
    orderBy: [{ projetoId: "asc" }, { em: "desc" }, { id: "desc" }],
    distinct: ["projetoId"],
    select: { status: true },
  });
  return ultimos.filter((c) => c.status === "VERMELHO").length;
}

/** Cron: grava a medição do dia de cada KPI e o valor atual de cada KR com fonte do CRM. */
export async function medirIndicadoresDoCrm(agora = new Date()): Promise<{ medidos: number }> {
  const dia = instanteDoPrazo(diaEmFuso(agora));
  const [kpis, krs] = await Promise.all([db.kpi.findMany({ where: { fonte: { not: null } }, select: { id: true, fonte: true } }), db.resultadoChave.findMany({ where: { fonte: { not: null } }, select: { id: true, fonte: true } })]);
  const cache = new Map<FonteCrm, number>();
  const valor = async (f: FonteCrm) => cache.get(f) ?? cache.set(f, await medirFonte(f, agora)).get(f)!;
  let medidos = 0;
  for (const k of kpis) {
    if (!ehFonteCrm(k.fonte)) continue;
    const v = await valor(k.fonte);
    await db.medicaoKpi.upsert({ where: { kpiId_data: { kpiId: k.id, data: dia } }, create: { kpiId: k.id, data: dia, valor: v }, update: { valor: v } });
    medidos++;
  }
  for (const r of krs) {
    if (!ehFonteCrm(r.fonte)) continue;
    await db.resultadoChave.update({ where: { id: r.id }, data: { atual: await valor(r.fonte) } });
    medidos++;
  }
  return { medidos };
}

export async function carregarMetas() {
  const [ciclos, objetivos, kpis, iniciativas, membros] = await Promise.all([
    db.ciclo.findMany({ orderBy: { inicio: "desc" } }),
    db.objetivo.findMany({ include: { resultados: { orderBy: { titulo: "asc" } }, responsavel: { select: { nome: true } }, ciclo: { select: { nome: true } } }, orderBy: { titulo: "asc" } }),
    db.kpi.findMany({ include: { medicoes: { orderBy: { data: "asc" }, take: 60 } }, orderBy: { titulo: "asc" } }),
    db.iniciativa.findMany({ include: { responsavel: { select: { nome: true } }, objetivo: { select: { titulo: true } }, kpi: { select: { titulo: true } } }, orderBy: [{ concluidaEm: "asc" }, { prazo: "asc" }] }),
    db.membro.findMany({ where: { status: { not: "INATIVO" } }, orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
  ]);
  const n = (d: Prisma.Decimal) => Number(d);
  return {
    ciclos: ciclos.map((c) => ({ id: c.id, nome: c.nome, inicio: diaDoPrazo(c.inicio), fim: diaDoPrazo(c.fim) })),
    objetivos: objetivos.map((o) => ({ id: o.id, titulo: o.titulo, ciclo: o.ciclo.nome, cicloId: o.cicloId, responsavel: o.responsavel.nome, resultados: o.resultados.map((r) => ({ id: r.id, titulo: r.titulo, unidade: r.unidade, inicial: n(r.inicial), meta: n(r.meta), atual: n(r.atual), fonte: r.fonte })) })),
    kpis: kpis.map((k) => ({ id: k.id, titulo: k.titulo, unidade: k.unidade, meta: n(k.meta), direcao: k.direcao, fonte: k.fonte, medicoes: k.medicoes.map((m) => ({ data: diaDoPrazo(m.data), valor: n(m.valor) })) })),
    iniciativas: iniciativas.map((i) => ({ id: i.id, titulo: i.titulo, responsavel: i.responsavel.nome, objetivo: i.objetivo?.titulo ?? null, kpi: i.kpi?.titulo ?? null, prazo: i.prazo ? diaDoPrazo(i.prazo) : null, concluida: i.concluidaEm !== null })),
    membros,
  };
}

const num = (v: number) => {
  if (!Number.isFinite(v) || Math.abs(v) >= 1e12) throw new Recusa("DADOS_INVALIDOS");
  return v;
};
const texto = (t: string, max = 200) => {
  const s = t.trim();
  if (!s || s.length > max) throw new Recusa("DADOS_INVALIDOS");
  return s;
};
async function editando<T>(ator: AtorGG, corpo: () => Promise<T>): Promise<ResultadoRotina<{ id?: string }>> {
  try {
    await exigirEditor(ator);
    const r = await corpo();
    return { ok: true, ...(typeof r === "string" ? { id: r } : {}) };
  } catch (e) {
    return traduzir(e);
  }
}

export const criarCiclo = (d: { nome: string; inicio: string; fim: string }, ator: AtorGG) =>
  editando(ator, async () => {
    if (d.fim < d.inicio) throw new Recusa("DADOS_INVALIDOS");
    return (await db.ciclo.create({ data: { nome: texto(d.nome, 60), inicio: data(d.inicio), fim: data(d.fim) } })).id;
  });

export const criarObjetivo = (d: { titulo: string; cicloId: string; responsavelId: string }, ator: AtorGG) =>
  editando(ator, async () => (await db.objetivo.create({ data: { titulo: texto(d.titulo), cicloId: d.cicloId, responsavelId: d.responsavelId } })).id);

export const criarResultado = (d: { objetivoId: string; titulo: string; unidade: string; inicial: number; meta: number; fonte: string | null }, ator: AtorGG) =>
  editando(ator, async () => {
    if (d.fonte && !ehFonteCrm(d.fonte)) throw new Recusa("DADOS_INVALIDOS");
    const valorFonte = d.fonte ? await medirFonte(d.fonte as FonteCrm) : null;
    return (await db.resultadoChave.create({ data: { objetivoId: d.objetivoId, titulo: texto(d.titulo), unidade: d.unidade.trim().slice(0, 30), inicial: num(d.inicial), meta: num(d.meta), atual: valorFonte ?? num(d.inicial), fonte: d.fonte || null } })).id;
  });

export const atualizarResultado = (id: string, atual: number, ator: AtorGG) =>
  editando(ator, async () => {
    const r = await db.resultadoChave.findUnique({ where: { id }, select: { fonte: true } });
    if (!r) throw new Recusa("NAO_ENCONTRADO");
    if (r.fonte) throw new Recusa("FONTE_AUTOMATICA");
    await db.resultadoChave.update({ where: { id }, data: { atual: num(atual) } });
  });

export const criarKpi = (d: { titulo: string; unidade: string; meta: number; direcao: DirecaoKpi; fonte: string | null }, ator: AtorGG) =>
  editando(ator, async () => {
    if (d.fonte && !ehFonteCrm(d.fonte)) throw new Recusa("DADOS_INVALIDOS");
    const k = await db.kpi.create({ data: { titulo: texto(d.titulo), unidade: texto(d.unidade, 30), meta: num(d.meta), direcao: d.direcao, fonte: d.fonte || null } });
    if (d.fonte) await db.medicaoKpi.create({ data: { kpiId: k.id, data: instanteDoPrazo(hoje()), valor: await medirFonte(d.fonte as FonteCrm) } });
    return k.id;
  });

export const registrarMedicao = (kpiId: string, dia: string, valor: number, ator: AtorGG) =>
  editando(ator, async () => {
    const k = await db.kpi.findUnique({ where: { id: kpiId }, select: { fonte: true } });
    if (!k) throw new Recusa("NAO_ENCONTRADO");
    if (k.fonte) throw new Recusa("FONTE_AUTOMATICA");
    if (dia > hoje()) throw new Recusa("DADOS_INVALIDOS");
    try {
      await db.medicaoKpi.create({ data: { kpiId, data: data(dia), valor: num(valor) } });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") throw new Recusa("JA_MEDIDO");
      throw e;
    }
  });

export const criarIniciativa = (d: { titulo: string; objetivoId: string | null; kpiId: string | null; responsavelId: string; prazo: string | null }, ator: AtorGG) =>
  editando(ator, async () => (await db.iniciativa.create({ data: { titulo: texto(d.titulo), objetivoId: d.objetivoId || null, kpiId: d.kpiId || null, responsavelId: d.responsavelId, prazo: d.prazo ? data(d.prazo) : null } })).id);

export const concluirIniciativa = (id: string, concluida: boolean, ator: AtorGG) =>
  editando(ator, async () => {
    await db.iniciativa.update({ where: { id }, data: { concluidaEm: concluida ? new Date() : null } });
  });

// ================================================================ papéis e processos (RACI)

export async function carregarRaci() {
  const [processos, cargos] = await Promise.all([
    db.processo.findMany({ where: { ativo: true }, orderBy: { nome: "asc" }, include: { raci: true } }),
    db.cargoOrg.findMany({ where: { ativo: true }, orderBy: [{ categoria: "asc" }, { nome: "asc" }], select: { id: true, nome: true, categoria: true } }),
  ]);
  return { cargos, processos: processos.map((p) => ({ id: p.id, nome: p.nome, papeis: Object.fromEntries(p.raci.map((r) => [r.cargoId, r.papel])) as Record<string, PapelRaci> })) };
}

export const criarProcesso = (nome: string, ator: AtorGG) => editando(ator, async () => (await db.processo.create({ data: { nome: texto(nome) } })).id);

/** Define o papel de um cargo num processo (null limpa). Um A por processo: o A anterior vira R, na mesma transação. */
export const definirRaci = (processoId: string, cargoId: string, papel: PapelRaci | null, ator: AtorGG) =>
  editando(ator, async () => {
    await db.$transaction(async (tx) => {
      if (papel === "A") await tx.raci.updateMany({ where: { processoId, papel: "A", NOT: { cargoId } }, data: { papel: "R" } });
      if (papel === null) await tx.raci.deleteMany({ where: { processoId, cargoId } });
      else await tx.raci.upsert({ where: { processoId_cargoId: { processoId, cargoId } }, create: { processoId, cargoId, papel }, update: { papel } });
    });
  });

/** Áreas de G&G (para quem é das frentes ver os eventos da área). Reexporta para as telas. */
export { areasGG };

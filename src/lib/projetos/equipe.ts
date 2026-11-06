/**
 * Equipe do projeto: quem trabalha em cada projeto, com função e período.
 * É a "escala" que as specs do hub (§4.5) e do kanban interno (§5) esperavam:
 * decide quem vê as tarefas do projeto e quem pode recebê-las (`auth/areas.ts`).
 *
 * - Período [inicio, fim) em dias; sair da equipe encerra (fim = hoje), não apaga.
 * - Uma vaga aberta por pessoa e projeto (índice parcial).
 * - Só card no quadro de Projetos. Quem monta: diretoria, admin, GP e responsável do card.
 * - Aviso no sino para quem entra (nunca para quem se põe), depois do commit.
 */
import type { FuncaoProjeto } from "@prisma/client";
import { podeEditarEquipe, podeVerTarefas, type EscalaProjeto, type PessoaComLado } from "@/lib/auth/areas";
import { emitirAvisos } from "@/lib/avisos/avisos";
import { diaDoPrazo, instanteDoPrazo } from "@/lib/calendario/semana";
import { db } from "@/lib/db";
import { FUNCOES, ROTULO_FUNCAO } from "@/lib/gg/modelo";
import { diaEmFuso } from "./aging";

export type AtorEquipe = PessoaComLado & { id: string; nome: string };
export type ErroEquipe = "SEM_PERMISSAO" | "PROJETO_NAO_ENCONTRADO" | "PESSOA_INVALIDA" | "JA_NA_EQUIPE" | "NAO_ENCONTRADO" | "DADOS_INVALIDOS";
export const MENSAGEM_ERRO_EQUIPE: Record<ErroEquipe, string> = {
  SEM_PERMISSAO: "Só a diretoria, o GP e o responsável do projeto montam a equipe.",
  PROJETO_NAO_ENCONTRADO: "Projeto não encontrado no quadro de Projetos.",
  PESSOA_INVALIDA: "Essa pessoa não pode entrar na equipe (precisa estar ativa e no time de projetos).",
  JA_NA_EQUIPE: "Essa pessoa já está na equipe.",
  NAO_ENCONTRADO: "Essa pessoa não está na equipe.",
  DADOS_INVALIDOS: "Dados inválidos.",
};
type R<T = object> = ({ ok: true } & T) | { ok: false; erro: ErroEquipe };

type Cliente = Pick<typeof db, "projeto" | "projetoMembro">;

/** Equipe aberta hoje + responsável do card + GP do handoff. null = card fora do quadro de Projetos. */
export async function escalaDoProjeto(projetoId: string, cliente: Cliente = db, hoje = diaEmFuso(new Date())): Promise<EscalaProjeto | null> {
  const p = await cliente.projeto.findFirst({
    where: { id: projetoId, deletadoEm: null },
    select: { responsavelId: true, pipeline: { select: { chave: true } }, handoff: { select: { gpProjetoId: true } } },
  });
  if (!p || p.pipeline.chave !== "projetos") return null;
  const dia = instanteDoPrazo(hoje);
  const equipe = await cliente.projetoMembro.findMany({ where: { projetoId, inicio: { lte: dia }, OR: [{ fim: null }, { fim: { gt: dia } }] }, select: { usuarioId: true } });
  return { equipe: equipe.map((e) => e.usuarioId), responsavelId: p.responsavelId, gpId: p.handoff?.gpProjetoId ?? null };
}

export type MembroEquipe = { id: string; usuarioId: string; nome: string; fotoEm: number | null; ativo: boolean; funcao: FuncaoProjeto; inicio: string; fim: string | null };

export async function listarEquipe(projetoId: string): Promise<{ atuais: MembroEquipe[]; antigos: MembroEquipe[] }> {
  const hoje = diaEmFuso(new Date());
  const linhas = await db.projetoMembro.findMany({
    where: { projetoId },
    orderBy: [{ inicio: "asc" }],
    select: { id: true, usuarioId: true, funcao: true, inicio: true, fim: true, usuario: { select: { nome: true, ativo: true, foto: { select: { atualizadoEm: true } } } } },
  });
  const todos = linhas.map((l) => ({
    id: l.id,
    usuarioId: l.usuarioId,
    nome: l.usuario.nome,
    fotoEm: l.usuario.foto?.atualizadoEm.getTime() ?? null,
    ativo: l.usuario.ativo,
    funcao: l.funcao,
    inicio: diaDoPrazo(l.inicio),
    fim: l.fim ? diaDoPrazo(l.fim) : null,
  }));
  const ordem = (m: MembroEquipe) => FUNCOES.indexOf(m.funcao);
  return {
    atuais: todos.filter((m) => !m.fim || m.fim > hoje).sort((a, b) => ordem(a) - ordem(b) || a.nome.localeCompare(b.nome, "pt-BR")),
    antigos: todos.filter((m) => m.fim && m.fim <= hoje).sort((a, b) => (b.fim ?? "").localeCompare(a.fim ?? "")),
  };
}

/** Quem pode entrar na equipe: ativo e no time de projetos (mesmo portão das tarefas). */
export async function candidatosEquipe(): Promise<{ id: string; nome: string }[]> {
  const us = await db.usuario.findMany({ where: { ativo: true }, orderBy: { nome: "asc" }, select: { id: true, nome: true, papel: true, area: true, cargos: true } });
  return us.filter((u) => podeVerTarefas(u)).map((u) => ({ id: u.id, nome: u.nome }));
}

async function conferir(projetoId: string, ator: AtorEquipe): Promise<{ ok: true; escala: EscalaProjeto; titulo: string } | { ok: false; erro: ErroEquipe }> {
  const escala = await escalaDoProjeto(projetoId);
  if (!escala) return { ok: false, erro: "PROJETO_NAO_ENCONTRADO" };
  if (!podeEditarEquipe(ator, escala)) return { ok: false, erro: "SEM_PERMISSAO" };
  const p = await db.projeto.findUniqueOrThrow({ where: { id: projetoId }, select: { titulo: true } });
  return { ok: true, escala, titulo: p.titulo };
}

export async function adicionarAEquipe(projetoId: string, usuarioId: string, funcao: FuncaoProjeto, ator: AtorEquipe): Promise<R> {
  if (!FUNCOES.includes(funcao)) return { ok: false, erro: "DADOS_INVALIDOS" };
  const c = await conferir(projetoId, ator);
  if (!c.ok) return c;
  const u = await db.usuario.findFirst({ where: { id: usuarioId, ativo: true }, select: { papel: true, area: true, cargos: true } });
  if (!u || !podeVerTarefas(u)) return { ok: false, erro: "PESSOA_INVALIDA" };
  try {
    await db.projetoMembro.create({ data: { projetoId, usuarioId, funcao, inicio: instanteDoPrazo(diaEmFuso(new Date())) } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return { ok: false, erro: "JA_NA_EQUIPE" };
    throw e;
  }
  if (usuarioId !== ator.id)
    await emitirAvisos([{ usuarioId, tipo: "EQUIPE_PROJETO", titulo: `${ator.nome} te colocou na equipe de ${c.titulo} como ${ROTULO_FUNCAO[funcao]}`, projetoId }]);
  return { ok: true };
}

export async function mudarFuncao(projetoId: string, membroEquipeId: string, funcao: FuncaoProjeto, ator: AtorEquipe): Promise<R> {
  if (!FUNCOES.includes(funcao)) return { ok: false, erro: "DADOS_INVALIDOS" };
  const c = await conferir(projetoId, ator);
  if (!c.ok) return c;
  const r = await db.projetoMembro.updateMany({ where: { id: membroEquipeId, projetoId, fim: null }, data: { funcao } });
  return r.count ? { ok: true } : { ok: false, erro: "NAO_ENCONTRADO" };
}

/** Sai da equipe hoje. As tarefas dela continuam; quem é responsável sem estar escalado aparece para reatribuir. */
export async function tirarDaEquipe(projetoId: string, membroEquipeId: string, ator: AtorEquipe): Promise<R> {
  const c = await conferir(projetoId, ator);
  if (!c.ok) return c;
  const r = await db.projetoMembro.updateMany({ where: { id: membroEquipeId, projetoId, fim: null }, data: { fim: instanteDoPrazo(diaEmFuso(new Date())) } });
  return r.count ? { ok: true } : { ok: false, erro: "NAO_ENCONTRADO" };
}

export type ProjetoDaPessoa = { projetoId: string; titulo: string; funcao: FuncaoProjeto; inicio: string; fim: string | null; aberto: boolean };

/** Projetos de uma pessoa (ficha do membro e carga): atuais primeiro. */
export async function projetosDe(usuarioId: string): Promise<ProjetoDaPessoa[]> {
  const hoje = diaEmFuso(new Date());
  const ls = await db.projetoMembro.findMany({
    where: { usuarioId, projeto: { deletadoEm: null } },
    orderBy: { inicio: "desc" },
    select: { projetoId: true, funcao: true, inicio: true, fim: true, projeto: { select: { titulo: true } } },
  });
  return ls
    .map((l) => {
      const fim = l.fim ? diaDoPrazo(l.fim) : null;
      return { projetoId: l.projetoId, titulo: l.projeto.titulo, funcao: l.funcao, inicio: diaDoPrazo(l.inicio), fim, aberto: !fim || fim > hoje };
    })
    .sort((a, b) => Number(b.aberto) - Number(a.aberto));
}

/** Carga atual por pessoa: projetos abertos (fora da lixeira e de fase terminal) e tarefas abertas (de projeto fora da lixeira). */
export async function cargaPorPessoa(usuarioIds: string[]): Promise<Map<string, { projetos: number; tarefas: number }>> {
  const hoje = instanteDoPrazo(diaEmFuso(new Date()));
  const [eq, ts] = await Promise.all([
    db.projetoMembro.groupBy({ by: ["usuarioId"], where: { usuarioId: { in: usuarioIds }, OR: [{ fim: null }, { fim: { gt: hoje } }], projeto: { deletadoEm: null, fase: { isTerminal: false } } }, _count: true }),
    db.tarefa.groupBy({ by: ["responsavelId"], where: { responsavelId: { in: usuarioIds }, deletadoEm: null, status: { notIn: ["FEITA", "CANCELADA"] }, projeto: { deletadoEm: null } }, _count: true }),
  ]);
  const m = new Map<string, { projetos: number; tarefas: number }>();
  for (const id of usuarioIds) m.set(id, { projetos: 0, tarefas: 0 });
  for (const e of eq) m.get(e.usuarioId)!.projetos = e._count;
  for (const t of ts) if (t.responsavelId) m.get(t.responsavelId)!.tarefas = t._count;
  return m;
}

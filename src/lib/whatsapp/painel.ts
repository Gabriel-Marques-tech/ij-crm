/**
 * Painel de mensagens (GAB-41, Gestão → WhatsApp; GESTOR+). Leituras baratas
 * (uma consulta por bloco, sem N+1, fila paginada) e as duas ações que mudam
 * dado: "Resolver manualmente" e "Vincular remetente a usuário". O
 * reprocessamento está em `reprocessar.ts` (mesma função do cron).
 *
 * O texto das mensagens aparece aqui (dentro do app é permitido); remetente
 * desconhecido NUNCA tem conteúdo guardado e o telefone/LID sai mascarado.
 */
import type { Papel, Prisma, StatusMensagem } from "@prisma/client";
import { podeAtribuirPapel } from "@/lib/auth/papeis";
import { db } from "@/lib/db";
import { travarPipelines } from "@/lib/fases/fases";
import { ErroDeRegra, type ErroOportunidade } from "@/lib/oportunidades/erros";
import { criarCardTravado } from "@/lib/oportunidades/oportunidades";
import { PIPELINE_VENDAS } from "@/lib/oportunidades/terminal-regras";
import { mascararJid, mascararTelefone } from "./mascarar";

export const POR_PAGINA_FILA = 20;
const STATUS_FILA: StatusMensagem[] = ["FALHA", "PENDENTE_REVISAO"];
const DIAS_CONTADORES = 14;
const LIMITE_RECENTES = 50;
const LIMITE_DESCONHECIDOS = 50;

// ---------------------------------------------------------------- leitura

export type ItemFila = {
  id: string;
  status: StatusMensagem;
  texto: string;
  remetente: string;
  recebidaEm: Date;
  tentativas: number;
  erro: string | null;
  semTag: boolean;
  resultadoLlm: Prisma.JsonValue | null;
};

export async function listarFila(pagina: number): Promise<{ itens: ItemFila[]; total: number; pagina: number; paginas: number }> {
  const where = { status: { in: STATUS_FILA } };
  const total = await db.mensagemBruta.count({ where });
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA_FILA));
  const p = Number.isInteger(pagina) ? Math.min(Math.max(1, pagina), paginas) : 1;
  const linhas = await db.mensagemBruta.findMany({
    where,
    orderBy: [{ recebidaEm: "desc" }, { id: "desc" }],
    skip: (p - 1) * POR_PAGINA_FILA,
    take: POR_PAGINA_FILA,
    select: {
      id: true,
      status: true,
      texto: true,
      recebidaEm: true,
      tentativas: true,
      erro: true,
      semTag: true,
      resultadoLlm: true,
      remetenteTelefone: true,
      remetenteUsuario: { select: { nome: true } },
    },
  });
  return {
    total,
    pagina: p,
    paginas,
    itens: linhas.map((l) => ({
      id: l.id,
      status: l.status,
      texto: l.texto,
      remetente: l.remetenteUsuario?.nome ?? (l.remetenteTelefone ? mascararTelefone(l.remetenteTelefone) : "—"),
      recebidaEm: l.recebidaEm,
      tentativas: l.tentativas,
      erro: l.erro,
      semTag: l.semTag,
      resultadoLlm: l.resultadoLlm,
    })),
  };
}

export type Desconhecido = { id: string; tipo: "telefone" | "lid"; mascarado: string; total: number; ultimaVez: Date };
export type Recente = {
  id: string;
  texto: string;
  remetente: string;
  recebidaEm: Date;
  semTag: boolean;
  resolvidaPor: string | null;
  card: { id: string; titulo: string; excluido: boolean } | null;
};
export type Painel = {
  contagem: Partial<Record<StatusMensagem, number>>;
  contadores: { dia: string; total: number; naoClassificadas: number }[];
  desconhecidos: Desconhecido[];
  recentes: Recente[];
};

/** Tudo do painel menos a fila: 4 consultas, em paralelo. */
export async function carregarPainel(): Promise<Painel> {
  const [grupos, contadores, desconhecidos, recentes] = await Promise.all([
    db.mensagemBruta.groupBy({ by: ["status"], where: { status: { in: STATUS_FILA } }, _count: { _all: true } }),
    db.contadorDescartadas.findMany({ orderBy: { dia: "desc" }, take: DIAS_CONTADORES }),
    db.remetenteDesconhecido.findMany({ orderBy: { ultimaVez: "desc" }, take: LIMITE_DESCONHECIDOS }),
    db.mensagemBruta.findMany({
      where: { status: "PROCESSADA" },
      orderBy: [{ atualizadoEm: "desc" }, { id: "desc" }],
      take: LIMITE_RECENTES,
      select: {
        id: true,
        texto: true,
        recebidaEm: true,
        semTag: true,
        remetenteUsuario: { select: { nome: true } },
        resolvidaPor: { select: { nome: true } },
        timeline: {
          where: { tipo: "MENSAGEM_WHATSAPP" },
          orderBy: { em: "desc" },
          take: 1,
          select: { oportunidade: { select: { id: true, titulo: true, deletadoEm: true } } },
        },
      },
    }),
  ]);
  return {
    contagem: Object.fromEntries(grupos.map((g) => [g.status, g._count._all])),
    contadores: contadores.map((c) => ({ dia: c.dia.toISOString().slice(0, 10), total: c.total, naoClassificadas: c.naoClassificadas })),
    desconhecidos: desconhecidos.map((d) => ({
      id: d.id,
      tipo: d.lid ? ("lid" as const) : ("telefone" as const),
      mascarado: d.lid ? mascararJid(d.lid) : mascararTelefone(d.telefone ?? ""),
      total: d.total,
      ultimaVez: d.ultimaVez,
    })),
    recentes: recentes.map((r) => {
      const op = r.timeline[0]?.oportunidade;
      return {
        id: r.id,
        texto: r.texto,
        remetente: r.remetenteUsuario?.nome ?? "—",
        recebidaEm: r.recebidaEm,
        semTag: r.semTag,
        resolvidaPor: r.resolvidaPor?.nome ?? null,
        card: op ? { id: op.id, titulo: op.titulo, excluido: op.deletadoEm !== null } : null,
      };
    }),
  };
}

/** Opções dos diálogos: fases abertas de Vendas (criar card) e usuários ativos (vincular remetente). */
export async function opcoesDoPainel(): Promise<{ fases: { id: string; nome: string }[]; usuarios: { id: string; nome: string }[] }> {
  const [fases, usuarios] = await Promise.all([
    db.fase.findMany({
      where: { pipeline: { chave: PIPELINE_VENDAS }, arquivadaEm: null, isTerminal: false },
      orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }],
      select: { id: true, nome: true },
    }),
    db.usuario.findMany({ where: { ativo: true }, orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
  ]);
  return { fases, usuarios };
}

/** Autocomplete do "vincular a card existente": cards vivos de Vendas por título. */
export async function buscarCardsParaVincular(q: string): Promise<{ id: string; nome: string; detalhe: string }[]> {
  const termo = q.trim().slice(0, 100);
  if (!termo) return [];
  const ops = await db.oportunidade.findMany({
    // Só Vendas, como o "criar card" do mesmo diálogo.
    where: { deletadoEm: null, pipeline: { chave: PIPELINE_VENDAS }, titulo: { contains: termo, mode: "insensitive" } },
    orderBy: { atualizadoEm: "desc" },
    take: 10,
    select: { id: true, titulo: true, fase: { select: { nome: true } }, pipeline: { select: { nome: true } } },
  });
  return ops.map((o) => ({ id: o.id, nome: o.titulo, detalhe: `${o.pipeline.nome} · ${o.fase.nome}` }));
}

// ---------------------------------------------------------------- resolver manualmente

export type ErroResolver = "MENSAGEM_NAO_ENCONTRADA" | "MENSAGEM_JA_RESOLVIDA" | "MENSAGEM_EM_PROCESSAMENTO" | ErroOportunidade;
export type AlvoResolver = { tipo: "CRIAR"; titulo: string; faseId: string } | { tipo: "VINCULAR"; oportunidadeId: string };

class Recusa extends Error {
  constructor(readonly erro: ErroResolver) {
    super(erro);
  }
}

/**
 * Fecha uma mensagem da fila sem a LLM: cria card (núcleo de oportunidades,
 * responsável = vendedor que mandou, se ativo) ou liga a um card existente;
 * Timeline `MENSAGEM_WHATSAPP` com o texto, autor = quem resolveu; mensagem
 * vira `PROCESSADA` com `resolvida_por_id`/`resolvida_em`. A linha da
 * mensagem é travada primeiro (`FOR UPDATE`, mesma ordem do pipeline): dois
 * cliques ou reprocessamento concorrente nunca fazem dois cards. Sem resposta no grupo.
 */
export async function resolverManualmente(
  mensagemId: string,
  alvo: AlvoResolver,
  por: { id: string },
): Promise<{ ok: true; oportunidadeId: string } | { ok: false; erro: ErroResolver }> {
  try {
    const oportunidadeId = await db.$transaction(async (tx) => {
      const [m] = await tx.$queryRaw<{ status: StatusMensagem; texto: string; remetente_usuario_id: string | null }[]>`
        SELECT status::text AS status, texto, remetente_usuario_id FROM mensagem_bruta WHERE id = ${mensagemId} FOR UPDATE`;
      if (!m) throw new Recusa("MENSAGEM_NAO_ENCONTRADA");
      if (m.status === "PROCESSANDO" || m.status === "RECEBIDA") throw new Recusa("MENSAGEM_EM_PROCESSAMENTO");
      if (!STATUS_FILA.includes(m.status)) throw new Recusa("MENSAGEM_JA_RESOLVIDA");

      const agora = new Date();
      let id: string;
      if (alvo.tipo === "CRIAR") {
        const fase = await tx.fase.findUnique({ where: { id: alvo.faseId }, select: { pipelineId: true } });
        if (!fase) throw new ErroDeRegra("FASE_NAO_ENCONTRADA");
        if (!(await travarPipelines(tx, [fase.pipelineId]))) throw new ErroDeRegra("PIPELINE_NAO_ENCONTRADO");
        const vendedor = m.remetente_usuario_id
          ? await tx.usuario.findFirst({ where: { id: m.remetente_usuario_id, ativo: true }, select: { id: true } })
          : null;
        id = await criarCardTravado(
          tx,
          { pipelineId: fase.pipelineId, faseId: alvo.faseId, titulo: alvo.titulo, responsavelId: vendedor?.id ?? por.id, via: "UI", agora },
          por,
        );
      } else {
        const op = await tx.oportunidade.findFirst({ where: { id: alvo.oportunidadeId, deletadoEm: null, pipeline: { chave: PIPELINE_VENDAS } }, select: { id: true } });
        if (!op) throw new ErroDeRegra("CARD_NAO_ENCONTRADO");
        id = op.id;
      }
      await tx.timeline.create({
        data: {
          oportunidadeId: id,
          tipo: "MENSAGEM_WHATSAPP",
          usuarioId: por.id,
          mensagemBrutaId: mensagemId,
          em: new Date(agora.getTime() + 1),
          payload: { texto: m.texto, resolvidaManualmente: true },
        },
      });
      await tx.mensagemBruta.update({ where: { id: mensagemId }, data: { status: "PROCESSADA", resolvidaPorId: por.id, resolvidaEm: agora } });
      return id;
    });
    return { ok: true, oportunidadeId };
  } catch (e) {
    if (e instanceof Recusa) return { ok: false, erro: e.erro };
    if (e instanceof ErroDeRegra) return { ok: false, erro: e.erro };
    throw e;
  }
}

// ---------------------------------------------------------------- vincular remetente

export type ErroVincular =
  | "REMETENTE_NAO_ENCONTRADO"
  | "USUARIO_NAO_ENCONTRADO"
  | "USUARIO_INATIVO"
  | "PAPEL_NAO_PERMITIDO"
  | "USUARIO_JA_TEM_TELEFONE"
  | "USUARIO_JA_TEM_LID"
  | "IDENTIFICADOR_EM_USO"
  /** O usuário (telefone, LID, papel ou ativo) mudou entre a leitura e a escrita. */
  | "CONFLITO_CONCORRENTE";

class UsuarioMudou extends Error {}

/**
 * Grava o telefone (`telefone_whatsapp`) ou o LID (`whatsapp_lid`) do
 * remetente desconhecido no usuário e apaga a linha do painel. Não
 * sobrescreve um telefone/LID diferente já cadastrado (troca é em Usuários).
 * Gestor não mexe em admin (mesma regra de `atualizarUsuario`).
 */
export async function vincularRemetente(
  remetenteId: string,
  usuarioId: string,
  por: { id: string; papel: Papel },
): Promise<{ ok: true } | { ok: false; erro: ErroVincular }> {
  const d = await db.remetenteDesconhecido.findUnique({ where: { id: remetenteId } });
  if (!d) return { ok: false, erro: "REMETENTE_NAO_ENCONTRADO" };
  const u = await db.usuario.findUnique({ where: { id: usuarioId }, select: { id: true, papel: true, ativo: true, telefoneWhatsapp: true, whatsappLid: true } });
  if (!u) return { ok: false, erro: "USUARIO_NAO_ENCONTRADO" };
  if (u.id !== por.id && !podeAtribuirPapel(por.papel, u.papel)) return { ok: false, erro: "PAPEL_NAO_PERMITIDO" };
  if (!u.ativo) return { ok: false, erro: "USUARIO_INATIVO" };
  if (d.telefone && u.telefoneWhatsapp && u.telefoneWhatsapp !== d.telefone) return { ok: false, erro: "USUARIO_JA_TEM_TELEFONE" };
  if (d.lid && u.whatsappLid && u.whatsappLid !== d.lid) return { ok: false, erro: "USUARIO_JA_TEM_LID" };
  try {
    await db.$transaction(async (tx) => {
      // Atômico: o where confere tudo o que foi checado acima (papel, ativo, telefone e
      // LID lidos). Mudou no meio (outro vínculo, desativado, promovido) → conflito.
      const r = await tx.usuario.updateMany({
        where: { id: u.id, papel: u.papel, ativo: true, telefoneWhatsapp: u.telefoneWhatsapp, whatsappLid: u.whatsappLid },
        data: { ...(d.telefone ? { telefoneWhatsapp: d.telefone } : {}), ...(d.lid ? { whatsappLid: d.lid } : {}) },
      });
      if (r.count === 0) throw new UsuarioMudou();
      const apagado = await tx.remetenteDesconhecido.deleteMany({ where: { id: d.id } });
      if (apagado.count === 0) throw new UsuarioMudou(); // outro gestor vinculou este remetente agora

    });
  } catch (e) {
    if (e instanceof UsuarioMudou) return { ok: false, erro: "CONFLITO_CONCORRENTE" };
    if ((e as { code?: string })?.code === "P2002") return { ok: false, erro: "IDENTIFICADOR_EM_USO" };
    throw e;
  }
  return { ok: true };
}

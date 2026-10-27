/**
 * Oportunidades candidatas para o contexto da LLM (GAB-38; design doc §4.3
 * "Alvo de ATUALIZAR"). Só LEITURA — não é sessão de conversa:
 * - cards de `vendas` dos contatos/empresas casados por identificador exato
 *   (abertos e fechados: as regras de alvo precisam saber de "só terminais");
 * - as últimas 3 oportunidades que o remetente tocou (Timeline com o usuário
 *   dele) nos 30 min antes da mensagem — cobre mensagens picadas;
 * - o card da confirmação do bot que a mensagem responde (`MensagemEnviada`).
 *
 * WhatsApp só mexe em `vendas` na v1: `projetos` nunca entra.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { OportunidadeCandidata } from "@/lib/llm/prompts/extracao.v2";
import { PIPELINE_VENDAS } from "@/lib/oportunidades/terminal-regras";
import type { ViaCandidata } from "./alvo";

type Cliente = Prisma.TransactionClient | typeof db;

export const JANELA_RECENTES_MS = 30 * 60 * 1000;
export const MAX_RECENTES = 3;
/** Por contato/empresa: os mais recentes bastam para a LLM e para as regras. */
const MAX_POR_IDENTIDADE = 10;

const CARD_VIVO_EM_VENDAS = { deletadoEm: null, pipeline: { chave: PIPELINE_VENDAS } } as const;

/**
 * Card da confirmação respondida, se a mensagem é reply a uma confirmação do
 * bot e o card continua vivo em vendas. É o que fixa o alvo sem a LLM.
 */
export async function alvoDaResposta(respondendoEventoId: string | null, cliente: Cliente = db): Promise<string | null> {
  if (!respondendoEventoId) return null;
  const enviada = await cliente.mensagemEnviada.findUnique({ where: { eventoId: respondendoEventoId }, select: { oportunidadeId: true } });
  if (!enviada?.oportunidadeId) return null;
  const card = await cliente.oportunidade.findFirst({ where: { id: enviada.oportunidadeId, ...CARD_VIVO_EM_VENDAS }, select: { id: true } });
  return card?.id ?? null;
}

export async function oportunidadesCandidatas(
  e: {
    remetenteUsuarioId: string | null;
    recebidaEm: Date;
    contatoIds: string[];
    empresas: { id: string; via: "cnpj" | "dominio" }[];
    alvoResposta: string | null;
  },
  cliente: Cliente = db,
): Promise<OportunidadeCandidata[]> {
  const vias = new Map<string, Set<ViaCandidata>>();
  const marcar = (id: string, via: ViaCandidata) => (vias.get(id) ?? vias.set(id, new Set()).get(id)!).add(via);

  if (e.alvoResposta) marcar(e.alvoResposta, "resposta");

  if (e.contatoIds.length) {
    const porContato = await cliente.oportunidade.findMany({
      where: { ...CARD_VIVO_EM_VENDAS, contatoId: { in: e.contatoIds } },
      orderBy: { atualizadoEm: "desc" },
      take: MAX_POR_IDENTIDADE,
      select: { id: true },
    });
    for (const o of porContato) marcar(o.id, "contato");
  }
  for (const via of ["cnpj", "dominio"] as const) {
    const ids = e.empresas.filter((x) => x.via === via).map((x) => x.id);
    if (!ids.length) continue;
    const porEmpresa = await cliente.oportunidade.findMany({
      where: { ...CARD_VIVO_EM_VENDAS, empresaId: { in: ids } },
      orderBy: { atualizadoEm: "desc" },
      take: MAX_POR_IDENTIDADE,
      select: { id: true },
    });
    for (const o of porEmpresa) marcar(o.id, via === "cnpj" ? "empresa" : "dominio");
  }

  if (e.remetenteUsuarioId) {
    const toques = await cliente.timeline.findMany({
      where: {
        usuarioId: e.remetenteUsuarioId,
        em: { gte: new Date(e.recebidaEm.getTime() - JANELA_RECENTES_MS) },
        oportunidade: CARD_VIVO_EM_VENDAS,
      },
      orderBy: [{ em: "desc" }, { id: "desc" }],
      take: 50,
      select: { oportunidadeId: true },
    });
    const recentes = [...new Set(toques.map((t) => t.oportunidadeId))].slice(0, MAX_RECENTES);
    for (const id of recentes) marcar(id, "recente");
  }

  if (vias.size === 0) return [];
  const ids = [...vias.keys()];
  const [cards, ultimos] = await Promise.all([
    cliente.oportunidade.findMany({
      where: { id: { in: ids }, ...CARD_VIVO_EM_VENDAS },
      select: { id: true, titulo: true, criadoEm: true, fase: { select: { nome: true, isTerminal: true } } },
    }),
    cliente.timeline.groupBy({ by: ["oportunidadeId"], where: { oportunidadeId: { in: ids } }, _max: { em: true } }),
  ]);
  const tocada = new Map(ultimos.map((u) => [u.oportunidadeId, u._max.em]));
  return cards
    .map((c) => ({
      id: c.id,
      titulo: c.titulo,
      faseNome: c.fase.nome,
      terminal: c.fase.isTerminal,
      tocadaEm: tocada.get(c.id) ?? c.criadoEm,
      via: [...vias.get(c.id)!],
    }))
    .sort((a, b) => b.tocadaEm.getTime() - a.tocadaEm.getTime() || a.id.localeCompare(b.id));
}

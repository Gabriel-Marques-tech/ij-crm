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
/**
 * Por contato/empresa, abertos e fechados em consultas SEPARADAS: fechados
 * nunca empurram um aberto para fora do limite (as regras de alvo dependem
 * de saber se existe aberto).
 */
const MAX_ABERTOS_POR_IDENTIDADE = 10;
const MAX_FECHADOS_POR_IDENTIDADE = 5;
/** Reply a confirmação só fixa o alvo se a confirmação tem até 30 dias. */
export const VALIDADE_RESPOSTA_MS = 30 * 24 * 60 * 60 * 1000;

export type MotivoRespostaInvalida = "RESPOSTA_ANTIGA" | "RESPOSTA_CARD_REMOVIDO" | "RESPOSTA_FORA_DE_VENDAS";
export type AlvoDaResposta = { tipo: "CARD"; id: string } | { tipo: "INVALIDA"; motivo: MotivoRespostaInvalida };

const CARD_VIVO_EM_VENDAS = { deletadoEm: null, pipeline: { chave: PIPELINE_VENDAS } } as const;

/**
 * Reply a uma confirmação do bot que cita um card. `CARD` = fixa o alvo (até
 * 30 dias, card vivo em vendas); `INVALIDA` = é reply a uma confirmação de
 * card, mas antiga, de card removido ou fora de vendas — NÃO vira CRIAR, vai
 * para revisão. `null` = não é reply a confirmação com card. Card não tem
 * merge (só Empresa/Contato), então "vivo" = não está na lixeira.
 */
export async function alvoDaResposta(respondendoEventoId: string | null, recebidaEm: Date, cliente: Cliente = db): Promise<AlvoDaResposta | null> {
  if (!respondendoEventoId) return null;
  const enviada = await cliente.mensagemEnviada.findUnique({ where: { eventoId: respondendoEventoId }, select: { oportunidadeId: true, em: true } });
  if (!enviada?.oportunidadeId) return null;
  const card = await cliente.oportunidade.findUnique({
    where: { id: enviada.oportunidadeId },
    select: { id: true, deletadoEm: true, pipeline: { select: { chave: true } } },
  });
  if (!card || card.deletadoEm) return { tipo: "INVALIDA", motivo: "RESPOSTA_CARD_REMOVIDO" };
  if (card.pipeline.chave !== PIPELINE_VENDAS) return { tipo: "INVALIDA", motivo: "RESPOSTA_FORA_DE_VENDAS" };
  if (recebidaEm.getTime() - enviada.em.getTime() > VALIDADE_RESPOSTA_MS) return { tipo: "INVALIDA", motivo: "RESPOSTA_ANTIGA" };
  return { tipo: "CARD", id: card.id };
}

/** Cards de vendas por identidade: abertos e fechados com limites próprios. */
async function porIdentidade(cliente: Cliente, filtro: Prisma.OportunidadeWhereInput): Promise<string[]> {
  const [abertos, fechados] = await Promise.all(
    ([false, true] as const).map((terminal) =>
      cliente.oportunidade.findMany({
        where: { ...CARD_VIVO_EM_VENDAS, ...filtro, fase: { isTerminal: terminal } },
        orderBy: [{ atualizadoEm: "desc" }, { id: "asc" }],
        take: terminal ? MAX_FECHADOS_POR_IDENTIDADE : MAX_ABERTOS_POR_IDENTIDADE,
        select: { id: true },
      }),
    ),
  );
  return [...abertos, ...fechados].map((o) => o.id);
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
    for (const id of await porIdentidade(cliente, { contatoId: { in: e.contatoIds } })) marcar(id, "contato");
  }
  for (const via of ["cnpj", "dominio"] as const) {
    const ids = e.empresas.filter((x) => x.via === via).map((x) => x.id);
    if (!ids.length) continue;
    for (const id of await porIdentidade(cliente, { empresaId: { in: ids } })) marcar(id, via === "cnpj" ? "empresa" : "dominio");
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

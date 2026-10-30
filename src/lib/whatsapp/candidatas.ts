/**
 * Projetos candidatos para o contexto da LLM (GAB-38; design doc §4.3
 * "Alvo de ATUALIZAR"). Só LEITURA — não é sessão de conversa:
 * - cards de `vendas` dos contatos/empresas casados por identificador exato
 *   (abertos e fechados: as regras de alvo precisam saber de "só terminais");
 * - os últimos 3 projetos que o remetente tocou (Timeline com o usuário
 *   dele) nos 30 min antes da mensagem — cobre mensagens picadas;
 * - o card da confirmação do bot que a mensagem responde (`MensagemEnviada`);
 * - GAB-49: os cards que as mensagens de venda do remetente mexeram na janela
 *   de 12 h atual (`ledger`, ids já calculados por `contexto/ledger.ts`).
 *
 * WhatsApp só mexe na parte de vendas do ciclo: card que já seguiu para
 * Projetos (ganho) entra como FECHADO no Ganho, como na v1; o resto de
 * Projetos nunca entra (GAB-81, `ciclo-vendas.ts`).
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { ProjetoCandidato } from "@/lib/llm/prompts/extracao.v2";
import { PIPELINE_VENDAS } from "@/lib/projetos/terminal-regras";
import type { ViaCandidata } from "./alvo";
import { CARD_FECHADO_NO_CICLO_DE_VENDAS, CARD_VIVO_NO_CICLO_DE_VENDAS, faseVistaPeloWhatsapp } from "./ciclo-vendas";

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

const ABERTO_EM_VENDAS = { deletadoEm: null, pipeline: { chave: PIPELINE_VENDAS }, fase: { isTerminal: false } } as const;

/**
 * Reply a uma confirmação do bot que cita um card. `CARD` = fixa o alvo (até
 * 30 dias, card vivo em vendas); `INVALIDA` = é reply a uma confirmação de
 * card, mas antiga, de card removido ou fora de vendas — NÃO vira CRIAR, vai
 * para revisão. `null` = não é reply a confirmação com card. Card não tem
 * merge (só Empresa/Contato), então "vivo" = não está na lixeira.
 */
export async function alvoDaResposta(respondendoEventoId: string | null, recebidaEm: Date, cliente: Cliente = db): Promise<AlvoDaResposta | null> {
  if (!respondendoEventoId) return null;
  const enviada = await cliente.mensagemEnviada.findUnique({ where: { eventoId: respondendoEventoId }, select: { projetoId: true, em: true } });
  if (!enviada?.projetoId) return null;
  const card = await cliente.projeto.findUnique({
    where: { id: enviada.projetoId },
    select: { id: true, deletadoEm: true, dataGanho: true, pipeline: { select: { chave: true } } },
  });
  if (!card || card.deletadoEm) return { tipo: "INVALIDA", motivo: "RESPOSTA_CARD_REMOVIDO" };
  // Ganho que seguiu para Projetos ainda é a venda (fechada) da confirmação.
  if (card.pipeline.chave !== PIPELINE_VENDAS && !card.dataGanho) return { tipo: "INVALIDA", motivo: "RESPOSTA_FORA_DE_VENDAS" };
  if (recebidaEm.getTime() - enviada.em.getTime() > VALIDADE_RESPOSTA_MS) return { tipo: "INVALIDA", motivo: "RESPOSTA_ANTIGA" };
  return { tipo: "CARD", id: card.id };
}

/** Cards de vendas por identidade: abertos e fechados com limites próprios. */
async function porIdentidade(cliente: Cliente, filtro: Prisma.ProjetoWhereInput): Promise<string[]> {
  const [abertos, fechados] = await Promise.all(
    ([false, true] as const).map((terminal) =>
      cliente.projeto.findMany({
        where: { ...(terminal ? CARD_FECHADO_NO_CICLO_DE_VENDAS : ABERTO_EM_VENDAS), ...filtro },
        orderBy: [{ atualizadoEm: "desc" }, { id: "asc" }],
        take: terminal ? MAX_FECHADOS_POR_IDENTIDADE : MAX_ABERTOS_POR_IDENTIDADE,
        select: { id: true },
      }),
    ),
  );
  return [...abertos, ...fechados].map((o) => o.id);
}

export async function projetosCandidatos(
  e: {
    remetenteUsuarioId: string | null;
    recebidaEm: Date;
    contatoIds: string[];
    empresas: { id: string; via: "cnpj" | "dominio" }[];
    alvoResposta: string | null;
    /** GAB-49: cards do ledger da janela de 12 h (`cardsDoLedger`). */
    ledger?: string[];
  },
  cliente: Cliente = db,
): Promise<ProjetoCandidato[]> {
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
        projeto: CARD_VIVO_NO_CICLO_DE_VENDAS,
      },
      orderBy: [{ em: "desc" }, { id: "desc" }],
      take: 50,
      select: { projetoId: true },
    });
    const recentes = [...new Set(toques.map((t) => t.projetoId))].slice(0, MAX_RECENTES);
    for (const id of recentes) marcar(id, "recente");
  }

  for (const id of e.ledger ?? []) marcar(id, "ledger");

  if (vias.size === 0) return [];
  const ids = [...vias.keys()];
  const [cards, ultimos, ganho] = await Promise.all([
    cliente.projeto.findMany({
      where: { id: { in: ids }, ...CARD_VIVO_NO_CICLO_DE_VENDAS },
      select: { id: true, titulo: true, criadoEm: true, pipeline: { select: { chave: true } }, fase: { select: { nome: true, isTerminal: true } } },
    }),
    cliente.timeline.groupBy({ by: ["projetoId"], where: { projetoId: { in: ids } }, _max: { em: true } }),
    cliente.fase.findUnique({ where: { marco: "GANHO" }, select: { nome: true } }),
  ]);
  const tocada = new Map(ultimos.map((u) => [u.projetoId, u._max.em]));
  return cards
    .map((c) => ({ c, vista: faseVistaPeloWhatsapp(c, ganho?.nome ?? "Ganho") }))
    .map(({ c, vista }) => ({
      id: c.id,
      titulo: c.titulo,
      faseNome: vista.nome,
      terminal: vista.terminal,
      tocadaEm: tocada.get(c.id) ?? c.criadoEm,
      via: [...vias.get(c.id)!],
    }))
    .sort((a, b) => b.tocadaEm.getTime() - a.tocadaEm.getTime() || a.id.localeCompare(b.id));
}

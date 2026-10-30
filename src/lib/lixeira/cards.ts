/**
 * Lixeira de cards (GAB-36).
 *
 * - `excluirCard` (qualquer usuário): soft-delete — `deletado_em` + Timeline
 *   `EXCLUSAO` (quem/quando). Some de todas as visões (todas filtram
 *   `deletadoEm: null`). Toma o lock do quadro, como mover: um movimento e uma
 *   exclusão do mesmo card nunca se cruzam.
 * - `restaurarCard` (gestor+): volta para a MESMA fase. Se a fase foi
 *   arquivada enquanto o card estava na lixeira, exige `faseId` de uma fase
 *   ativa do mesmo quadro e do mesmo tipo (aberta/ganho/perdido — mesma regra
 *   da migração ao remover fase, `destinoCompativel`), gravando TransicaoFase +
 *   MOVIMENTACAO (`motivo: "restauracao"`). Não passa pelos ganchos de
 *   terminal: o tipo não muda, os dados de fechamento continuam válidos.
 * - `apagarCardDefinitivo` (admin, só o que está na lixeira, confirmação
 *   digitando o título): DELETE de verdade. TransicaoFase/Timeline do card vão
 *   junto (cascade); o vínculo venda ↔ projeto do outro lado e o
 *   `reabertaDe` dos cards reabertos a partir dele viram null (FK SET NULL) e
 *   cada um ganha uma entrada na Timeline explicando. Mensagens enviadas ficam
 *   (histórico), sem card. Trava os quadros de TODOS os cards envolvidos antes
 *   da linha, como `excluirCard`/`restaurarCard`.
 * - GAB-81: o card de projetos da v1 absorvido pela migração do ciclo único
 *   (`absorvidoPorId`) não é card da lixeira: não restaura nem é apagado
 *   sozinho; apagar de vez o Projeto leva a casca junto (FK CASCADE).
 */
import type { Papel, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { travarPipelines } from "@/lib/fases/fases";
import { destinoCompativel } from "@/lib/fases/regras";
import { confirmacaoConfere, podeApagarDeVez, podeRestaurar, type FalhaLixeira } from "./regras";

type Tx = Prisma.TransactionClient;
type Ator = { id: string; papel: Papel };

export type ResultadoLixeira<T = object> = ({ ok: true } & T) | ({ ok: false } & FalhaLixeira);

class Falha extends Error {
  constructor(readonly falha: FalhaLixeira) {
    super(falha.erro);
  }
}

function traduzir<T>(e: unknown): ResultadoLixeira<T> {
  if (e instanceof Falha) return { ok: false, ...e.falha };
  throw e;
}

async function travarLinha(tx: Tx, id: string): Promise<boolean> {
  const r = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM oportunidade WHERE id = ${id} FOR UPDATE`;
  return r.length > 0;
}

export async function excluirCard(id: string, por: { id: string }): Promise<ResultadoLixeira> {
  try {
    await db.$transaction(async (tx) => {
      const alvo = await tx.projeto.findFirst({ where: { id, deletadoEm: null }, select: { pipelineId: true } });
      if (!alvo) throw new Falha({ erro: "CARD_NAO_ENCONTRADO" });
      await travarPipelines(tx, [alvo.pipelineId]);
      const agora = new Date();
      const atual = await tx.projeto.findFirst({ where: { id, deletadoEm: null }, select: { faseId: true } });
      if (!atual) throw new Falha({ erro: "CARD_NAO_ENCONTRADO" });
      await tx.projeto.update({ where: { id }, data: { deletadoEm: agora } });
      await tx.timeline.create({ data: { projetoId: id, tipo: "EXCLUSAO", payload: { faseId: atual.faseId }, usuarioId: por.id, em: agora } });
    });
    return { ok: true };
  } catch (e) {
    return traduzir(e);
  }
}

export async function restaurarCard(id: string, por: Ator, opts: { faseId?: string | null } = {}): Promise<ResultadoLixeira<{ faseId: string }>> {
  if (!podeRestaurar(por.papel)) return { ok: false, erro: "SEM_PERMISSAO" };
  try {
    const faseId = await db.$transaction(async (tx) => {
      const alvo = await tx.projeto.findUnique({ where: { id }, select: { pipelineId: true, absorvidoPorId: true } });
      if (!alvo || alvo.absorvidoPorId) throw new Falha({ erro: "CARD_NAO_ENCONTRADO" });
      await travarPipelines(tx, [alvo.pipelineId]);
      if (!(await travarLinha(tx, id))) throw new Falha({ erro: "CARD_NAO_ENCONTRADO" });
      const card = await tx.projeto.findUniqueOrThrow({ where: { id }, select: { deletadoEm: true, faseId: true, fase: true } });
      if (!card.deletadoEm) throw new Falha({ erro: "NAO_ESTA_NA_LIXEIRA" });

      let destino = card.fase;
      if (card.fase.arquivadaEm) {
        if (!opts.faseId) throw new Falha({ erro: "FASE_ARQUIVADA_ESCOLHA", fase: { id: card.fase.id, nome: card.fase.nome } });
        const f = await tx.fase.findUnique({ where: { id: opts.faseId } });
        if (!f || f.pipelineId !== alvo.pipelineId || f.arquivadaEm) throw new Falha({ erro: "FASE_INVALIDA" });
        if (!destinoCompativel(card.fase, f)) throw new Falha({ erro: "FASE_INCOMPATIVEL" });
        destino = f;
      }

      const agora = new Date();
      const depois = new Date(agora.getTime() + 1); // MOVIMENTACAO depois da RESTAURACAO na Timeline
      const moveu = destino.id !== card.faseId;
      await tx.projeto.update({ where: { id }, data: { deletadoEm: null, ...(moveu ? { faseId: destino.id, faseDesde: agora } : {}) } });
      await tx.timeline.create({ data: { projetoId: id, tipo: "RESTAURACAO", payload: { faseId: destino.id }, usuarioId: por.id, em: agora } });
      if (moveu) {
        await tx.transicaoFase.create({ data: { projetoId: id, deFaseId: card.faseId, paraFaseId: destino.id, usuarioId: por.id, origem: "UI", em: agora } });
        await tx.timeline.create({
          data: { projetoId: id, tipo: "MOVIMENTACAO", payload: { deFaseId: card.faseId, paraFaseId: destino.id, motivo: "restauracao" }, usuarioId: por.id, em: depois },
        });
      }
      return destino.id;
    });
    return { ok: true, faseId };
  } catch (e) {
    return traduzir(e);
  }
}

/** Outra transação mudou os vínculos entre a leitura e o lock: tenta de novo. */
class VinculosMudaram extends Error {}

export async function apagarCardDefinitivo(id: string, por: Ator, confirmacao: string): Promise<ResultadoLixeira> {
  if (!podeApagarDeVez(por.papel)) return { ok: false, erro: "SEM_PERMISSAO" };
  for (let tentativa = 1; ; tentativa++) {
    try {
      await db.$transaction((tx) => apagarCardNaTransacao(tx, id, por, confirmacao));
      return { ok: true };
    } catch (e) {
      if (e instanceof VinculosMudaram && tentativa < 3) continue;
      return traduzir(e);
    }
  }
}

const SELECAO_LIGADOS = {
  pipelineId: true,
  absorvidoPorId: true,
  vendaOrigem: { select: { id: true, pipelineId: true, absorvidoPorId: true } },
  cardProjetos: { select: { id: true, pipelineId: true, absorvidoPorId: true } },
  reaberturas: { select: { id: true, pipelineId: true } },
} as const;

async function apagarCardNaTransacao(tx: Tx, id: string, por: Ator, confirmacao: string): Promise<void> {
  // Ordem documentada: pipelines (todos os quadros envolvidos, por id) → linha.
  // Escrevemos na Timeline dos cards ligados (venda ↔ projeto, reaberturas) e o
  // DELETE zera as FKs deles, então os quadros deles entram no lock também.
  const antes = await tx.projeto.findUnique({ where: { id }, select: SELECAO_LIGADOS });
  if (!antes || antes.absorvidoPorId) throw new Falha({ erro: "CARD_NAO_ENCONTRADO" });
  const quadros = new Set(pipelinesEnvolvidos(antes));
  await travarPipelines(tx, quadros);
  if (!(await travarLinha(tx, id))) throw new Falha({ erro: "CARD_NAO_ENCONTRADO" });
  const card = await tx.projeto.findUniqueOrThrow({ where: { id }, select: { titulo: true, deletadoEm: true, ...SELECAO_LIGADOS } });
  if (pipelinesEnvolvidos(card).some((p) => !quadros.has(p))) throw new VinculosMudaram();
  if (!card.deletadoEm) throw new Falha({ erro: "NAO_ESTA_NA_LIXEIRA" });
  if (!confirmacaoConfere(confirmacao, card.titulo)) throw new Falha({ erro: "CONFIRMACAO_NAO_CONFERE" });
  const agora = new Date();
  const nota = (projetoId: string, evento: string) => ({
    projetoId,
    tipo: "VINCULO_PROJETO" as const,
    payload: { evento, titulo: card.titulo },
    usuarioId: por.id,
    em: agora,
  });
  // Os cards ligados perdem a FK (SET NULL) mas sobrevivem: fica o registro do porquê.
  // Casca absorvida (ciclo único) não ganha nota: vai junto no CASCADE.
  const notas = [
    ...(card.cardProjetos && !card.cardProjetos.absorvidoPorId ? [nota(card.cardProjetos.id, "venda_apagada")] : []),
    ...(card.vendaOrigem && !card.vendaOrigem.absorvidoPorId ? [nota(card.vendaOrigem.id, "projeto_apagado")] : []),
    ...card.reaberturas.map((r) => nota(r.id, "origem_reabertura_apagada")),
  ];
  if (notas.length > 0) await tx.timeline.createMany({ data: notas });
  // Cascade: TransicaoFase, Timeline, cascas absorvidas. SET NULL: projeto.origem, reaberturas.reabertaDe, MensagemEnviada.
  await tx.projeto.delete({ where: { id } });
}

function pipelinesEnvolvidos(c: {
  pipelineId: string;
  vendaOrigem: { pipelineId: string } | null;
  cardProjetos: { pipelineId: string } | null;
  reaberturas: { pipelineId: string }[];
}): string[] {
  return [c.pipelineId, c.vendaOrigem?.pipelineId, c.cardProjetos?.pipelineId, ...c.reaberturas.map((r) => r.pipelineId)].filter((p): p is string => !!p);
}

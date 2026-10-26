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
 *   junto (cascade); o vínculo venda ↔ projeto do outro lado vira null (FK
 *   SET NULL) e ganha uma entrada na Timeline dele explicando.
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
      const alvo = await tx.oportunidade.findFirst({ where: { id, deletadoEm: null }, select: { pipelineId: true } });
      if (!alvo) throw new Falha({ erro: "CARD_NAO_ENCONTRADO" });
      await travarPipelines(tx, [alvo.pipelineId]);
      const agora = new Date();
      const atual = await tx.oportunidade.findFirst({ where: { id, deletadoEm: null }, select: { faseId: true } });
      if (!atual) throw new Falha({ erro: "CARD_NAO_ENCONTRADO" });
      await tx.oportunidade.update({ where: { id }, data: { deletadoEm: agora } });
      await tx.timeline.create({ data: { oportunidadeId: id, tipo: "EXCLUSAO", payload: { faseId: atual.faseId }, usuarioId: por.id, em: agora } });
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
      const alvo = await tx.oportunidade.findUnique({ where: { id }, select: { pipelineId: true } });
      if (!alvo) throw new Falha({ erro: "CARD_NAO_ENCONTRADO" });
      await travarPipelines(tx, [alvo.pipelineId]);
      if (!(await travarLinha(tx, id))) throw new Falha({ erro: "CARD_NAO_ENCONTRADO" });
      const card = await tx.oportunidade.findUniqueOrThrow({ where: { id }, select: { deletadoEm: true, faseId: true, fase: true } });
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
      await tx.oportunidade.update({ where: { id }, data: { deletadoEm: null, ...(moveu ? { faseId: destino.id, faseDesde: agora } : {}) } });
      await tx.timeline.create({ data: { oportunidadeId: id, tipo: "RESTAURACAO", payload: { faseId: destino.id }, usuarioId: por.id, em: agora } });
      if (moveu) {
        await tx.transicaoFase.create({ data: { oportunidadeId: id, deFaseId: card.faseId, paraFaseId: destino.id, usuarioId: por.id, origem: "UI", em: agora } });
        await tx.timeline.create({
          data: { oportunidadeId: id, tipo: "MOVIMENTACAO", payload: { deFaseId: card.faseId, paraFaseId: destino.id, motivo: "restauracao" }, usuarioId: por.id, em: depois },
        });
      }
      return destino.id;
    });
    return { ok: true, faseId };
  } catch (e) {
    return traduzir(e);
  }
}

export async function apagarCardDefinitivo(id: string, por: Ator, confirmacao: string): Promise<ResultadoLixeira> {
  if (!podeApagarDeVez(por.papel)) return { ok: false, erro: "SEM_PERMISSAO" };
  try {
    await db.$transaction(async (tx) => {
      if (!(await travarLinha(tx, id))) throw new Falha({ erro: "CARD_NAO_ENCONTRADO" });
      const card = await tx.oportunidade.findUniqueOrThrow({
        where: { id },
        select: { titulo: true, deletadoEm: true, origemOportunidadeId: true, projeto: { select: { id: true } } },
      });
      if (!card.deletadoEm) throw new Falha({ erro: "NAO_ESTA_NA_LIXEIRA" });
      if (!confirmacaoConfere(confirmacao, card.titulo)) throw new Falha({ erro: "CONFIRMACAO_NAO_CONFERE" });
      const agora = new Date();
      // O outro lado do vínculo venda ↔ projeto perde a FK (SET NULL): fica o registro do porquê.
      if (card.projeto) {
        await tx.timeline.create({
          data: { oportunidadeId: card.projeto.id, tipo: "VINCULO_PROJETO", payload: { evento: "venda_apagada", titulo: card.titulo }, usuarioId: por.id, em: agora },
        });
      }
      if (card.origemOportunidadeId) {
        await tx.timeline.create({
          data: { oportunidadeId: card.origemOportunidadeId, tipo: "VINCULO_PROJETO", payload: { evento: "projeto_apagado", titulo: card.titulo }, usuarioId: por.id, em: agora },
        });
      }
      await tx.oportunidade.delete({ where: { id } });
    });
    return { ok: true };
  } catch (e) {
    return traduzir(e);
  }
}

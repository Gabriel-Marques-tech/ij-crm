/**
 * Vínculo explícito de Empresa e Contato a um card (GAB-31). Permissão é do
 * chamador (`exigirUsuario`): qualquer usuário edita card (§4.5).
 *
 * Trava a linha do card (`FOR UPDATE`, como `editarCard`) para o "antes" da
 * Timeline ser o vínculo que de fato foi trocado. Cada troca grava
 * `CAMPO_ALTERADO { campo: "empresa"|"contato", antes, depois, antesId, depoisId }`
 * com os NOMES (legíveis mesmo se a entidade mudar de nome depois) e os ids.
 * Mesmo alvo → no-op, sem Timeline. Só entidades vivas (não deletadas nem
 * mescladas) podem ser vinculadas.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { SELECAO_REF, descreverVinculo, type Vinculo } from "@/lib/entidades/vinculo";

export type CampoVinculo = "empresa" | "contato";

export const ROTULO_VINCULO: Record<CampoVinculo, string> = { empresa: "Empresa", contato: "Contato" };

export function ehCampoVinculo(c: unknown): c is CampoVinculo {
  return c === "empresa" || c === "contato";
}

export type ErroVinculo = "CARD_NAO_ENCONTRADO" | "EMPRESA_NAO_ENCONTRADA" | "CONTATO_NAO_ENCONTRADO";

export type ResultadoVinculo = { ok: true; mudou: boolean } | { ok: false; erro: ErroVinculo };

type Ator = { id: string };
type Tx = Prisma.TransactionClient;

class ErroDeRegra extends Error {
  constructor(readonly erro: ErroVinculo) {
    super(erro);
  }
}

const VIVO = { deletadoEm: null, mergedIntoId: null } as const;

async function alvoVivo(tx: Tx, campo: CampoVinculo, id: string): Promise<{ id: string; nome: string }> {
  const achado =
    campo === "empresa"
      ? await tx.empresa.findFirst({ where: { id, ...VIVO }, select: { id: true, nome: true } })
      : await tx.contato.findFirst({ where: { id, ...VIVO }, select: { id: true, nome: true } });
  if (!achado) throw new ErroDeRegra(campo === "empresa" ? "EMPRESA_NAO_ENCONTRADA" : "CONTATO_NAO_ENCONTRADO");
  return achado;
}

/**
 * Empresa e contato do card como devem ser EXIBIDOS: vínculo para registro
 * excluído/mesclado aparece como tal (com o destino do merge), nunca como
 * ativo. null = card não encontrado.
 */
export async function obterVinculosDoCard(cardId: string): Promise<{ empresa: Vinculo | null; contato: Vinculo | null } | null> {
  const card = await db.oportunidade.findFirst({
    where: { id: cardId, deletadoEm: null },
    select: { empresa: { select: SELECAO_REF }, contato: { select: SELECAO_REF } },
  });
  if (!card) return null;
  const [empresa, contato] = await Promise.all([descreverVinculo("empresa", card.empresa), descreverVinculo("contato", card.contato)]);
  return { empresa, contato };
}

/** Vincula (`alvoId`) ou desvincula (`null`) a empresa/contato do card. */
export async function vincularAoCard(cardId: string, campo: CampoVinculo, alvoId: string | null, por: Ator): Promise<ResultadoVinculo> {
  try {
    return await db.$transaction(async (tx) => {
      const travado = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM oportunidade WHERE id = ${cardId} AND deletado_em IS NULL FOR UPDATE`;
      if (travado.length === 0) throw new ErroDeRegra("CARD_NAO_ENCONTRADO");
      const atual = await tx.oportunidade.findUniqueOrThrow({
        where: { id: cardId },
        select: { empresa: { select: { id: true, nome: true } }, contato: { select: { id: true, nome: true } } },
      });
      const antes = campo === "empresa" ? atual.empresa : atual.contato;
      if ((antes?.id ?? null) === alvoId) return { ok: true as const, mudou: false };
      const depois = alvoId ? await alvoVivo(tx, campo, alvoId) : null;

      await tx.oportunidade.update({
        where: { id: cardId },
        data: campo === "empresa" ? { empresaId: depois?.id ?? null } : { contatoId: depois?.id ?? null },
      });
      await tx.timeline.create({
        data: {
          oportunidadeId: cardId,
          tipo: "CAMPO_ALTERADO",
          payload: { campo, antes: antes?.nome ?? null, depois: depois?.nome ?? null, antesId: antes?.id ?? null, depoisId: depois?.id ?? null },
          usuarioId: por.id,
        },
      });
      return { ok: true as const, mudou: true };
    });
  } catch (e) {
    if (e instanceof ErroDeRegra) return { ok: false, erro: e.erro };
    throw e;
  }
}

/**
 * Lixeira de Contatos e Empresas (GAB-36). Mesmo contrato para os dois.
 *
 * - Excluir/restaurar: gestor+. Excluir só registro vivo (nem excluído nem
 *   mesclado) e que não recebeu merges (desfaça-os antes). Enquanto está na lixeira, telefone/email/CNPJ continuam
 *   BLOQUEADOS (unique global; `match.ts` devolve `BLOQUEADO_EXCLUIDO`): pode
 *   ser restaurado a qualquer momento, com tudo de volta.
 * - Apagar de vez: admin, só o que está na lixeira, confirmação digitando o
 *   nome. Libera os identificadores (pontos vão junto por cascade; o CNPJ some
 *   com a linha). Cards que apontavam para ele ficam sem empresa/contato (FK
 *   SET NULL), cada um com uma Timeline `CAMPO_ALTERADO` explicando. Contatos
 *   da empresa ficam sem empresa. Quem estava mesclado NELE vai para a lixeira
 *   (ponteiro limpo): era a mesma pessoa/empresa, então segue a intenção de
 *   apagar — mas nada se perde sem uma segunda decisão. (Hoje só acontece com
 *   dado legado: `excluirEntidade` recusa principal com mesclados.)
 */
import { Prisma, type Papel } from "@prisma/client";
import { db } from "@/lib/db";
import { confirmacaoConfere, podeApagarDeVez, podeExcluirEntidade, podeRestaurar, type ErroLixeira } from "./regras";
import type { ResultadoLixeira } from "./cards";

type Tx = Prisma.TransactionClient;
type Ator = { id: string; papel: Papel };
export type TipoEntidade = "contato" | "empresa";

const NAO_ENCONTRADO: Record<TipoEntidade, ErroLixeira> = { contato: "CONTATO_NAO_ENCONTRADO", empresa: "EMPRESA_NAO_ENCONTRADA" };

class Falha extends Error {
  constructor(
    readonly erro: ErroLixeira,
    readonly mesclados?: number,
  ) {
    super(erro);
  }
}

/** Delegate do Prisma por tipo (as duas tabelas têm o mesmo formato nas colunas usadas aqui). */
function tabela(tx: Tx, tipo: TipoEntidade) {
  return (tipo === "contato" ? tx.contato : tx.empresa) as unknown as Prisma.ContatoDelegate;
}

async function travar(tx: Tx, tipo: TipoEntidade, id: string): Promise<{ nome: string; deletadoEm: Date | null; mergedIntoId: string | null } | null> {
  const nomeTabela = Prisma.raw(tipo === "contato" ? "contato" : "empresa");
  const r = await tx.$queryRaw<{ nome: string; deletado_em: Date | null; merged_into_id: string | null }[]>`SELECT nome, deletado_em, merged_into_id FROM ${nomeTabela} WHERE id = ${id} FOR UPDATE`;
  return r[0] ? { nome: r[0].nome, deletadoEm: r[0].deletado_em, mergedIntoId: r[0].merged_into_id } : null;
}

const TEM_MESCLADOS: Record<TipoEntidade, ErroLixeira> = { contato: "CONTATO_TEM_MESCLADOS", empresa: "EMPRESA_TEM_MESCLADOS" };

/**
 * Recusa quem recebeu merges: os mesclados não são vivos nem estão na lixeira,
 * então sumiriam de todas as telas (link deles redireciona para um principal
 * excluído → 404). A trava da linha serializa com `mesclar` (que trava as duas
 * linhas antes de validar): ninguém mescla nele no meio da exclusão.
 */
export async function excluirEntidade(tipo: TipoEntidade, id: string, por: Ator): Promise<ResultadoLixeira> {
  if (!podeExcluirEntidade(por.papel)) return { ok: false, erro: "SEM_PERMISSAO" };
  try {
    await db.$transaction(async (tx) => {
      const alvo = await travar(tx, tipo, id);
      if (!alvo || alvo.deletadoEm || alvo.mergedIntoId) throw new Falha(NAO_ENCONTRADO[tipo]);
      const mesclados = await tabela(tx, tipo).count({ where: { mergedIntoId: id } });
      if (mesclados > 0) throw new Falha(TEM_MESCLADOS[tipo], mesclados);
      await tabela(tx, tipo).update({ where: { id }, data: { deletadoEm: new Date() } });
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof Falha) return { ok: false, erro: e.erro, ...(e.mesclados !== undefined ? { mesclados: e.mesclados } : {}) };
    throw e;
  }
}

export async function restaurarEntidade(tipo: TipoEntidade, id: string, por: Ator): Promise<ResultadoLixeira> {
  if (!podeRestaurar(por.papel)) return { ok: false, erro: "SEM_PERMISSAO" };
  const r = await tabela(db, tipo).updateMany({ where: { id, deletadoEm: { not: null } }, data: { deletadoEm: null } });
  if (r.count === 1) return { ok: true };
  const existe = (await tabela(db, tipo).count({ where: { id } })) > 0;
  return { ok: false, erro: existe ? "NAO_ESTA_NA_LIXEIRA" : NAO_ENCONTRADO[tipo] };
}

export async function apagarEntidadeDefinitivo(
  tipo: TipoEntidade,
  id: string,
  por: Ator,
  confirmacao: string,
): Promise<ResultadoLixeira<{ cardsAfetados: number; mescladosParaLixeira: number }>> {
  if (!podeApagarDeVez(por.papel)) return { ok: false, erro: "SEM_PERMISSAO" };
  try {
    const r = await db.$transaction(async (tx) => {
      const alvo = await travar(tx, tipo, id);
      if (!alvo) throw new Falha(NAO_ENCONTRADO[tipo]);
      if (!alvo.deletadoEm) throw new Falha("NAO_ESTA_NA_LIXEIRA");
      if (!confirmacaoConfere(confirmacao, alvo.nome)) throw new Falha("CONFIRMACAO_NAO_CONFERE");
      const agora = new Date();

      const mesclados = await tabela(tx, tipo).updateMany({ where: { mergedIntoId: id, deletadoEm: null }, data: { mergedIntoId: null, deletadoEm: agora } });

      const campoFk = tipo === "contato" ? "contatoId" : "empresaId";
      const cards = await tx.oportunidade.findMany({ where: { [campoFk]: id }, select: { id: true } });
      if (cards.length > 0) {
        await tx.timeline.createMany({
          data: cards.map((c) => ({
            oportunidadeId: c.id,
            tipo: "CAMPO_ALTERADO" as const,
            payload: { campo: tipo, antes: alvo.nome, depois: null, motivo: "apagado_definitivamente" },
            usuarioId: por.id,
            em: agora,
          })),
        });
      }
      // FKs: oportunidade.{contato,empresa}_id e contato.empresa_id → SET NULL; contato_ponto → CASCADE.
      await tabela(tx, tipo).delete({ where: { id } });
      return { cardsAfetados: cards.length, mescladosParaLixeira: mesclados.count };
    });
    return { ok: true, ...r };
  } catch (e) {
    if (e instanceof Falha) return { ok: false, erro: e.erro };
    throw e;
  }
}

/**
 * "Marcar feita" da próxima ação (Minha Semana, GAB-33). Numa transação só:
 * trava o card, confere que a ação é a que o usuário viu, grava a Timeline
 * `NOTA` ("Feito: <ação>") e aplica a decisão sobre a próxima — nova ação +
 * data, ou "nenhuma" explícita — pelo mesmo caminho do `editarCard` (cada
 * campo vira `CAMPO_ALTERADO`). Ou grava tudo, ou nada.
 */
import { db } from "@/lib/db";
import { diaEmFuso } from "./aging";
import { formatarDia } from "./formatar";
import { aplicarPatch, ErroDeRegra } from "./oportunidades";

export type DecisaoProxima = { tipo: "nova"; proximaAcao: string; proximaAcaoEm: Date } | { tipo: "nenhuma" };

/** O que a tela mostrava: `dia` em `YYYY-MM-DD` (SP). */
export type AcaoEsperada = { proximaAcao: string | null; dia: string | null };

export type ErroFeita = "CARD_NAO_ENCONTRADO" | "SEM_PROXIMA_ACAO" | "ACAO_MUDOU";

class Recusa extends Error {
  constructor(readonly erro: ErroFeita) {
    super(erro);
  }
}

export async function marcarAcaoFeita(
  id: string,
  esperado: AcaoEsperada,
  decisao: DecisaoProxima,
  por: { id: string },
): Promise<{ ok: true } | { ok: false; erro: ErroFeita }> {
  try {
    await db.$transaction(async (tx) => {
      const travado = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM oportunidade WHERE id = ${id} AND deletado_em IS NULL FOR UPDATE`;
      if (travado.length === 0) throw new Recusa("CARD_NAO_ENCONTRADO");
      const atual = await tx.oportunidade.findUniqueOrThrow({ where: { id }, select: { proximaAcao: true, proximaAcaoEm: true } });
      const diaAtual = atual.proximaAcaoEm ? diaEmFuso(atual.proximaAcaoEm) : null;
      if (atual.proximaAcao === null && diaAtual === null) throw new Recusa("SEM_PROXIMA_ACAO");
      // Outra aba/pessoa mudou a ação: não marca como feita algo que o usuário não viu.
      if (atual.proximaAcao !== esperado.proximaAcao || diaAtual !== esperado.dia) throw new Recusa("ACAO_MUDOU");

      const feito = atual.proximaAcao ?? `próxima ação de ${formatarDia(diaAtual!)}`;
      const proxima = decisao.tipo === "nova" ? { acao: decisao.proximaAcao, dia: diaEmFuso(decisao.proximaAcaoEm) } : null;
      const texto = `Feito: ${feito}\n${proxima ? `Próxima: ${proxima.acao} (${formatarDia(proxima.dia)})` : "Sem próxima ação definida."}`;

      const base = Date.now();
      await tx.timeline.create({
        data: {
          oportunidadeId: id,
          tipo: "NOTA",
          payload: { texto, feito: { acao: atual.proximaAcao, dia: diaAtual }, proxima },
          usuarioId: por.id,
          em: new Date(base),
        },
      });
      await aplicarPatch(
        tx,
        id,
        decisao.tipo === "nova" ? { proximaAcao: decisao.proximaAcao, proximaAcaoEm: decisao.proximaAcaoEm } : { proximaAcao: null, proximaAcaoEm: null },
        por,
        base + 1,
      );
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof Recusa) return { ok: false, erro: e.erro };
    // Só proximaAcao/proximaAcaoEm no patch e o card já travado: a única regra possível é "sumiu".
    if (e instanceof ErroDeRegra && e.erro === "CARD_NAO_ENCONTRADO") return { ok: false, erro: "CARD_NAO_ENCONTRADO" };
    throw e;
  }
}

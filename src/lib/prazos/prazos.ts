/**
 * Prazos (GAB-51): CRUD com a permissão decidida AQUI (servidor), nunca só na
 * UI. Vendedor mexe só nos prazos em que é o responsável; gestor/admin em
 * qualquer um (`podeMexerNoPrazo`). Prazo de card na lixeira some junto com o
 * card (não aparece nem aceita escrita). Criar/concluir prazo de um card grava
 * `PRAZO` na Timeline dele, na mesma transação.
 */
import type { Papel, Prisma } from "@prisma/client";
import { QUEM_ATUA } from "@/lib/auth/papeis";
import { db } from "@/lib/db";
import { diaDoPrazo, instanteDoPrazo } from "@/lib/calendario/semana";
import { estadoPrazo, podeMexerNoPrazo, validarPrazo, type EstadoPrazo } from "./regras";

type Ator = { id: string; papel: Papel };
type Tx = Prisma.TransactionClient;

export type ErroPrazo = "PRAZO_NAO_ENCONTRADO" | "SEM_PERMISSAO" | "RESPONSAVEL_INVALIDO" | "CARD_NAO_ENCONTRADO" | "INVALIDO";

export type ResultadoPrazo<T = object> = ({ ok: true } & T) | { ok: false; erro: ErroPrazo; mensagem?: string };

export type DadosPrazo = { titulo: string; dia: string; responsavelId: string };

class Recusa extends Error {
  constructor(
    readonly erro: ErroPrazo,
    readonly mensagem?: string,
  ) {
    super(erro);
  }
}

function traduzir(e: unknown): { ok: false; erro: ErroPrazo; mensagem?: string } {
  if (e instanceof Recusa) return e.mensagem ? { ok: false, erro: e.erro, mensagem: e.mensagem } : { ok: false, erro: e.erro };
  throw e;
}

/** Prazo vivo cujo card (se houver) também está vivo. */
const VIVO: Prisma.PrazoWhereInput = { deletadoEm: null, OR: [{ projetoId: null }, { projeto: { deletadoEm: null } }] };

async function exigirResponsavelAtivo(tx: Tx, id: string) {
  const u = await tx.usuario.findFirst({ where: { id, ativo: true, ...QUEM_ATUA }, select: { id: true } });
  if (!u) throw new Recusa("RESPONSAVEL_INVALIDO");
}

function validar(d: DadosPrazo) {
  const v = validarPrazo(d.titulo, d.dia);
  if (!v.ok) throw new Recusa("INVALIDO", v.erro);
  return v;
}

/** Trava a linha do prazo vivo e devolve o que as regras precisam. */
async function travar(tx: Tx, id: string) {
  const linha = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM prazo WHERE id = ${id} AND deletado_em IS NULL FOR UPDATE`;
  if (linha.length === 0) throw new Recusa("PRAZO_NAO_ENCONTRADO");
  const p = await tx.prazo.findFirst({ where: { id, ...VIVO }, select: { responsavelId: true, projetoId: true, titulo: true, data: true, feitoEm: true } });
  if (!p) throw new Recusa("PRAZO_NAO_ENCONTRADO");
  return p;
}

export async function criarPrazo(ator: Ator, dados: DadosPrazo & { projetoId?: string | null }): Promise<ResultadoPrazo<{ id: string }>> {
  try {
    return await db.$transaction(async (tx) => {
      const v = validar(dados);
      if (!podeMexerNoPrazo(ator, dados.responsavelId)) throw new Recusa("SEM_PERMISSAO");
      await exigirResponsavelAtivo(tx, dados.responsavelId);
      const cardId = dados.projetoId ?? null;
      if (cardId) {
        const card = await tx.projeto.findFirst({ where: { id: cardId, deletadoEm: null }, select: { id: true } });
        if (!card) throw new Recusa("CARD_NAO_ENCONTRADO");
      }
      const p = await tx.prazo.create({
        data: { titulo: v.titulo, data: instanteDoPrazo(v.dia), responsavelId: dados.responsavelId, projetoId: cardId, criadoPorId: ator.id },
        select: { id: true },
      });
      if (cardId) {
        await tx.timeline.create({
          data: { projetoId: cardId, tipo: "PRAZO", payload: { evento: "criado", prazoId: p.id, titulo: v.titulo, dia: v.dia, responsavelId: dados.responsavelId }, usuarioId: ator.id },
        });
      }
      return { ok: true as const, id: p.id };
    });
  } catch (e) {
    return traduzir(e);
  }
}

/** Título, dia e responsável. O card do prazo não muda por aqui. */
export async function editarPrazo(ator: Ator, id: string, dados: DadosPrazo): Promise<ResultadoPrazo> {
  try {
    return await db.$transaction(async (tx) => {
      const v = validar(dados);
      const atual = await travar(tx, id);
      // Precisa poder mexer no prazo como está E como fica (vendedor não "passa" prazo adiante).
      if (!podeMexerNoPrazo(ator, atual.responsavelId) || !podeMexerNoPrazo(ator, dados.responsavelId)) throw new Recusa("SEM_PERMISSAO");
      if (dados.responsavelId !== atual.responsavelId) await exigirResponsavelAtivo(tx, dados.responsavelId);
      await tx.prazo.update({ where: { id }, data: { titulo: v.titulo, data: instanteDoPrazo(v.dia), responsavelId: dados.responsavelId } });
      return { ok: true as const };
    });
  } catch (e) {
    return traduzir(e);
  }
}

/** Concluir (`feito`) ou reabrir. Só a passagem para feito grava Timeline (uma vez). */
export async function marcarPrazoFeito(ator: Ator, id: string, feito: boolean): Promise<ResultadoPrazo> {
  try {
    return await db.$transaction(async (tx) => {
      const atual = await travar(tx, id);
      if (!podeMexerNoPrazo(ator, atual.responsavelId)) throw new Recusa("SEM_PERMISSAO");
      if (feito === (atual.feitoEm !== null)) return { ok: true as const };
      await tx.prazo.update({ where: { id }, data: feito ? { feitoEm: new Date(), feitoPorId: ator.id } : { feitoEm: null, feitoPorId: null } });
      if (feito && atual.projetoId) {
        await tx.timeline.create({
          data: {
            projetoId: atual.projetoId,
            tipo: "PRAZO",
            payload: { evento: "concluido", prazoId: id, titulo: atual.titulo, dia: diaDoPrazo(atual.data), responsavelId: atual.responsavelId },
            usuarioId: ator.id,
          },
        });
      }
      return { ok: true as const };
    });
  } catch (e) {
    return traduzir(e);
  }
}

/** Soft-delete, como o resto do app. */
export async function excluirPrazo(ator: Ator, id: string): Promise<ResultadoPrazo> {
  try {
    return await db.$transaction(async (tx) => {
      const atual = await travar(tx, id);
      if (!podeMexerNoPrazo(ator, atual.responsavelId)) throw new Recusa("SEM_PERMISSAO");
      await tx.prazo.update({ where: { id }, data: { deletadoEm: new Date() } });
      return { ok: true as const };
    });
  } catch (e) {
    return traduzir(e);
  }
}

export type PessoaItem = { id: string; nome: string; fotoEm: number | null };

export type PrazoItem = {
  id: string;
  titulo: string;
  dia: string;
  estado: EstadoPrazo;
  responsavel: PessoaItem;
  card: { id: string; titulo: string } | null;
  /** O ator pode editar/concluir/excluir (a UI esconde; o servidor confere de novo). */
  podeMexer: boolean;
};

export const SELECAO_PRAZO = {
  id: true,
  titulo: true,
  data: true,
  feitoEm: true,
  responsavel: { select: { id: true, nome: true, foto: { select: { atualizadoEm: true } } } },
  projeto: { select: { id: true, titulo: true } },
} as const satisfies Prisma.PrazoSelect;

type LinhaPrazo = Prisma.PrazoGetPayload<{ select: typeof SELECAO_PRAZO }>;

export function paraPrazoItem(p: LinhaPrazo, ator: Ator, hoje: string): PrazoItem {
  const dia = diaDoPrazo(p.data);
  return {
    id: p.id,
    titulo: p.titulo,
    dia,
    estado: estadoPrazo({ dia, feito: p.feitoEm !== null }, hoje),
    responsavel: { id: p.responsavel.id, nome: p.responsavel.nome, fotoEm: p.responsavel.foto?.atualizadoEm.getTime() ?? null },
    card: p.projeto,
    podeMexer: podeMexerNoPrazo(ator, p.responsavel.id),
  };
}

/** Ordem dentro do dia: não feitos primeiro, depois título. */
export function compararPrazos(a: PrazoItem, b: PrazoItem): number {
  if (a.dia !== b.dia) return a.dia < b.dia ? -1 : 1;
  const fa = a.estado === "feito" ? 1 : 0;
  const fb = b.estado === "feito" ? 1 : 0;
  if (fa !== fb) return fa - fb;
  return a.titulo.localeCompare(b.titulo, "pt-BR") || (a.id < b.id ? -1 : 1);
}

/** Bloco "Prazos" do detalhe do card. */
export async function listarPrazosDoCard(projetoId: string, ator: Ator, hoje: string): Promise<PrazoItem[]> {
  const linhas = await db.prazo.findMany({ where: { projetoId, ...VIVO }, select: SELECAO_PRAZO });
  return linhas.map((p) => paraPrazoItem(p, ator, hoje)).sort(compararPrazos);
}

export { VIVO as PRAZO_VIVO };

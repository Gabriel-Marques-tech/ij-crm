/**
 * Merge manual de Contatos e de Empresas (GAB-36, §4.5). Nunca automático.
 *
 * Soft-pointer: o perdedor ganha `merged_into_id = principal` e só. Nada é
 * copiado nem apagado — pontos de contato, contatos e oportunidades
 * continuam presos ao perdedor e APARECEM no principal porque as leituras
 * juntam o grupo (`idsDoGrupo`). "Desfazer" limpa o ponteiro e tudo volta a
 * aparecer separado.
 *
 * Um nível só (`validarMerge`): principal vivo e não mesclado; perdedor vivo,
 * não mesclado e sem ninguém mesclado nele. As duas linhas são travadas
 * (`FOR UPDATE`, ordem por id) antes de validar: dois merges cruzados
 * (A→B e B→A, ou C→A enquanto A→B) se serializam e o segundo é recusado.
 */
import { Prisma, type Papel } from "@prisma/client";
import { db } from "@/lib/db";
import { resolverContatos, resolverEmpresas } from "@/lib/contatos/match";
import { podeMesclar, validarMerge, type ErroLixeira } from "@/lib/lixeira/regras";
import type { ResultadoLixeira } from "@/lib/lixeira/cards";

type Tx = Prisma.TransactionClient;
type Ator = { id: string; papel: Papel };
export type TipoMerge = "contato" | "empresa";

const VIVO = { deletadoEm: null, mergedIntoId: null } as const;

class Falha extends Error {
  constructor(readonly erro: ErroLixeira) {
    super(erro);
  }
}

type Linha = { id: string; nome: string; deletadoEm: Date | null; mergedIntoId: string | null };
const SELECAO = { id: true, nome: true, deletadoEm: true, mergedIntoId: true } as const;

async function ler(cliente: Tx, tipo: TipoMerge, id: string): Promise<Linha | null> {
  return tipo === "contato" ? cliente.contato.findUnique({ where: { id }, select: SELECAO }) : cliente.empresa.findUnique({ where: { id }, select: SELECAO });
}

async function mescladosEm(cliente: Tx, tipo: TipoMerge, id: string): Promise<number> {
  return tipo === "contato" ? cliente.contato.count({ where: { mergedIntoId: id } }) : cliente.empresa.count({ where: { mergedIntoId: id } });
}

/**
 * O próprio id + os mesclados nele (1 nível). É o conjunto que as leituras do
 * principal usam no lugar do id sozinho.
 */
export async function idsDoGrupo(tipo: TipoMerge, id: string, cliente: Tx = db): Promise<string[]> {
  const filhos =
    tipo === "contato"
      ? await cliente.contato.findMany({ where: { mergedIntoId: id, deletadoEm: null }, select: { id: true } })
      : await cliente.empresa.findMany({ where: { mergedIntoId: id, deletadoEm: null }, select: { id: true } });
  return [id, ...filhos.map((f) => f.id)];
}

/** Mesclados neste registro (para "desfazer merge" no detalhe do principal). */
export async function listarMesclados(tipo: TipoMerge, id: string) {
  const where = { mergedIntoId: id, deletadoEm: null };
  return tipo === "contato"
    ? db.contato.findMany({ where, orderBy: [{ nome: "asc" }, { id: "asc" }], select: { id: true, nome: true } })
    : db.empresa.findMany({ where, orderBy: [{ nome: "asc" }, { id: "asc" }], select: { id: true, nome: true } });
}

/** Id mesclado (ou com cadeia) → id do principal vivo; null se não há para onde ir. Para redirecionar links velhos. */
export async function destinoDeMesclado(tipo: TipoMerge, id: string): Promise<string | null> {
  const r = (await (tipo === "contato" ? resolverContatos : resolverEmpresas)([id])).get(id);
  return r && !r.deletado && r.id !== id ? r.id : null;
}

export type Contagens = { pontos: number; contatos: number; oportunidades: number };

async function contar(tipo: TipoMerge, ids: string[]): Promise<Contagens> {
  const fk = tipo === "contato" ? { contatoId: { in: ids } } : { empresaId: { in: ids } };
  const [pontos, contatos, oportunidades] = await Promise.all([
    tipo === "contato" ? db.contatoPonto.count({ where: { contatoId: { in: ids } } }) : Promise.resolve(0),
    tipo === "empresa" ? db.contato.count({ where: { empresaId: { in: ids }, ...VIVO } }) : Promise.resolve(0),
    db.oportunidade.count({ where: { ...fk, deletadoEm: null } }),
  ]);
  return { pontos, contatos, oportunidades };
}

export type PreviaMerge = {
  principal: { id: string; nome: string; contagens: Contagens };
  perdedor: { id: string; nome: string; contagens: Contagens };
  /** O que o principal vai mostrar depois do merge. */
  resultado: Contagens;
};

/** Prévia (só leitura): o que aparece no principal depois. Mesmas validações do merge. */
export async function previaMerge(tipo: TipoMerge, principalId: string, perdedorId: string, por: Ator): Promise<ResultadoLixeira<{ previa: PreviaMerge }>> {
  if (!podeMesclar(por.papel)) return { ok: false, erro: "SEM_PERMISSAO" };
  const [principal, perdedor, filhos] = await Promise.all([ler(db, tipo, principalId), ler(db, tipo, perdedorId), mescladosEm(db, tipo, perdedorId)]);
  const erro = validarMerge({ principal, perdedor, mescladosNoPerdedor: filhos });
  if (erro) return { ok: false, erro };
  const [cp, cd] = await Promise.all([contar(tipo, await idsDoGrupo(tipo, principalId)), contar(tipo, [perdedorId])]);
  return {
    ok: true,
    previa: {
      principal: { id: principal!.id, nome: principal!.nome, contagens: cp },
      perdedor: { id: perdedor!.id, nome: perdedor!.nome, contagens: cd },
      resultado: { pontos: cp.pontos + cd.pontos, contatos: cp.contatos + cd.contatos, oportunidades: cp.oportunidades + cd.oportunidades },
    },
  };
}

async function travarLinhas(tx: Tx, tipo: TipoMerge, ids: string[]) {
  const t = Prisma.raw(tipo === "contato" ? "contato" : "empresa");
  for (const id of [...new Set(ids)].sort()) await tx.$queryRaw`SELECT id FROM ${t} WHERE id = ${id} FOR UPDATE`;
}

export async function mesclar(tipo: TipoMerge, principalId: string, perdedorId: string, por: Ator): Promise<ResultadoLixeira> {
  if (!podeMesclar(por.papel)) return { ok: false, erro: "SEM_PERMISSAO" };
  try {
    await db.$transaction(async (tx) => {
      await travarLinhas(tx, tipo, [principalId, perdedorId]);
      const [principal, perdedor, filhos] = [await ler(tx, tipo, principalId), await ler(tx, tipo, perdedorId), await mescladosEm(tx, tipo, perdedorId)];
      const erro = validarMerge({ principal, perdedor, mescladosNoPerdedor: filhos });
      if (erro) throw new Falha(erro);
      if (tipo === "contato") await tx.contato.update({ where: { id: perdedorId }, data: { mergedIntoId: principalId } });
      else await tx.empresa.update({ where: { id: perdedorId }, data: { mergedIntoId: principalId } });
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof Falha) return { ok: false, erro: e.erro };
    throw e;
  }
}

/** Limpa o ponteiro: o registro volta a ser independente, com o que sempre foi dele. */
export async function desfazerMerge(tipo: TipoMerge, perdedorId: string, por: Ator): Promise<ResultadoLixeira<{ principalId: string }>> {
  if (!podeMesclar(por.papel)) return { ok: false, erro: "SEM_PERMISSAO" };
  try {
    const principalId = await db.$transaction(async (tx) => {
      await travarLinhas(tx, tipo, [perdedorId]);
      const l = await ler(tx, tipo, perdedorId);
      if (!l?.mergedIntoId) throw new Falha("NAO_MESCLADO");
      if (tipo === "contato") await tx.contato.update({ where: { id: perdedorId }, data: { mergedIntoId: null } });
      else await tx.empresa.update({ where: { id: perdedorId }, data: { mergedIntoId: null } });
      return l.mergedIntoId;
    });
    return { ok: true, principalId };
  } catch (e) {
    if (e instanceof Falha) return { ok: false, erro: e.erro };
    throw e;
  }
}

/**
 * Serviço de Contatos (GAB-31). Permissão é do chamador (`exigirUsuario`):
 * pela matriz de papéis (§4.5) qualquer usuário ativo cria/edita/vincula.
 *
 * Pontos de contato (telefone/email) **acumulam**: entram normalizados
 * (`normalizarPonto`) e são únicos no sistema por `(tipo, valor_normalizado)`.
 * Tentar gravar um ponto que já é de outro contato não cria nada: devolve
 * `PONTO_DUPLICADO` com o dono, para a UI oferecer "vincular o existente".
 * A corrida (dois inserts ao mesmo tempo) cai no unique do banco (P2002) e
 * vira a mesma resposta.
 *
 * Leitura nunca mostra contato soft-deletado ou mesclado, nem oportunidade
 * soft-deletada.
 */
import { Prisma, type TipoContatoPonto } from "@prisma/client";
import { db } from "@/lib/db";
import { normalizarPonto, type PontoNormalizado } from "@/lib/normalizacao";
import { interpretarCampoContato, validarNome, type CampoContato } from "@/lib/entidades/campos";
import { ordenarPorPrefixo } from "@/lib/entidades/busca";

type Cliente = Prisma.TransactionClient;

export type DonoPonto = { id: string; nome: string; deletado: boolean };

export type FalhaContato =
  | { ok: false; erro: "NOME_INVALIDO" | "CONTATO_NAO_ENCONTRADO" | "EMPRESA_NAO_ENCONTRADA" | "PONTO_NAO_ENCONTRADO" }
  | { ok: false; erro: "PONTO_INVALIDO"; valor: string }
  | { ok: false; erro: "CAMPO_INVALIDO"; mensagem: string }
  | { ok: false; erro: "PONTO_DUPLICADO"; ponto: PontoNormalizado; contato: DonoPonto };

export type ResultadoContato<T = object> = ({ ok: true } & T) | FalhaContato;

class Falha extends Error {
  constructor(readonly falha: FalhaContato) {
    super(falha.erro);
  }
}

const VIVO = { deletadoEm: null, mergedIntoId: null } as const;

export const PONTO_MAX = 200;

/** Normaliza a lista do formulário; repetição (mesmo valor normalizado) conta uma vez. */
function normalizarLista(entradas: string[]): (PontoNormalizado & { valorOriginal: string })[] {
  const vistos = new Map<string, PontoNormalizado & { valorOriginal: string }>();
  for (const bruto of entradas) {
    const original = bruto.trim();
    if (original === "") continue;
    const p = original.length <= PONTO_MAX ? normalizarPonto(original) : null;
    if (!p) throw new Falha({ ok: false, erro: "PONTO_INVALIDO", valor: original });
    const chave = `${p.tipo}:${p.valorNormalizado}`;
    if (!vistos.has(chave)) vistos.set(chave, { ...p, valorOriginal: original });
  }
  return [...vistos.values()];
}

async function donoDoPonto(cliente: Cliente, p: PontoNormalizado): Promise<DonoPonto | null> {
  const existente = await cliente.contatoPonto.findUnique({
    where: { tipo_valorNormalizado: { tipo: p.tipo, valorNormalizado: p.valorNormalizado } },
    select: { contato: { select: { id: true, nome: true, deletadoEm: true } } },
  });
  return existente ? { id: existente.contato.id, nome: existente.contato.nome, deletado: existente.contato.deletadoEm !== null } : null;
}

function ehUnicoViolado(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/** Corrida perdida no unique: descobre quem ficou com o ponto. */
async function falhaDeCorrida(pontos: PontoNormalizado[], excetoContatoId?: string): Promise<FalhaContato | null> {
  for (const p of pontos) {
    const dono = await donoDoPonto(db, p);
    if (dono && dono.id !== excetoContatoId) return { ok: false, erro: "PONTO_DUPLICADO", ponto: { tipo: p.tipo, valorNormalizado: p.valorNormalizado }, contato: dono };
  }
  return null;
}

async function empresaViva(cliente: Cliente, empresaId: string): Promise<boolean> {
  return (await cliente.empresa.count({ where: { id: empresaId, ...VIVO } })) > 0;
}

// ---------------------------------------------------------------- escrita

export async function criarContato(dados: { nome: string; empresaId?: string | null; cargo?: string | null; pontos?: string[] }): Promise<ResultadoContato<{ id: string }>> {
  const nome = validarNome(dados.nome);
  if (!nome) return { ok: false, erro: "NOME_INVALIDO" };
  const cargo = interpretarCampoContato("cargo", dados.cargo ?? "");
  if (!cargo.ok) return { ok: false, erro: "CAMPO_INVALIDO", mensagem: cargo.erro };
  let pontos: ReturnType<typeof normalizarLista> = [];
  try {
    pontos = normalizarLista(dados.pontos ?? []);
    const id = await db.$transaction(async (tx) => {
      if (dados.empresaId && !(await empresaViva(tx, dados.empresaId))) throw new Falha({ ok: false, erro: "EMPRESA_NAO_ENCONTRADA" });
      for (const p of pontos) {
        const dono = await donoDoPonto(tx, p);
        if (dono) throw new Falha({ ok: false, erro: "PONTO_DUPLICADO", ponto: { tipo: p.tipo, valorNormalizado: p.valorNormalizado }, contato: dono });
      }
      const c = await tx.contato.create({
        data: { nome, empresaId: dados.empresaId || null, cargo: cargo.valor, pontos: { create: pontos } },
        select: { id: true },
      });
      return c.id;
    });
    return { ok: true, id };
  } catch (e) {
    if (e instanceof Falha) return e.falha;
    if (ehUnicoViolado(e)) {
      const f = await falhaDeCorrida(pontos);
      if (f) return f;
    }
    throw e;
  }
}

/**
 * Acrescenta um ponto ao contato. Já é dele → ok, `jaExistia` (idempotente).
 * É de outro → `PONTO_DUPLICADO` com o dono. Sem `tipo`, decide pela forma.
 */
export async function adicionarPonto(contatoId: string, bruto: string, tipo?: TipoContatoPonto): Promise<ResultadoContato<{ pontoId: string; jaExistia: boolean }>> {
  const original = bruto.trim();
  const p = original.length <= PONTO_MAX ? normalizarPonto(original, tipo) : null;
  if (!p) return { ok: false, erro: "PONTO_INVALIDO", valor: original };
  try {
    return await db.$transaction(async (tx) => {
      const c = await tx.contato.findFirst({ where: { id: contatoId, ...VIVO }, select: { id: true } });
      if (!c) throw new Falha({ ok: false, erro: "CONTATO_NAO_ENCONTRADO" });
      const existente = await tx.contatoPonto.findUnique({
        where: { tipo_valorNormalizado: { tipo: p.tipo, valorNormalizado: p.valorNormalizado } },
        select: { id: true, contatoId: true },
      });
      if (existente?.contatoId === contatoId) return { ok: true as const, pontoId: existente.id, jaExistia: true };
      if (existente) {
        const dono = (await donoDoPonto(tx, p))!;
        throw new Falha({ ok: false, erro: "PONTO_DUPLICADO", ponto: p, contato: dono });
      }
      const novo = await tx.contatoPonto.create({ data: { contatoId, ...p, valorOriginal: original }, select: { id: true } });
      return { ok: true as const, pontoId: novo.id, jaExistia: false };
    });
  } catch (e) {
    if (e instanceof Falha) return e.falha;
    if (ehUnicoViolado(e)) {
      const f = await falhaDeCorrida([p], contatoId);
      if (f) return f;
    }
    throw e;
  }
}

/** Remove um ponto do contato (não apaga o contato: deleção é GAB-36). */
export async function removerPonto(contatoId: string, pontoId: string): Promise<ResultadoContato> {
  const r = await db.contatoPonto.deleteMany({ where: { id: pontoId, contatoId, contato: VIVO } });
  return r.count === 1 ? { ok: true } : { ok: false, erro: "PONTO_NAO_ENCONTRADO" };
}

export async function editarContato(id: string, campo: CampoContato, bruto: string): Promise<ResultadoContato> {
  const v = interpretarCampoContato(campo, bruto);
  if (!v.ok) return { ok: false, erro: "CAMPO_INVALIDO", mensagem: v.erro };
  const r = await db.contato.updateMany({ where: { id, ...VIVO }, data: { [campo]: v.valor } });
  return r.count === 1 ? { ok: true } : { ok: false, erro: "CONTATO_NAO_ENCONTRADO" };
}

export async function definirEmpresaDoContato(id: string, empresaId: string | null): Promise<ResultadoContato> {
  if (empresaId && !(await empresaViva(db, empresaId))) return { ok: false, erro: "EMPRESA_NAO_ENCONTRADA" };
  const r = await db.contato.updateMany({ where: { id, ...VIVO }, data: { empresaId } });
  return r.count === 1 ? { ok: true } : { ok: false, erro: "CONTATO_NAO_ENCONTRADO" };
}

// ---------------------------------------------------------------- leitura

const LISTA_MAX = 200;

/**
 * Lista para `/contatos`. Busca por nome (ILIKE, só para exibir) **ou** por
 * telefone/email: se a busca normaliza como ponto, casa o valor exato.
 */
export async function listarContatos(busca?: string) {
  const q = busca?.trim() ?? "";
  const ponto = q ? normalizarPonto(q) : null;
  const filtro: Prisma.ContatoWhereInput = q
    ? {
        OR: [
          { nome: { contains: q, mode: "insensitive" } },
          ...(ponto ? [{ pontos: { some: { tipo: ponto.tipo, valorNormalizado: ponto.valorNormalizado } } }] : []),
        ],
      }
    : {};
  return db.contato.findMany({
    where: { ...VIVO, ...filtro },
    orderBy: [{ nome: "asc" }, { id: "asc" }],
    take: LISTA_MAX,
    select: {
      id: true,
      nome: true,
      cargo: true,
      empresa: { select: { id: true, nome: true } },
      pontos: { orderBy: { criadoEm: "asc" }, select: { id: true, tipo: true, valorNormalizado: true } },
      _count: { select: { oportunidades: { where: { deletadoEm: null } } } },
    },
  });
}

export async function obterContato(id: string) {
  return db.contato.findFirst({
    where: { id, ...VIVO },
    include: {
      empresa: { select: { id: true, nome: true, deletadoEm: true } },
      pontos: { orderBy: { criadoEm: "asc" } },
      oportunidades: {
        where: { deletadoEm: null },
        orderBy: [{ atualizadoEm: "desc" }, { id: "asc" }],
        select: {
          id: true,
          titulo: true,
          pipeline: { select: { chave: true, nome: true } },
          fase: { select: { nome: true, tipoTerminal: true } },
          responsavel: { select: { nome: true } },
          empresa: { select: { id: true, nome: true } },
        },
      },
    },
  });
}

export type DetalheContato = NonNullable<Awaited<ReturnType<typeof obterContato>>>;

export type OpcaoContato = { id: string; nome: string; empresa: string | null };

/** Autocomplete por nome (só exibição; vínculo é explícito): prefixo primeiro, depois "contém". */
export async function buscarContatosPorNome(busca: string, limite = 8): Promise<OpcaoContato[]> {
  const q = busca.trim().slice(0, 100);
  if (!q) return [];
  const achados = await db.contato.findMany({
    where: { ...VIVO, nome: { contains: q, mode: "insensitive" } },
    orderBy: [{ nome: "asc" }, { id: "asc" }],
    take: limite * 3,
    select: { id: true, nome: true, empresa: { select: { nome: true } } },
  });
  return ordenarPorPrefixo(achados, q)
    .slice(0, limite)
    .map((c) => ({ id: c.id, nome: c.nome, empresa: c.empresa?.nome ?? null }));
}

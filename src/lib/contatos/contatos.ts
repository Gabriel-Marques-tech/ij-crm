/**
 * Serviço de Contatos (GAB-31). Permissão é do chamador (`exigirEscrita`):
 * pela matriz de papéis (§4.5) qualquer usuário ativo que escreve (não VISUALIZADOR) cria/edita/vincula.
 *
 * Pontos de contato (telefone/email) **acumulam**: entram normalizados
 * (`normalizarPonto`) e são únicos no sistema por `(tipo, valor_normalizado)`.
 * Tentar gravar um ponto que já é de outro contato não cria nada: devolve
 * `PONTO_DUPLICADO` com o dono, para a UI oferecer "vincular o existente".
 * A corrida (dois inserts ao mesmo tempo) cai no unique do banco (P2002) e
 * vira a mesma resposta.
 *
 * Leitura nunca mostra contato soft-deletado ou mesclado, nem projeto
 * soft-deletada. Merge (GAB-36) é soft-pointer: o principal mostra os pontos
 * e os projetos dos mesclados nele (consulta pelo grupo, nada copiado).
 */
import { Prisma, type TipoContatoPonto } from "@prisma/client";
import { db } from "@/lib/db";
import { normalizarPonto, type PontoNormalizado } from "@/lib/normalizacao";
import { interpretarCampoContato, validarNome, type CampoContato } from "@/lib/entidades/campos";
import { prefixoPrimeiro, termoDeBusca } from "@/lib/entidades/busca";
import { SELECAO_REF, descreverVinculos } from "@/lib/entidades/vinculo";
import { idsDoGrupo } from "@/lib/merge/merge";
import { resolverContatos } from "./match";

type Cliente = Prisma.TransactionClient;

/** Dono de um ponto = fim da cadeia de merge. `deletado` → a UI não oferece link nem vínculo. */
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

/**
 * Normaliza a lista do formulário; repetição (mesmo valor normalizado) conta
 * uma vez. Sai ordenada por (tipo, valor): dois inserts concorrentes tocam o
 * índice único na mesma ordem e não se travam em deadlock (40P01).
 */
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
  return [...vistos.values()].sort((a, b) => (a.tipo === b.tipo ? (a.valorNormalizado < b.valorNormalizado ? -1 : 1) : a.tipo < b.tipo ? -1 : 1));
}

/** Ponto já gravado: id, contato que o guarda e o dono resolvido (cadeia de merge). */
async function pontoExistente(cliente: Cliente, p: PontoNormalizado): Promise<{ id: string; contatoId: string; dono: DonoPonto } | null> {
  const existente = await cliente.contatoPonto.findUnique({
    where: { tipo_valorNormalizado: { tipo: p.tipo, valorNormalizado: p.valorNormalizado } },
    select: { id: true, contatoId: true, contato: { select: { nome: true } } },
  });
  if (!existente) return null;
  const r = (await resolverContatos([existente.contatoId], cliente)).get(existente.contatoId);
  // Cadeia quebrada (ciclo) conta como excluído: sem link, sem "vincular?".
  const dono = r ? { id: r.id, nome: r.nome, deletado: r.deletado } : { id: existente.contatoId, nome: existente.contato.nome, deletado: true };
  return { id: existente.id, contatoId: existente.contatoId, dono };
}

function duplicado(p: PontoNormalizado, dono: DonoPonto): FalhaContato {
  return { ok: false, erro: "PONTO_DUPLICADO", ponto: { tipo: p.tipo, valorNormalizado: p.valorNormalizado }, contato: dono };
}

/** P2002 no unique de `contato_ponto (tipo, valor_normalizado)` — e só nele. */
function ehPontoDuplicadoNoBanco(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  const alvo = (e.meta as { target?: unknown; modelName?: unknown } | undefined)?.target;
  const texto = Array.isArray(alvo) ? alvo.join(",") : String(alvo ?? "");
  return /valor_?normalizado/i.test(texto);
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
        const existente = await pontoExistente(tx, p);
        if (existente) throw new Falha(duplicado(p, existente.dono));
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
    if (ehPontoDuplicadoNoBanco(e)) {
      // Corrida perdida: descobre quem ficou com o ponto.
      for (const p of pontos) {
        const existente = await pontoExistente(db, p);
        if (existente) return duplicado(p, existente.dono);
      }
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
      const existente = await pontoExistente(tx, p);
      // Já é dele, direto ou de um contato mesclado nele (o dono resolvido é ele).
      if (existente && (existente.contatoId === contatoId || existente.dono.id === contatoId)) return { ok: true as const, pontoId: existente.id, jaExistia: true };
      if (existente) throw new Falha(duplicado(p, existente.dono));
      const novo = await tx.contatoPonto.create({ data: { contatoId, ...p, valorOriginal: original }, select: { id: true } });
      return { ok: true as const, pontoId: novo.id, jaExistia: false };
    });
  } catch (e) {
    if (e instanceof Falha) return e.falha;
    if (ehPontoDuplicadoNoBanco(e)) {
      const existente = await pontoExistente(db, p);
      // Duplo envio do mesmo formulário: o outro insert foi deste contato.
      if (existente && (existente.contatoId === contatoId || existente.dono.id === contatoId)) return { ok: true, pontoId: existente.id, jaExistia: true };
      if (existente) return duplicado(p, existente.dono);
    }
    throw e;
  }
}

/** Remove um ponto do contato — inclusive um que veio de contato mesclado nele (aparece no principal). */
export async function removerPonto(contatoId: string, pontoId: string): Promise<ResultadoContato> {
  const r = await db.contatoPonto.deleteMany({
    where: {
      id: pontoId,
      OR: [{ contatoId, contato: VIVO }, { contato: { mergedIntoId: contatoId, deletadoEm: null, mergedInto: VIVO } }],
    },
  });
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
 * Lista para `/contatos`. Busca por nome (ILIKE escapado, só para exibir)
 * **ou** por telefone/email: se a busca normaliza como ponto, casa o valor
 * exato. A empresa de cada contato vem descrita (`Vinculo`): excluída ou
 * mesclada nunca aparece como ativa.
 */
export async function listarContatos(busca?: string) {
  const q = termoDeBusca(busca);
  const ponto = busca?.trim() ? normalizarPonto(busca.trim()) : null;
  const filtro: Prisma.ContatoWhereInput = q
    ? {
        OR: [
          { nome: { contains: q, mode: "insensitive" } },
          ...(ponto
            ? [
                { pontos: { some: { tipo: ponto.tipo, valorNormalizado: ponto.valorNormalizado } } },
                // Ponto de um mesclado: acha o principal.
                { mergedFrom: { some: { deletadoEm: null, pontos: { some: { tipo: ponto.tipo, valorNormalizado: ponto.valorNormalizado } } } } },
              ]
            : []),
        ],
      }
    : {};
  const lista = await db.contato.findMany({
    where: { ...VIVO, ...filtro },
    orderBy: [{ nome: "asc" }, { id: "asc" }],
    take: LISTA_MAX,
    select: {
      id: true,
      nome: true,
      cargo: true,
      empresa: { select: SELECAO_REF },
      pontos: { orderBy: { criadoEm: "asc" }, select: { id: true, tipo: true, valorNormalizado: true } },
      _count: { select: { projetos: { where: { deletadoEm: null } } } },
      // Mesclados neste: pontos e projetos aparecem aqui (soft-pointer).
      mergedFrom: {
        where: { deletadoEm: null },
        select: {
          pontos: { orderBy: { criadoEm: "asc" }, select: { id: true, tipo: true, valorNormalizado: true } },
          _count: { select: { projetos: { where: { deletadoEm: null } } } },
        },
      },
    },
  });
  const empresas = await descreverVinculos("empresa", lista.map((c) => c.empresa));
  return lista.map(({ mergedFrom, ...c }) => ({
    ...c,
    pontos: [...c.pontos, ...mergedFrom.flatMap((m) => m.pontos)],
    _count: { projetos: c._count.projetos + mergedFrom.reduce((s, m) => s + m._count.projetos, 0) },
    empresa: c.empresa ? (empresas.get(c.empresa.id) ?? null) : null,
  }));
}

export async function obterContato(id: string) {
  const c = await db.contato.findFirst({
    where: { id, ...VIVO },
    include: { empresa: { select: SELECAO_REF } },
  });
  if (!c) return null;
  // Grupo de merge: o próprio + os mesclados nele. Pontos e projetos são lidos pelo grupo.
  const grupo = await idsDoGrupo("contato", id);
  const [pontos, projetos] = await Promise.all([
    db.contatoPonto.findMany({ where: { contatoId: { in: grupo } }, orderBy: [{ tipo: "asc" }, { criadoEm: "asc" }, { id: "asc" }] }),
    db.projeto.findMany({
        where: { contatoId: { in: grupo }, deletadoEm: null },
        orderBy: [{ atualizadoEm: "desc" }, { id: "asc" }],
        select: {
          id: true,
          titulo: true,
          pipeline: { select: { chave: true, nome: true } },
          fase: { select: { nome: true, tipoTerminal: true } },
          responsavel: { select: { nome: true } },
          empresa: { select: SELECAO_REF },
        },
      }),
  ]);
  const empresas = await descreverVinculos("empresa", [c.empresa, ...projetos.map((o) => o.empresa)]);
  const desc = (r: { id: string } | null) => (r ? (empresas.get(r.id) ?? null) : null);
  return { ...c, pontos, empresa: desc(c.empresa), projetos: projetos.map((o) => ({ ...o, empresa: desc(o.empresa) })) };
}

export type DetalheContato = NonNullable<Awaited<ReturnType<typeof obterContato>>>;

export type OpcaoContato = { id: string; nome: string; empresa: string | null };

/** Autocomplete por nome (só exibição; vínculo é explícito): prefixo primeiro, depois "contém". */
export async function buscarContatosPorNome(busca: string, limite = 8): Promise<OpcaoContato[]> {
  const q = termoDeBusca(busca);
  if (!q) return [];
  const achados = await prefixoPrimeiro(limite, (modo, excluir, take) =>
    db.contato.findMany({
      where: { ...VIVO, nome: modo === "prefixo" ? { startsWith: q, mode: "insensitive" } : { contains: q, mode: "insensitive" }, id: { notIn: excluir } },
      orderBy: [{ nome: "asc" }, { id: "asc" }],
      take,
      // Só empresa viva aparece como detalhe da opção.
      select: { id: true, nome: true, empresa: { select: { nome: true, deletadoEm: true, mergedIntoId: true } } },
    }),
  );
  return achados.map((c) => ({ id: c.id, nome: c.nome, empresa: c.empresa && !c.empresa.deletadoEm && !c.empresa.mergedIntoId ? c.empresa.nome : null }));
}

/**
 * Serviço de Empresas (GAB-31). Permissão é do chamador (`exigirUsuario`).
 *
 * CNPJ entra normalizado (alfanumérico, `normalizarCnpj`) e é único quando
 * presente: repetir um CNPJ devolve `CNPJ_DUPLICADO` com a empresa dona.
 * Domínio de email entra normalizado e nunca é provedor pessoal (gmail…).
 * Leitura nunca mostra empresa soft-deletada/mesclada nem oportunidade
 * soft-deletada.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { normalizarCnpj, normalizarDominio } from "@/lib/normalizacao";
import { interpretarCampoEmpresa, interpretarCnpj, interpretarDominio, validarNome, type CampoEmpresa } from "@/lib/entidades/campos";
import { prefixoPrimeiro, termoDeBusca } from "@/lib/entidades/busca";
import { SELECAO_REF, descreverVinculos } from "@/lib/entidades/vinculo";
import { resolverEmpresas } from "@/lib/contatos/match";

export type FalhaEmpresa =
  | { ok: false; erro: "NOME_INVALIDO" | "EMPRESA_NAO_ENCONTRADA" }
  | { ok: false; erro: "CAMPO_INVALIDO"; mensagem: string }
  /** `empresa` = fim da cadeia de merge de quem guarda o CNPJ; `deletado` → sem link. */
  | { ok: false; erro: "CNPJ_DUPLICADO"; empresa: { id: string; nome: string; deletado: boolean } };

export type ResultadoEmpresa<T = object> = ({ ok: true } & T) | FalhaEmpresa;

const VIVO = { deletadoEm: null, mergedIntoId: null } as const;

/** Quem guarda o CNPJ (`guardaId`) e o dono resolvido pela cadeia de merge. */
async function donoDoCnpj(cnpj: string): Promise<{ guardaId: string; dono: { id: string; nome: string; deletado: boolean } } | null> {
  const e = await db.empresa.findUnique({ where: { cnpj }, select: { id: true, nome: true } });
  if (!e) return null;
  const r = (await resolverEmpresas([e.id])).get(e.id);
  return { guardaId: e.id, dono: r ? { id: r.id, nome: r.nome, deletado: r.deletado } : { id: e.id, nome: e.nome, deletado: true } };
}

function ehCnpjDuplicado(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  const alvo = (e.meta as { target?: unknown } | undefined)?.target;
  return Array.isArray(alvo) ? alvo.includes("cnpj") : String(alvo ?? "").includes("cnpj");
}

export async function criarEmpresa(dados: { nome: string; cnpj?: string; dominioEmail?: string }): Promise<ResultadoEmpresa<{ id: string }>> {
  const nome = validarNome(dados.nome);
  if (!nome) return { ok: false, erro: "NOME_INVALIDO" };
  const cnpj = interpretarCnpj(dados.cnpj ?? "");
  if (!cnpj.ok) return { ok: false, erro: "CAMPO_INVALIDO", mensagem: cnpj.erro };
  const dominio = interpretarDominio(dados.dominioEmail ?? "");
  if (!dominio.ok) return { ok: false, erro: "CAMPO_INVALIDO", mensagem: dominio.erro };
  if (cnpj.valor) {
    const dono = await donoDoCnpj(cnpj.valor);
    if (dono) return { ok: false, erro: "CNPJ_DUPLICADO", empresa: dono.dono };
  }
  try {
    const e = await db.empresa.create({ data: { nome, cnpj: cnpj.valor, dominioEmail: dominio.valor }, select: { id: true } });
    return { ok: true, id: e.id };
  } catch (e) {
    if (cnpj.valor && ehCnpjDuplicado(e)) {
      const dono = await donoDoCnpj(cnpj.valor);
      if (dono) return { ok: false, erro: "CNPJ_DUPLICADO", empresa: dono.dono };
    }
    throw e;
  }
}

export async function editarEmpresa(id: string, campo: CampoEmpresa, bruto: string): Promise<ResultadoEmpresa> {
  const v = interpretarCampoEmpresa(campo, bruto);
  if (!v.ok) return { ok: false, erro: "CAMPO_INVALIDO", mensagem: v.erro };
  if (campo === "cnpj" && v.valor) {
    const dono = await donoDoCnpj(v.valor);
    if (dono && dono.guardaId !== id) return { ok: false, erro: "CNPJ_DUPLICADO", empresa: dono.dono };
  }
  try {
    const r = await db.empresa.updateMany({ where: { id, ...VIVO }, data: { [campo]: v.valor } });
    return r.count === 1 ? { ok: true } : { ok: false, erro: "EMPRESA_NAO_ENCONTRADA" };
  } catch (e) {
    if (campo === "cnpj" && v.valor && ehCnpjDuplicado(e)) {
      const dono = await donoDoCnpj(v.valor);
      if (dono) return { ok: false, erro: "CNPJ_DUPLICADO", empresa: dono.dono };
    }
    throw e;
  }
}

// ---------------------------------------------------------------- leitura

const LISTA_MAX = 200;

/** Lista para `/empresas`: nome (ILIKE escapado, só exibição) ou CNPJ/domínio exatos. */
export async function listarEmpresas(busca?: string) {
  const bruto = busca?.trim() ?? "";
  const q = termoDeBusca(bruto);
  const cnpj = bruto ? normalizarCnpj(bruto) : null;
  const dominio = bruto ? normalizarDominio(bruto) : null;
  const filtro: Prisma.EmpresaWhereInput = q
    ? {
        OR: [
          { nome: { contains: q, mode: "insensitive" } },
          ...(cnpj ? [{ cnpj }] : []),
          ...(dominio ? [{ dominioEmail: dominio }] : []),
        ],
      }
    : {};
  return db.empresa.findMany({
    where: { ...VIVO, ...filtro },
    orderBy: [{ nome: "asc" }, { id: "asc" }],
    take: LISTA_MAX,
    select: {
      id: true,
      nome: true,
      cnpj: true,
      dominioEmail: true,
      cidade: true,
      estado: true,
      _count: { select: { contatos: { where: VIVO }, oportunidades: { where: { deletadoEm: null } } } },
    },
  });
}

export async function obterEmpresa(id: string) {
  const e = await db.empresa.findFirst({
    where: { id, ...VIVO },
    include: {
      contatos: {
        where: VIVO,
        orderBy: [{ nome: "asc" }, { id: "asc" }],
        select: { id: true, nome: true, cargo: true, pontos: { orderBy: [{ tipo: "asc" }, { criadoEm: "asc" }], select: { id: true, tipo: true, valorNormalizado: true } } },
      },
      oportunidades: {
        where: { deletadoEm: null },
        orderBy: [{ atualizadoEm: "desc" }, { id: "asc" }],
        select: {
          id: true,
          titulo: true,
          pipeline: { select: { chave: true, nome: true } },
          fase: { select: { nome: true, tipoTerminal: true } },
          responsavel: { select: { nome: true } },
          contato: { select: SELECAO_REF },
        },
      },
    },
  });
  if (!e) return null;
  const contatos = await descreverVinculos("contato", e.oportunidades.map((o) => o.contato));
  return { ...e, oportunidades: e.oportunidades.map((o) => ({ ...o, contato: o.contato ? (contatos.get(o.contato.id) ?? null) : null })) };
}

export type DetalheEmpresa = NonNullable<Awaited<ReturnType<typeof obterEmpresa>>>;

export type OpcaoEmpresa = { id: string; nome: string; cnpj: string | null };

/** Autocomplete por nome (só exibição; vínculo é explícito): prefixo primeiro, depois "contém". */
export async function buscarEmpresasPorNome(busca: string, limite = 8): Promise<OpcaoEmpresa[]> {
  const q = termoDeBusca(busca);
  if (!q) return [];
  return prefixoPrimeiro(limite, (modo, excluir, take) =>
    db.empresa.findMany({
      where: { ...VIVO, nome: modo === "prefixo" ? { startsWith: q, mode: "insensitive" } : { contains: q, mode: "insensitive" }, id: { notIn: excluir } },
      orderBy: [{ nome: "asc" }, { id: "asc" }],
      take,
      select: { id: true, nome: true, cnpj: true },
    }),
  );
}

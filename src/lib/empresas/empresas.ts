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
import { ordenarPorPrefixo } from "@/lib/entidades/busca";

export type FalhaEmpresa =
  | { ok: false; erro: "NOME_INVALIDO" | "EMPRESA_NAO_ENCONTRADA" }
  | { ok: false; erro: "CAMPO_INVALIDO"; mensagem: string }
  | { ok: false; erro: "CNPJ_DUPLICADO"; empresa: { id: string; nome: string } };

export type ResultadoEmpresa<T = object> = ({ ok: true } & T) | FalhaEmpresa;

const VIVO = { deletadoEm: null, mergedIntoId: null } as const;

async function donoDoCnpj(cnpj: string) {
  return db.empresa.findUnique({ where: { cnpj }, select: { id: true, nome: true } });
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
    if (dono) return { ok: false, erro: "CNPJ_DUPLICADO", empresa: dono };
  }
  try {
    const e = await db.empresa.create({ data: { nome, cnpj: cnpj.valor, dominioEmail: dominio.valor }, select: { id: true } });
    return { ok: true, id: e.id };
  } catch (e) {
    if (cnpj.valor && ehCnpjDuplicado(e)) {
      const dono = await donoDoCnpj(cnpj.valor);
      if (dono) return { ok: false, erro: "CNPJ_DUPLICADO", empresa: dono };
    }
    throw e;
  }
}

export async function editarEmpresa(id: string, campo: CampoEmpresa, bruto: string): Promise<ResultadoEmpresa> {
  const v = interpretarCampoEmpresa(campo, bruto);
  if (!v.ok) return { ok: false, erro: "CAMPO_INVALIDO", mensagem: v.erro };
  if (campo === "cnpj" && v.valor) {
    const dono = await donoDoCnpj(v.valor);
    if (dono && dono.id !== id) return { ok: false, erro: "CNPJ_DUPLICADO", empresa: dono };
  }
  try {
    const r = await db.empresa.updateMany({ where: { id, ...VIVO }, data: { [campo]: v.valor } });
    return r.count === 1 ? { ok: true } : { ok: false, erro: "EMPRESA_NAO_ENCONTRADA" };
  } catch (e) {
    if (campo === "cnpj" && v.valor && ehCnpjDuplicado(e)) {
      const dono = await donoDoCnpj(v.valor);
      if (dono) return { ok: false, erro: "CNPJ_DUPLICADO", empresa: dono };
    }
    throw e;
  }
}

// ---------------------------------------------------------------- leitura

const LISTA_MAX = 200;

/** Lista para `/empresas`: nome (ILIKE, só exibição) ou CNPJ/domínio exatos. */
export async function listarEmpresas(busca?: string) {
  const q = busca?.trim() ?? "";
  const cnpj = q ? normalizarCnpj(q) : null;
  const dominio = q ? normalizarDominio(q) : null;
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
  return db.empresa.findFirst({
    where: { id, ...VIVO },
    include: {
      contatos: {
        where: VIVO,
        orderBy: [{ nome: "asc" }, { id: "asc" }],
        select: { id: true, nome: true, cargo: true, pontos: { orderBy: { criadoEm: "asc" }, select: { id: true, tipo: true, valorNormalizado: true } } },
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
          contato: { select: { id: true, nome: true } },
        },
      },
    },
  });
}

export type DetalheEmpresa = NonNullable<Awaited<ReturnType<typeof obterEmpresa>>>;

export type OpcaoEmpresa = { id: string; nome: string; cnpj: string | null };

/** Autocomplete por nome (só exibição; vínculo é explícito): prefixo primeiro. */
export async function buscarEmpresasPorNome(busca: string, limite = 8): Promise<OpcaoEmpresa[]> {
  const q = busca.trim().slice(0, 100);
  if (!q) return [];
  const achadas = await db.empresa.findMany({
    where: { ...VIVO, nome: { contains: q, mode: "insensitive" } },
    orderBy: [{ nome: "asc" }, { id: "asc" }],
    take: limite * 3,
    select: { id: true, nome: true, cnpj: true },
  });
  return ordenarPorPrefixo(achadas, q).slice(0, limite);
}

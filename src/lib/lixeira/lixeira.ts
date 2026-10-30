/**
 * Leitura da Lixeira (Gestão → Lixeira, gestor+). Permissão é do chamador
 * (`exigirPapel("GESTOR")`). Busca por nome/título (ILIKE escapado), e para
 * contatos também telefone/email exatos, para empresas CNPJ exato.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { termoDeBusca } from "@/lib/entidades/busca";
import { listarPipelines } from "@/lib/fases/fases";
import { destinoCompativel } from "@/lib/fases/regras";
import { normalizarCnpj, normalizarPonto } from "@/lib/normalizacao";

const LISTA_MAX = 200;

export type CardNaLixeira = {
  id: string;
  titulo: string;
  deletadoEm: Date;
  porNome: string | null;
  pipeline: { chave: string; nome: string };
  fase: { id: string; nome: string; arquivada: boolean };
  empresa: string | null;
  /** Ficam sem card ao apagar de vez (FK SET NULL): para avisar na confirmação. */
  mensagensEnviadas: number;
  reaberturas: number;
  /** Fase original arquivada: fases ativas do mesmo quadro e tipo para escolher. Vazio = volta para a original. */
  opcoesFase: { id: string; nome: string }[];
};

export async function listarCardsNaLixeira(busca?: string): Promise<CardNaLixeira[]> {
  const q = termoDeBusca(busca);
  const cards = await db.projeto.findMany({
    where: { deletadoEm: { not: null }, ...(q ? { titulo: { contains: q, mode: "insensitive" } } : {}) },
    orderBy: [{ deletadoEm: "desc" }, { id: "asc" }],
    take: LISTA_MAX,
    select: {
      id: true,
      titulo: true,
      deletadoEm: true,
      pipeline: { select: { chave: true, nome: true } },
      fase: { select: { id: true, nome: true, arquivadaEm: true, tipoTerminal: true, pipelineId: true } },
      empresa: { select: { nome: true } },
      timeline: { where: { tipo: "EXCLUSAO" }, orderBy: [{ em: "desc" }, { id: "desc" }], take: 1, select: { usuario: { select: { nome: true } } } },
      _count: { select: { mensagensEnviadas: true, reaberturas: true } },
    },
  });
  const ativas = cards.some((c) => c.fase.arquivadaEm) ? (await listarPipelines()).flatMap((p) => p.fases) : [];
  return cards.map((c) => ({
    id: c.id,
    titulo: c.titulo,
    deletadoEm: c.deletadoEm!,
    porNome: c.timeline[0]?.usuario?.nome ?? null,
    pipeline: c.pipeline,
    fase: { id: c.fase.id, nome: c.fase.nome, arquivada: c.fase.arquivadaEm !== null },
    empresa: c.empresa?.nome ?? null,
    mensagensEnviadas: c._count.mensagensEnviadas,
    reaberturas: c._count.reaberturas,
    opcoesFase: c.fase.arquivadaEm
      ? ativas.filter((f) => f.pipelineId === c.fase.pipelineId && destinoCompativel(c.fase, f)).map((f) => ({ id: f.id, nome: f.nome }))
      : [],
  }));
}

export async function listarContatosNaLixeira(busca?: string) {
  const q = termoDeBusca(busca);
  const ponto = busca?.trim() ? normalizarPonto(busca.trim()) : null;
  const filtro: Prisma.ContatoWhereInput = q
    ? { OR: [{ nome: { contains: q, mode: "insensitive" } }, ...(ponto ? [{ pontos: { some: { tipo: ponto.tipo, valorNormalizado: ponto.valorNormalizado } } }] : [])] }
    : {};
  return db.contato.findMany({
    where: { deletadoEm: { not: null }, ...filtro },
    orderBy: [{ deletadoEm: "desc" }, { id: "asc" }],
    take: LISTA_MAX,
    select: {
      id: true,
      nome: true,
      deletadoEm: true,
      empresa: { select: { nome: true } },
      pontos: { orderBy: { criadoEm: "asc" }, select: { id: true, tipo: true, valorNormalizado: true } },
      _count: { select: { projetos: { where: { deletadoEm: null } }, mergedFrom: true } },
    },
  });
}

export async function listarEmpresasNaLixeira(busca?: string) {
  const q = termoDeBusca(busca);
  const cnpj = busca?.trim() ? normalizarCnpj(busca.trim()) : null;
  const filtro: Prisma.EmpresaWhereInput = q ? { OR: [{ nome: { contains: q, mode: "insensitive" } }, ...(cnpj ? [{ cnpj }] : [])] } : {};
  return db.empresa.findMany({
    where: { deletadoEm: { not: null }, ...filtro },
    orderBy: [{ deletadoEm: "desc" }, { id: "asc" }],
    take: LISTA_MAX,
    select: {
      id: true,
      nome: true,
      cnpj: true,
      deletadoEm: true,
      _count: { select: { contatos: { where: { deletadoEm: null } }, projetos: { where: { deletadoEm: null } }, mergedFrom: true } },
    },
  });
}

export type ContatoNaLixeira = Awaited<ReturnType<typeof listarContatosNaLixeira>>[number];
export type EmpresaNaLixeira = Awaited<ReturnType<typeof listarEmpresasNaLixeira>>[number];

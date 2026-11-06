"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { CategoriaEvento, DirecaoKpi, PapelRaci, StatusMembro, TipoDemanda } from "@prisma/client";
import { exigirUsuario } from "@/lib/auth/atual";
import { criarConvite, atualizarUsuario } from "@/lib/auth/usuarios";
import { resolverAreaCargos } from "@/lib/auth/areas";
import { db } from "@/lib/db";
import { comTratamento, type Inesperado } from "@/lib/erros/registrar";
import { contaDifere, STATUS_MEMBRO, validarImportacao } from "@/lib/gg/modelo";
import * as org from "@/lib/gg/organizacao";
import * as rot from "@/lib/gg/rotina";
import { diaEmFuso } from "@/lib/projetos/aging";

/**
 * Actions da área G&G. Toda uma: sessão → zod → serviço (que confere quem edita:
 * `ehEditorGG`). Erro de regra volta como `{ erro }` com a mensagem pronta.
 */
export type EstadoGG = { ok: true; id?: string; link?: string; quantidade?: number; ligados?: number } | { erro: string } | Inesperado;

const id = z.string().min(1).max(64);
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const INVALIDO: EstadoGG = { erro: "Dados inválidos." };

type Res = { ok: true; id?: string; quantidade?: number; ligados?: number } | { ok: false; erro: string; detalhe?: string };
const MENSAGENS: Record<string, string> = { ...org.MENSAGEM_ERRO_ORG, ...rot.MENSAGEM_ERRO_ROTINA };

async function rodar(contexto: string, corpo: (ator: org.AtorGG) => Promise<Res | EstadoGG>): Promise<EstadoGG> {
  return comTratamento(contexto, async (): Promise<EstadoGG> => {
    const u = await exigirUsuario();
    const r = await corpo({ id: u.id, nome: u.nome, papel: u.papel });
    if ("ok" in r && r.ok === false && "erro" in r && typeof r.erro === "string" && r.erro !== "INESPERADO") return { erro: (r as { detalhe?: string }).detalhe ?? MENSAGENS[r.erro] ?? "Não foi possível concluir." };
    revalidatePath("/gg", "layout");
    return r as EstadoGG;
  });
}
const parse = <T>(s: z.ZodType<T>, v: unknown): T | null => {
  const p = s.safeParse(v);
  return p.success ? p.data : null;
};

// ---------------------------------------------------------------- fatia A

const membroSchema = z.object({ nome: z.string().max(200), email: z.string().max(254).nullable(), status: z.enum(STATUS_MEMBRO as [StatusMembro, ...StatusMembro[]]), entrada: dia.nullable().optional() });

export async function criarMembroAction(dados: unknown): Promise<EstadoGG> {
  const d = parse(membroSchema, dados);
  return d ? rodar("gg.membro.criar", (a) => org.criarMembro(d, a)) : INVALIDO;
}
export async function editarMembroAction(membroId: string, dados: unknown): Promise<EstadoGG> {
  const d = parse(membroSchema, dados);
  return d && parse(id, membroId) ? rodar("gg.membro.editar", (a) => org.editarMembro(membroId, d, a)) : INVALIDO;
}
export async function ligarContasAction(): Promise<EstadoGG> {
  return rodar("gg.membro.ligar", (a) => org.ligarContasPorEmail(a));
}
export async function registrarSaidaAction(membroId: string, data: string): Promise<EstadoGG> {
  return parse(id, membroId) && parse(dia, data) ? rodar("gg.membro.saida", (a) => org.registrarSaida(membroId, data, a)) : INVALIDO;
}
export async function registrarEntradaAction(membroId: string, data: string): Promise<EstadoGG> {
  return parse(id, membroId) && parse(dia, data) ? rodar("gg.membro.entrada", (a) => org.registrarEntrada(membroId, data, a)) : INVALIDO;
}
export async function adicionarOcupanteAction(posicaoId: string, membroId: string, inicio: string | null): Promise<EstadoGG> {
  return parse(id, posicaoId) && parse(id, membroId) && (inicio === null || parse(dia, inicio)) ? rodar("gg.ocupacao.adicionar", (a) => org.adicionarOcupante(posicaoId, membroId, inicio, a)) : INVALIDO;
}
export async function encerrarOcupacaoAction(ocupacaoId: string, fim: string): Promise<EstadoGG> {
  return parse(id, ocupacaoId) && parse(dia, fim) ? rodar("gg.ocupacao.encerrar", (a) => org.encerrarOcupacao(ocupacaoId, fim, a)) : INVALIDO;
}
export async function retirarPorErroAction(ocupacaoId: string, motivo: string): Promise<EstadoGG> {
  return parse(id, ocupacaoId) && parse(z.string().max(500), motivo) !== null ? rodar("gg.ocupacao.retirar", (a) => org.retirarPorErro(ocupacaoId, motivo, a)) : INVALIDO;
}
export async function trocarCargoAction(ocupacaoId: string, destinoId: string, tipo: string, data: string | null): Promise<EstadoGG> {
  const t = parse(z.enum(["real", "correcao"]), tipo);
  return parse(id, ocupacaoId) && parse(id, destinoId) && t && (data === null || parse(dia, data)) ? rodar("gg.ocupacao.trocar", (a) => org.trocarCargo(ocupacaoId, destinoId, t, data, a)) : INVALIDO;
}
export async function tornarPrincipalAction(ocupacaoId: string): Promise<EstadoGG> {
  return parse(id, ocupacaoId) ? rodar("gg.ocupacao.principal", (a) => org.tornarPrincipal(ocupacaoId, a)) : INVALIDO;
}
const posicaoSchema = z.object({ nome: z.string().max(200), areaId: id, cargoId: id, liderancaId: id.nullable() });
export async function salvarPosicaoAction(posicaoId: string | null, dados: unknown): Promise<EstadoGG> {
  const d = parse(posicaoSchema, dados);
  if (!d || (posicaoId !== null && !parse(id, posicaoId))) return INVALIDO;
  return rodar("gg.posicao.salvar", (a) => (posicaoId ? org.editarPosicao(posicaoId, d, a) : org.criarPosicao(d, a)));
}
export async function importarMembrosAction(json: string, chave: string): Promise<EstadoGG> {
  if (!parse(z.string().uuid(), chave) || json.length > 2_000_000) return INVALIDO;
  return rodar("gg.importar", async (a) => {
    let linhas;
    try {
      linhas = validarImportacao(JSON.parse(json), diaEmFuso(new Date()));
    } catch (e) {
      return { erro: e instanceof SyntaxError ? "JSON inválido." : (e as Error).message };
    }
    return org.importarMembros(linhas, chave, a);
  });
}

/**
 * Ponte com a conta do CRM: aplicar o que o organograma sugere ou convidar quem não tem
 * conta. Passa pelas regras de Gestão (`auth/usuarios`): só gestor/admin muda conta.
 */
export async function aplicarNoCrmAction(membroId: string): Promise<EstadoGG> {
  if (!parse(id, membroId)) return INVALIDO;
  return rodar("gg.ponte.aplicar", async (a) => {
    const base = await org.carregarBase();
    const m = base.membros.find((x) => x.id === membroId);
    const d = org.derivadoDe(base, membroId);
    // Mesma regra da ficha (`contaDifere`), no servidor: sem sugestão, conflito ou conta ADMIN, nada a aplicar.
    const conta = m?.usuarioId ? await db.usuario.findUnique({ where: { id: m.usuarioId }, select: { papel: true, area: true, cargos: true } }) : null;
    if (!m?.usuarioId || !d.papel || !conta || !contaDifere({ papel: conta.papel, area: conta.area, gp: conta.cargos.includes("GP") }, d)) return { erro: "Nada a aplicar para este membro." };
    const r = await atualizarUsuario(m.usuarioId, { papel: d.papel, area: d.area, cargos: d.gp ? ["GP"] : [] }, a);
    if (!r.ok) return { erro: r.erro === "PAPEL_NAO_PERMITIDO" ? "Só a gestão muda o papel de uma conta." : r.erro === "NAO_PODE_ALTERAR_A_SI" ? "Você não pode mudar o próprio papel." : "Não foi possível atualizar a conta." };
    await db.historicoOrg.create({ data: { membroId, evento: `Conta do CRM ajustada pelo organograma: ${d.papel}${d.area ? ` · ${d.area}` : ""}${d.gp ? " · GP" : ""}`, autorId: a.id } });
    return { ok: true };
  });
}

export async function convidarParaCrmAction(membroId: string): Promise<EstadoGG> {
  if (!parse(id, membroId)) return INVALIDO;
  return rodar("gg.ponte.convidar", async (a) => {
    const base = await org.carregarBase();
    const m = base.membros.find((x) => x.id === membroId);
    if (!m?.email || m.usuarioId) return { erro: "Membro sem e-mail ou já com conta." };
    const d = org.derivadoDe(base, membroId);
    const papel = d.papel ?? "VISUALIZADOR";
    const lado = resolverAreaCargos(papel, d.area, d.gp ? ["GP"] : []);
    const r = await criarConvite({ nome: m.nome, email: m.email, papel, area: lado.area, cargos: lado.cargos }, a);
    if (!r.ok) return { erro: r.erro === "PAPEL_NAO_PERMITIDO" ? "Só a gestão convida para o CRM." : r.erro === "EMAIL_EM_USO" ? "Já existe uma conta com esse e-mail: use Ligar contas pelo e-mail." : "Não foi possível convidar." };
    await db.membro.update({ where: { id: membroId }, data: { usuarioId: r.usuarioId } });
    await db.historicoOrg.create({ data: { membroId, evento: `Convidado para o CRM como ${papel}`, autorId: a.id } });
    const base_ = process.env.APP_URL?.replace(/\/+$/, "") ?? "http://localhost:3000";
    return { ok: true, link: `${base_}/convite/${r.token}` };
  });
}

// ---------------------------------------------------------------- fase B

export async function registrarDemandaAction(membroId: string, tipo: string, justificativa: string): Promise<EstadoGG> {
  const t = parse(z.enum(["ROSA", "AZUL"]), tipo) as TipoDemanda | null;
  return parse(id, membroId) && t && parse(z.string().max(1000), justificativa) !== null ? rodar("gg.demanda.registrar", (a) => rot.registrarDemanda({ membroId, tipo: t, justificativa }, a)) : INVALIDO;
}
export async function cancelarDemandaAction(demandaId: string): Promise<EstadoGG> {
  return parse(id, demandaId) ? rodar("gg.demanda.cancelar", (a) => rot.cancelarDemanda(demandaId, a)) : INVALIDO;
}
const eventoSchema = z.object({ titulo: z.string().max(200), data: dia, horario: z.string().max(5).nullable(), categoria: z.enum(["RG", "REUNIAO", "EVENTO"]), areaId: id.nullable() });
export async function criarEventoAction(dados: unknown): Promise<EstadoGG> {
  const d = parse(eventoSchema, dados);
  return d ? rodar("gg.evento.criar", (a) => rot.criarEvento({ ...d, categoria: d.categoria as CategoriaEvento }, a)) : INVALIDO;
}
export async function excluirEventoAction(eventoId: string): Promise<EstadoGG> {
  return parse(id, eventoId) ? rodar("gg.evento.excluir", (a) => rot.excluirEvento(eventoId, a)) : INVALIDO;
}
export async function registrarAusenciaAction(eventoId: string, membroId: string, justificada: boolean, observacao: string): Promise<EstadoGG> {
  return parse(id, eventoId) && parse(id, membroId) && parse(z.string().max(500), observacao) !== null ? rodar("gg.ausencia", (a) => rot.registrarAusencia({ eventoId, membroId, justificada: !!justificada, observacao }, a)) : INVALIDO;
}

const num = z.coerce.number().finite();
export async function criarCicloAction(nome: string, inicio: string, fim: string): Promise<EstadoGG> {
  return parse(z.string().max(60), nome) !== null && parse(dia, inicio) && parse(dia, fim) ? rodar("gg.ciclo", (a) => rot.criarCiclo({ nome, inicio, fim }, a)) : INVALIDO;
}
export async function criarObjetivoAction(titulo: string, cicloId: string, responsavelId: string): Promise<EstadoGG> {
  return parse(z.string().max(200), titulo) !== null && parse(id, cicloId) && parse(id, responsavelId) ? rodar("gg.objetivo", (a) => rot.criarObjetivo({ titulo, cicloId, responsavelId }, a)) : INVALIDO;
}
export async function criarResultadoAction(dados: unknown): Promise<EstadoGG> {
  const d = parse(z.object({ objetivoId: id, titulo: z.string().max(200), unidade: z.string().max(30), inicial: num, meta: num, fonte: z.string().max(40).nullable() }), dados);
  return d ? rodar("gg.kr", (a) => rot.criarResultado(d, a)) : INVALIDO;
}
export async function atualizarResultadoAction(krId: string, atual: number): Promise<EstadoGG> {
  const v = parse(num, atual);
  return parse(id, krId) && v !== null ? rodar("gg.kr.atual", (a) => rot.atualizarResultado(krId, v, a)) : INVALIDO;
}
export async function criarKpiAction(dados: unknown): Promise<EstadoGG> {
  const d = parse(z.object({ titulo: z.string().max(200), unidade: z.string().max(30), meta: num, direcao: z.enum(["MAIOR", "MENOR"]), fonte: z.string().max(40).nullable() }), dados);
  return d ? rodar("gg.kpi", (a) => rot.criarKpi({ ...d, direcao: d.direcao as DirecaoKpi }, a)) : INVALIDO;
}
export async function registrarMedicaoAction(kpiId: string, data: string, valor: number): Promise<EstadoGG> {
  const v = parse(num, valor);
  return parse(id, kpiId) && parse(dia, data) && v !== null ? rodar("gg.medicao", (a) => rot.registrarMedicao(kpiId, data, v, a)) : INVALIDO;
}
export async function criarIniciativaAction(dados: unknown): Promise<EstadoGG> {
  const d = parse(z.object({ titulo: z.string().max(200), objetivoId: id.nullable(), kpiId: id.nullable(), responsavelId: id, prazo: dia.nullable() }), dados);
  return d ? rodar("gg.iniciativa", (a) => rot.criarIniciativa(d, a)) : INVALIDO;
}
export async function concluirIniciativaAction(iniciativaId: string, concluida: boolean): Promise<EstadoGG> {
  return parse(id, iniciativaId) ? rodar("gg.iniciativa.concluir", (a) => rot.concluirIniciativa(iniciativaId, !!concluida, a)) : INVALIDO;
}
export async function criarProcessoAction(nome: string): Promise<EstadoGG> {
  return parse(z.string().max(200), nome) !== null ? rodar("gg.processo", (a) => rot.criarProcesso(nome, a)) : INVALIDO;
}
export async function definirRaciAction(processoId: string, cargoId: string, papel: string | null): Promise<EstadoGG> {
  const p = papel === null ? null : (parse(z.enum(["R", "A", "C", "I"]), papel) as PapelRaci | null);
  if (papel !== null && !p) return INVALIDO;
  return parse(id, processoId) && parse(id, cargoId) ? rodar("gg.raci", (a) => rot.definirRaci(processoId, cargoId, p, a)) : INVALIDO;
}

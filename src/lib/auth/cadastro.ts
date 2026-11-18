/**
 * Cadastro único (GAB-105): Gestão → Usuários cadastra a pessoa num lugar só. Numa transação:
 * a conta do CRM (`criarConvite`), o membro do G&G com o mesmo e-mail (criado, ou o existente
 * ligado) e, se escolhida, a ocupação da posição no organograma (início hoje, principal).
 * Qualquer recusa no meio desfaz tudo.
 *
 * Permissão: quem cadastra usuário na Gestão (gestor e admin), com a régua de sempre
 * (`podeAtribuirPapel`: gestor não cria nem mexe em admin; ninguém mexe na própria posição,
 * exceto o admin, como no lado/cargo de `atualizarUsuario`). Os serviços do G&G exigem
 * `ehEditorGG`; daqui eles são chamados pelas variantes `*Tx`, que não conferem: a regra
 * registrada é "gestor e admin atribuem/encerram posição pela Gestão", sem abrir para mais
 * ninguém. Editor de G&G que não é gestor continua com o que tinha (pelo G&G).
 */
import type { Area, Cargo, Papel, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { derivarDoOrganograma, pareceAreaGG } from "@/lib/gg/modelo";
import {
  areasGG,
  atribuirPosicaoTx,
  ehCargoPo,
  encerrarOcupacaoTx,
  membroDaContaTx,
  postosDe,
  raizDe,
  Recusa,
  type AtorGG,
  type BaseOrg,
  type ErroOrg,
} from "@/lib/gg/organizacao";
import { diaEmFuso } from "@/lib/projetos/aging";
import { podeAtribuirPapel } from "./papeis";
import { criarConvite, formatarLado, type DadosConvite, type ErroUsuario } from "./usuarios";

export type ErroCadastro = ErroUsuario | ErroOrg;
export type ResultadoCadastro<T = object> = ({ ok: true } & T) | { ok: false; erro: ErroCadastro };

type Ator = { id: string; papel: Papel; nome?: string };

/** Desfaz a transação levando o erro de regra da conta (o Postgres não segue depois do erro). */
class Desfaz extends Error {
  constructor(readonly erro: ErroUsuario) {
    super(erro);
  }
}

/** Recusa da régua da conta (alvo, papel), antes ou dentro da transação. */
class RecusaConta extends Desfaz {}

const atorGG = (a: Ator): AtorGG => ({ id: a.id, nome: a.nome ?? "", papel: a.papel });
const hoje = () => diaEmFuso(new Date());

function traduzir(e: unknown): { ok: false; erro: ErroCadastro } {
  if (e instanceof Desfaz) return { ok: false, erro: e.erro };
  if (e instanceof Recusa) return { ok: false, erro: e.erro };
  throw e;
}

export async function cadastrarPessoa(
  dados: DadosConvite & { posicaoId?: string | null },
  por: Ator,
): Promise<ResultadoCadastro<{ usuarioId: string; membroId: string; membro: "criado" | "ligado"; token: string; expiraEm: Date }>> {
  const posicaoId = dados.posicaoId || null;
  try {
    const r = await db.$transaction(async (tx) => {
      const c = await criarConvite(dados, por, tx);
      if (!c.ok) throw new Desfaz(c.erro);
      const m = await membroDaContaTx(tx, { usuarioId: c.usuarioId, nome: dados.nome, email: dados.email }, atorGG(por));
      if (posicaoId) await atribuirPosicaoTx(tx, posicaoId, m.id, hoje(), atorGG(por), { principal: true });
      return { ...c, membroId: m.id, membro: m.criado ? ("criado" as const) : ("ligado" as const) };
    });
    console.info(
      `[auditoria] usuario.convidado usuario=${r.usuarioId} por=${por.id} papel=${r.papel} lado=${formatarLado(r)} entrada=${r.areaEntrada ?? "nenhuma"} membro=${r.membroId} membro_${r.membro}=1 posicao=${posicaoId ?? "nenhuma"}`,
    );
    return { ok: true, usuarioId: r.usuarioId, membroId: r.membroId, membro: r.membro, token: r.token, expiraEm: r.expiraEm };
  } catch (e) {
    return traduzir(e);
  }
}

/** Mesma régua da edição de usuário: gestor/admin, papel atual atribuível, e a si mesmo só o admin. */
async function alvoDaGestao(usuarioId: string, por: Ator) {
  const alvo = await db.usuario.findUnique({ where: { id: usuarioId }, select: { id: true, nome: true, email: true, papel: true } });
  if (!alvo) throw new RecusaConta("USUARIO_NAO_ENCONTRADO");
  if (!podeAtribuirPapel(por.papel, alvo.papel)) throw new RecusaConta("PAPEL_NAO_PERMITIDO");
  // Posição dá poder (papel sugerido, caneta do G&G): como lado/cargo, ninguém mexe na própria, fora o admin.
  if (alvo.id === por.id && por.papel !== "ADMIN") throw new RecusaConta("NAO_PODE_ALTERAR_A_SI");
  return alvo;
}

/** Confirma, dentro da transação, que o alvo não mudou de papel desde a checagem (gestor nunca mexe em admin). */
async function papelMantido(tx: Prisma.TransactionClient, alvo: { id: string; papel: Papel }) {
  if ((await tx.usuario.count({ where: { id: alvo.id, papel: alvo.papel } })) === 0) throw new RecusaConta("PAPEL_NAO_PERMITIDO");
}

/** Edição de usuário: atribui uma posição (início hoje). Sem membro ligado, liga ou cria como no cadastro. */
export async function adicionarPosicaoAoUsuario(usuarioId: string, posicaoId: string, por: Ator): Promise<ResultadoCadastro> {
  try {
    const alvo = await alvoDaGestao(usuarioId, por);
    await db.$transaction(async (tx) => {
      await papelMantido(tx, alvo);
      const m = await membroDaContaTx(tx, { usuarioId: alvo.id, nome: alvo.nome, email: alvo.email }, atorGG(por));
      await atribuirPosicaoTx(tx, posicaoId, m.id, hoje(), atorGG(por));
    });
    console.info(`[auditoria] usuario.posicao_atribuida usuario=${alvo.id} por=${por.id} posicao=${posicaoId}`);
    return { ok: true };
  } catch (e) {
    return traduzir(e);
  }
}

/** Edição de usuário: encerra hoje uma ocupação aberta do membro ligado a esta conta. */
export async function encerrarOcupacaoDoUsuario(usuarioId: string, ocupacaoId: string, por: Ator): Promise<ResultadoCadastro> {
  try {
    const alvo = await alvoDaGestao(usuarioId, por);
    await db.$transaction(async (tx) => {
      await papelMantido(tx, alvo);
      const m = await tx.membro.findUnique({ where: { usuarioId: alvo.id }, select: { id: true } });
      if (!m) throw new Recusa("NAO_ENCONTRADO");
      await encerrarOcupacaoTx(tx, ocupacaoId, hoje(), atorGG(por), m.id);
    });
    console.info(`[auditoria] usuario.ocupacao_encerrada usuario=${alvo.id} por=${por.id} ocupacao=${ocupacaoId}`);
    return { ok: true };
  } catch (e) {
    return traduzir(e);
  }
}

// ---------------------------------------------------------------- leitura para a tela da Gestão

/** O que a posição sugere para a conta (`derivarDoOrganograma` com ela como única ocupação, principal). */
export type SugestaoConta = { papel: Papel; area: Area | null; cargos: Cargo[] };
export type OpcaoPosicao = { id: string; rotulo: string; ehGG: boolean; pareceGG: boolean; sugestao: SugestaoConta };
export type GrupoPosicoes = { rotulo: string; opcoes: OpcaoPosicao[] };
export type OcupacaoDaConta = { ocupacaoId: string; rotulo: string; principal: boolean; inicio: string | null };

const comparar = (a: string, b: string) => a.localeCompare(b, "pt-BR");

/**
 * Posições ativas para o campo "Posição na IJ", agrupadas pela área ou frente da posição, com o
 * rótulo "Área · Cargo" (e o nome da posição quando há duas com a mesma área e cargo).
 * `temAreaGG`: há área marcada `ehGG` (sem ela, ninguém vira editor de G&G pela posição).
 */
export function opcoesDePosicao(base: BaseOrg): { grupos: GrupoPosicoes[]; temAreaGG: boolean } {
  const gg = areasGG(base.areas);
  const area = (id: string) => base.areas.find((a) => a.id === id);
  const cargo = (id: string) => base.cargos.find((c) => c.id === id);
  const validas = base.posicoes.filter((p) => area(p.areaId) && cargo(p.cargoId));
  const repetidas = new Set<string>();
  const vistas = new Set<string>();
  for (const p of validas) {
    const k = `${p.areaId}|${p.cargoId}`;
    if (vistas.has(k)) repetidas.add(k);
    vistas.add(k);
  }
  const grupos = new Map<string, GrupoPosicoes & { ordem: string[] }>();
  for (const p of validas) {
    const a = area(p.areaId)!;
    const c = cargo(p.cargoId)!;
    const raiz = raizDe(base.areas, a.id) ?? a;
    const sugestao = derivarDoOrganograma([{ ladoCrm: raiz.ladoCrm, categoria: c.categoria, ehGp: c.ehGp, ehPo: ehCargoPo(c), principal: true }]);
    const rotulo = `${a.nome} · ${c.nome}${repetidas.has(`${p.areaId}|${p.cargoId}`) ? ` (${p.nome})` : ""}`;
    const g = grupos.get(a.id) ?? { rotulo: a.id === raiz.id ? a.nome : `${a.nome} · frente de ${raiz.nome}`, opcoes: [], ordem: [raiz.nome, a.id === raiz.id ? "0" : "1", a.nome] };
    g.opcoes.push({
      id: p.id,
      rotulo,
      ehGG: gg.has(a.id),
      pareceGG: gg.has(a.id) || pareceAreaGG(a.nome) || pareceAreaGG(raiz.nome),
      sugestao: { papel: sugestao.papel ?? "VISUALIZADOR", area: sugestao.area, cargos: sugestao.cargos },
    });
    grupos.set(a.id, g);
  }
  const lista = [...grupos.values()].sort((x, y) => comparar(x.ordem[0], y.ordem[0]) || comparar(x.ordem[1], y.ordem[1]) || comparar(x.ordem[2], y.ordem[2]));
  return { grupos: lista.map(({ rotulo, opcoes }) => ({ rotulo, opcoes: opcoes.sort((x, y) => comparar(x.rotulo, y.rotulo)) })), temAreaGG: gg.size > 0 };
}

/** Ocupações vigentes de cada conta ligada a membro (para a edição de usuário). */
export function ocupacoesPorConta(base: BaseOrg): Record<string, OcupacaoDaConta[]> {
  const r: Record<string, OcupacaoDaConta[]> = {};
  for (const m of base.membros) {
    if (!m.usuarioId) continue;
    r[m.usuarioId] = postosDe(base, m.id).map((p) => {
      const a = base.areas.find((x) => x.id === p.areaId);
      const c = base.cargos.find((x) => x.id === p.cargoId);
      return { ocupacaoId: p.ocupacao.id, rotulo: `${a?.nome ?? "?"} · ${c?.nome ?? p.nome}`, principal: p.ocupacao.principal, inicio: p.ocupacao.inicio };
    });
  }
  return r;
}

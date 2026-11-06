/**
 * G&G · fatia A: membros, estrutura (áreas, cargos, posições), ocupações, períodos
 * na IJ, importação e a ponte com a conta do CRM. Regras do automacao-GG
 * (ajustar_ocupacao, importar_membros) reescritas como serviço em transação, com o
 * histórico gravado na mesma transação. Spec: docs/superpowers/specs/2026-11-05-gg-no-crm-design.md
 *
 * Quem edita: admin e quem ocupa hoje uma posição na área G&G (ou nas frentes dela).
 * Quem lê: todo usuário ativo do CRM (decisão §3.1). Mudar a conta do CRM (convidar,
 * aplicar papel) segue as regras de Gestão (`auth/usuarios`): só gestor/admin.
 */
import type { Area, CategoriaCargo, Papel, Prisma, StatusMembro, TipoAreaOrg } from "@prisma/client";
import { diaDoPrazo, instanteDoPrazo } from "@/lib/calendario/semana";
import { db } from "@/lib/db";
import { diaEmFuso } from "@/lib/projetos/aging";
import { descendentes, derivarDoOrganograma, normalizar, temCiclo, vigente, type Derivado, type LinhaImportacao } from "./modelo";

export type AtorGG = { id: string; nome: string; papel: Papel };
type Tx = Prisma.TransactionClient;

export type ErroOrg =
  | "SEM_PERMISSAO"
  | "NAO_ENCONTRADO"
  | "DADOS_INVALIDOS"
  | "DATA_FUTURA"
  | "DATA_ANTES_DO_INICIO"
  | "JA_OCUPA"
  | "EMAIL_EM_USO"
  | "MOTIVO_OBRIGATORIO"
  | "CICLO"
  | "COM_HISTORICO"
  | "IMPORTACAO";
export const MENSAGEM_ERRO_ORG: Record<ErroOrg, string> = {
  SEM_PERMISSAO: "Só a área de Gente & Gestão e a administração editam a estrutura.",
  NAO_ENCONTRADO: "Registro não encontrado.",
  DADOS_INVALIDOS: "Dados inválidos.",
  DATA_FUTURA: "Datas futuras não são aceitas.",
  DATA_ANTES_DO_INICIO: "A data não pode ser antes do início.",
  JA_OCUPA: "Essa pessoa já ocupa essa posição.",
  EMAIL_EM_USO: "Já existe um membro com esse e-mail.",
  MOTIVO_OBRIGATORIO: "O motivo é obrigatório.",
  CICLO: "Essa liderança criaria um ciclo no organograma.",
  COM_HISTORICO: "Posição com histórico não muda de área nem de cargo: crie outra posição.",
  IMPORTACAO: "Importação recusada.",
};
export type ResultadoOrg<T = object> = ({ ok: true } & T) | { ok: false; erro: ErroOrg; detalhe?: string };

class Recusa extends Error {
  constructor(
    readonly erro: ErroOrg,
    readonly detalhe?: string,
  ) {
    super(erro);
  }
}
function traduzir(e: unknown): { ok: false; erro: ErroOrg; detalhe?: string } {
  if (e instanceof Recusa) return { ok: false, erro: e.erro, detalhe: e.detalhe };
  const code = (e as { code?: string; meta?: { target?: unknown } }).code;
  if (code === "P2002") {
    const alvo = String((e as { meta?: { target?: unknown } }).meta?.target ?? "");
    return { ok: false, erro: alvo.includes("email") ? "EMAIL_EM_USO" : "JA_OCUPA" };
  }
  throw e;
}

const hoje = () => diaEmFuso(new Date());
const dia = (d: Date | null) => (d ? diaDoPrazo(d) : null);
const DIA = /^\d{4}-\d{2}-\d{2}$/;
function data(d: string | null, { obrigatoria = false } = {}): Date | null {
  if (d === null || d === "") {
    if (obrigatoria) throw new Recusa("DADOS_INVALIDOS");
    return null;
  }
  if (!DIA.test(d) || diaDoPrazo(instanteDoPrazo(d)) !== d) throw new Recusa("DADOS_INVALIDOS");
  if (d > hoje()) throw new Recusa("DATA_FUTURA");
  return instanteDoPrazo(d);
}

async function historico(tx: Tx, membroId: string | null, evento: string, ator: AtorGG, dados: Prisma.InputJsonObject = {}) {
  await tx.historicoOrg.create({ data: { membroId, evento, autorId: ator.id, dados } });
}

// ---------------------------------------------------------------- base (leitura)

export type AreaB = { id: string; nome: string; tipo: TipoAreaOrg; superiorId: string | null; ladoCrm: Area | null; ehGG: boolean };
export type CargoB = { id: string; nome: string; categoria: CategoriaCargo; ehGp: boolean };
export type PosicaoB = { id: string; nome: string; areaId: string; cargoId: string; liderancaId: string | null };
export type OcupacaoB = { id: string; membroId: string; posicaoId: string; inicio: string | null; fim: string | null; principal: boolean; invalidadoEm: string | null; motivoInvalidacao: string | null };
export type MembroB = { id: string; nome: string; email: string | null; status: StatusMembro; usuarioId: string | null };
export type VinculoB = { id: string; membroId: string; entrada: string | null; saida: string | null };
export type BaseOrg = { areas: AreaB[]; cargos: CargoB[]; posicoes: PosicaoB[]; ocupacoes: OcupacaoB[]; membros: MembroB[]; vinculos: VinculoB[]; hoje: string };

/**
 * Tudo da estrutura numa leitura (seis queries). A IJ tem dezenas de pessoas:
 * ponytail: carrega tudo; paginar quando passar de alguns milhares de ocupações.
 */
export async function carregarBase(): Promise<BaseOrg> {
  const [areas, cargos, posicoes, ocupacoes, membros, vinculos] = await Promise.all([
    db.areaOrg.findMany({ where: { ativo: true }, orderBy: { nome: "asc" } }),
    db.cargoOrg.findMany({ where: { ativo: true }, orderBy: { nome: "asc" } }),
    db.posicao.findMany({ where: { ativo: true }, orderBy: { nome: "asc" } }),
    db.ocupacao.findMany({ orderBy: [{ inicio: "asc" }, { criadoEm: "asc" }] }),
    db.membro.findMany({ orderBy: { nome: "asc" } }),
    db.vinculoIj.findMany({ orderBy: { entrada: "desc" } }),
  ]);
  return {
    areas: areas.map((a) => ({ id: a.id, nome: a.nome, tipo: a.tipo, superiorId: a.superiorId, ladoCrm: a.ladoCrm, ehGG: a.ehGG })),
    cargos: cargos.map((c) => ({ id: c.id, nome: c.nome, categoria: c.categoria, ehGp: c.ehGp })),
    posicoes: posicoes.map((p) => ({ id: p.id, nome: p.nome, areaId: p.areaId, cargoId: p.cargoId, liderancaId: p.liderancaId })),
    ocupacoes: ocupacoes.map((o) => ({ id: o.id, membroId: o.membroId, posicaoId: o.posicaoId, inicio: dia(o.inicio), fim: dia(o.fim), principal: o.principal, invalidadoEm: o.invalidadoEm?.toISOString() ?? null, motivoInvalidacao: o.motivoInvalidacao })),
    membros: membros.map((m) => ({ id: m.id, nome: m.nome, email: m.email, status: m.status, usuarioId: m.usuarioId })),
    vinculos: vinculos.map((v) => ({ id: v.id, membroId: v.membroId, entrada: dia(v.entrada), saida: dia(v.saida) })),
    hoje: hoje(),
  };
}

/** Área-raiz (a área de uma frente). */
export function raizDe(areas: AreaB[], areaId: string): AreaB | undefined {
  let a = areas.find((x) => x.id === areaId);
  while (a?.superiorId) a = areas.find((x) => x.id === a!.superiorId);
  return a;
}

/** Posições vigentes de um membro. */
export function postosDe(base: BaseOrg, membroId: string): (PosicaoB & { ocupacao: OcupacaoB })[] {
  return base.ocupacoes
    .filter((o) => o.membroId === membroId && vigente(o, base.hoje))
    .flatMap((o) => base.posicoes.filter((p) => p.id === o.posicaoId).map((p) => ({ ...p, ocupacao: o })));
}

/** Líderes atuais: quem ocupa a posição acima de alguma das posições do membro. */
export function lideresDe(base: BaseOrg, membroId: string): MembroB[] {
  const acima = new Set(postosDe(base, membroId).map((p) => p.liderancaId));
  const ids = new Set(base.ocupacoes.filter((o) => acima.has(o.posicaoId) && vigente(o, base.hoje)).map((o) => o.membroId));
  return base.membros.filter((m) => ids.has(m.id));
}

/** O que o organograma sugere para a conta do CRM deste membro. */
export function derivadoDe(base: BaseOrg, membroId: string): Derivado {
  return derivarDoOrganograma(
    postosDe(base, membroId).map((p) => {
      const cargo = base.cargos.find((c) => c.id === p.cargoId)!;
      return { ladoCrm: raizDe(base.areas, p.areaId)?.ladoCrm ?? null, categoria: cargo.categoria, ehGp: cargo.ehGp, principal: p.ocupacao.principal };
    }),
  );
}

/** Ids das áreas de G&G (a área marcada e as frentes). */
export function areasGG(areas: AreaB[]): Set<string> {
  const raiz = areas.find((a) => a.ehGG);
  return raiz ? descendentes(areas, raiz.id) : new Set();
}

// ---------------------------------------------------------------- acesso

/**
 * Edita a área G&G: admin, ou conta ligada a membro que ocupa hoje posição em G&G.
 * Vale pelo organograma, não pelo papel do CRM: quem é só de G&G deriva VISUALIZADOR
 * (G&G não é lado de vendas/projetos) e continua só lendo o comercial, mas edita G&G.
 */
export async function ehEditorGG(u: { id: string; papel: Papel }): Promise<boolean> {
  if (u.papel === "ADMIN") return true;
  // Quem saiu da IJ (INATIVO) perde a caneta já: a saída não fecha as ocupações.
  const m = await db.membro.findFirst({ where: { usuarioId: u.id, status: { not: "INATIVO" } }, select: { id: true } });
  if (!m) return false;
  const base = await carregarBase();
  const gg = areasGG(base.areas);
  return postosDe(base, m.id).some((p) => gg.has(p.areaId));
}

async function exigirEditor(ator: AtorGG) {
  if (!(await ehEditorGG(ator))) throw new Recusa("SEM_PERMISSAO");
}

// ---------------------------------------------------------------- membros

/** Liga a conta do CRM pelo e-mail (sem diferenciar maiúsculas). */
async function contaPorEmail(tx: Tx, email: string | null): Promise<string | null> {
  if (!email) return null;
  const u = await tx.usuario.findFirst({ where: { email: { equals: email.trim(), mode: "insensitive" }, membro: { is: null } }, select: { id: true } });
  return u?.id ?? null;
}

export type DadosMembro = { nome: string; email: string | null; status: StatusMembro; entrada?: string | null };

function validarMembro(d: DadosMembro): { nome: string; email: string | null } {
  const nome = d.nome.trim();
  const email = d.email?.trim() || null;
  if (!nome || nome.length > 200) throw new Recusa("DADOS_INVALIDOS");
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Recusa("DADOS_INVALIDOS");
  return { nome, email };
}

export async function criarMembro(d: DadosMembro, ator: AtorGG): Promise<ResultadoOrg<{ id: string }>> {
  try {
    await exigirEditor(ator);
    const { nome, email } = validarMembro(d);
    const entrada = data(d.entrada ?? null);
    const id = await db.$transaction(async (tx) => {
      const m = await tx.membro.create({ data: { nome, email, status: d.status, usuarioId: await contaPorEmail(tx, email) } });
      await tx.vinculoIj.create({ data: { membroId: m.id, entrada } });
      await historico(tx, m.id, "Membro cadastrado", ator);
      return m.id;
    });
    return { ok: true, id };
  } catch (e) {
    return traduzir(e);
  }
}

export async function editarMembro(id: string, d: DadosMembro, ator: AtorGG): Promise<ResultadoOrg> {
  try {
    await exigirEditor(ator);
    const { nome, email } = validarMembro(d);
    await db.$transaction(async (tx) => {
      const atual = await tx.membro.findUnique({ where: { id } });
      if (!atual) throw new Recusa("NAO_ENCONTRADO");
      const usuarioId = atual.usuarioId ?? (await contaPorEmail(tx, email));
      await tx.membro.update({ where: { id }, data: { nome, email, status: d.status, usuarioId } });
      const mudou = [atual.nome !== nome && "nome", atual.email !== email && "e-mail", atual.status !== d.status && "status"].filter(Boolean);
      if (mudou.length) await historico(tx, id, `Dados alterados: ${mudou.join(", ")}`, ator);
    });
    return { ok: true };
  } catch (e) {
    return traduzir(e);
  }
}

/** Liga, de uma vez, todo membro sem conta cujo e-mail bate com uma conta do CRM. */
export async function ligarContasPorEmail(ator: AtorGG): Promise<ResultadoOrg<{ ligados: number }>> {
  try {
    await exigirEditor(ator);
    const ligados = await db.$transaction(async (tx) => {
      const soltos = await tx.membro.findMany({ where: { usuarioId: null, email: { not: null } }, select: { id: true, email: true } });
      let n = 0;
      for (const m of soltos) {
        const u = await contaPorEmail(tx, m.email);
        if (!u) continue;
        await tx.membro.update({ where: { id: m.id }, data: { usuarioId: u } });
        await historico(tx, m.id, "Conta do CRM ligada pelo e-mail", ator);
        n++;
      }
      return n;
    });
    return { ok: true, ligados };
  } catch (e) {
    return traduzir(e);
  }
}

/** Saída da IJ: fecha o período aberto. Não mexe nas ocupações (a ficha pede revisão), como no G&G. */
export async function registrarSaida(membroId: string, saida: string, ator: AtorGG): Promise<ResultadoOrg> {
  try {
    await exigirEditor(ator);
    const d = data(saida, { obrigatoria: true })!;
    await db.$transaction(async (tx) => {
      const aberto = await tx.vinculoIj.findFirst({ where: { membroId, saida: null } });
      if (!aberto) throw new Recusa("NAO_ENCONTRADO");
      if (aberto.entrada && d < aberto.entrada) throw new Recusa("DATA_ANTES_DO_INICIO");
      await tx.vinculoIj.update({ where: { id: aberto.id }, data: { saida: d } });
      await tx.membro.update({ where: { id: membroId }, data: { status: "INATIVO" } });
      await historico(tx, membroId, "Saída da IJ registrada", ator, { saida });
    });
    return { ok: true };
  } catch (e) {
    return traduzir(e);
  }
}

/** Reingresso: novo período, sem sobrepor o anterior. */
export async function registrarEntrada(membroId: string, entrada: string, ator: AtorGG): Promise<ResultadoOrg> {
  try {
    await exigirEditor(ator);
    const d = data(entrada, { obrigatoria: true })!;
    await db.$transaction(async (tx) => {
      if (await tx.vinculoIj.findFirst({ where: { membroId, saida: null } })) throw new Recusa("DADOS_INVALIDOS", "Já existe um período aberto.");
      const ultimo = await tx.vinculoIj.findFirst({ where: { membroId }, orderBy: { saida: "desc" } });
      if (ultimo?.saida && d < ultimo.saida) throw new Recusa("DATA_ANTES_DO_INICIO");
      await tx.vinculoIj.create({ data: { membroId, entrada: d } });
      await tx.membro.update({ where: { id: membroId }, data: { status: "ATIVO" } });
      await historico(tx, membroId, "Reingresso na IJ", ator, { entrada });
    });
    return { ok: true };
  } catch (e) {
    return traduzir(e);
  }
}

// ---------------------------------------------------------------- organograma (ajustar_ocupacao)

async function travarMembro(tx: Tx, membroId: string) {
  await tx.$queryRaw`SELECT id FROM membro WHERE id = ${membroId} FOR UPDATE`;
}

/**
 * Abre ocupação; vira principal se a pessoa não tiver outra principal aberta. Recusa sobrepor
 * outro vínculo (não invalidado) da pessoa na mesma posição, como o trigger validar_periodo do G&G:
 * [inicio, ∞) cruza [a, b) se b é aberto, o início é vazio ou b > inicio.
 */
async function abrirOcupacao(tx: Tx, membroId: string, posicaoId: string, inicio: Date | null, principal?: boolean) {
  const sobrepoe = await tx.ocupacao.count({ where: { membroId, posicaoId, invalidadoEm: null, ...(inicio ? { OR: [{ fim: null }, { fim: { gt: inicio } }] } : {}) } });
  if (sobrepoe) throw new Recusa("JA_OCUPA", "O período se sobrepõe a um vínculo existente nessa posição.");
  const temPrincipal = await tx.ocupacao.count({ where: { membroId, fim: null, invalidadoEm: null, principal: true } });
  await tx.ocupacao.create({ data: { membroId, posicaoId, inicio, principal: principal ?? temPrincipal === 0 } });
}

export async function adicionarOcupante(posicaoId: string, membroId: string, inicio: string | null, ator: AtorGG): Promise<ResultadoOrg> {
  try {
    await exigirEditor(ator);
    const d = data(inicio);
    await db.$transaction(async (tx) => {
      await travarMembro(tx, membroId);
      const p = await tx.posicao.findFirst({ where: { id: posicaoId, ativo: true } });
      const m = await tx.membro.findUnique({ where: { id: membroId } });
      if (!p || !m) throw new Recusa("NAO_ENCONTRADO");
      if (await tx.ocupacao.count({ where: { membroId, posicaoId, fim: null, invalidadoEm: null } })) throw new Recusa("JA_OCUPA");
      await abrirOcupacao(tx, membroId, posicaoId, d);
      await historico(tx, membroId, `Atribuído a ${p.nome}`, ator, { inicio });
    });
    return { ok: true };
  } catch (e) {
    return traduzir(e);
  }
}

async function ocupacaoAberta(tx: Tx, ocupacaoId: string) {
  const o = await tx.ocupacao.findFirst({ where: { id: ocupacaoId, fim: null, invalidadoEm: null }, include: { posicao: { select: { nome: true } } } });
  if (!o) throw new Recusa("NAO_ENCONTRADO");
  await travarMembro(tx, o.membroId);
  return o;
}

/** Fim = primeiro dia em que já não ocupa ([início, fim)). */
export async function encerrarOcupacao(ocupacaoId: string, fim: string, ator: AtorGG): Promise<ResultadoOrg> {
  try {
    await exigirEditor(ator);
    const d = data(fim, { obrigatoria: true })!;
    await db.$transaction(async (tx) => {
      const o = await ocupacaoAberta(tx, ocupacaoId);
      if (o.inicio && d < o.inicio) throw new Recusa("DATA_ANTES_DO_INICIO");
      await tx.ocupacao.update({ where: { id: o.id }, data: { fim: d, principal: false } });
      await historico(tx, o.membroId, `Vínculo encerrado: ${o.posicao.nome}`, ator, { fim });
    });
    return { ok: true };
  } catch (e) {
    return traduzir(e);
  }
}

/** Atribuição que nunca aconteceu: sai do organograma e da trajetória, mas fica guardada com motivo. */
export async function retirarPorErro(ocupacaoId: string, motivo: string, ator: AtorGG): Promise<ResultadoOrg> {
  try {
    await exigirEditor(ator);
    const m = motivo.trim();
    if (!m) throw new Recusa("MOTIVO_OBRIGATORIO");
    if (m.length > 500) throw new Recusa("DADOS_INVALIDOS");
    await db.$transaction(async (tx) => {
      const o = await ocupacaoAberta(tx, ocupacaoId);
      await tx.ocupacao.update({ where: { id: o.id }, data: { invalidadoEm: new Date(), motivoInvalidacao: m, principal: false } });
      await historico(tx, o.membroId, `Retirada por erro: ${o.posicao.nome}`, ator, { motivo: m });
    });
    return { ok: true };
  } catch (e) {
    return traduzir(e);
  }
}

/**
 * Trocar cargo. Mudança real: encerra a atual na data e abre a nova (as duas ficam na
 * trajetória). Correção: a atual foi engano (sai da trajetória) e a nova herda o início.
 */
export async function trocarCargo(ocupacaoId: string, destinoId: string, tipo: "real" | "correcao", quando: string | null, ator: AtorGG): Promise<ResultadoOrg> {
  try {
    await exigirEditor(ator);
    const d = tipo === "real" ? data(quando, { obrigatoria: true })! : null;
    await db.$transaction(async (tx) => {
      const o = await ocupacaoAberta(tx, ocupacaoId);
      const destino = await tx.posicao.findFirst({ where: { id: destinoId, ativo: true } });
      if (!destino || destino.id === o.posicaoId) throw new Recusa("DADOS_INVALIDOS");
      if (await tx.ocupacao.count({ where: { membroId: o.membroId, posicaoId: destinoId, fim: null, invalidadoEm: null } })) throw new Recusa("JA_OCUPA");
      if (tipo === "real") {
        if (o.inicio && d! < o.inicio) throw new Recusa("DATA_ANTES_DO_INICIO");
        await tx.ocupacao.update({ where: { id: o.id }, data: { fim: d, principal: false } });
        await abrirOcupacao(tx, o.membroId, destinoId, d, o.principal || undefined);
        await historico(tx, o.membroId, `Troca real de cargo: ${o.posicao.nome} → ${destino.nome}`, ator, { data: quando });
      } else {
        await tx.ocupacao.update({ where: { id: o.id }, data: { invalidadoEm: new Date(), motivoInvalidacao: `Correção: era ${destino.nome}.`, principal: false } });
        await abrirOcupacao(tx, o.membroId, destinoId, o.inicio, o.principal || undefined);
        await historico(tx, o.membroId, `Correção de cadastro: ${o.posicao.nome} → ${destino.nome}`, ator);
      }
    });
    return { ok: true };
  } catch (e) {
    return traduzir(e);
  }
}

/** Marca a posição principal (uma aberta por pessoa). */
export async function tornarPrincipal(ocupacaoId: string, ator: AtorGG): Promise<ResultadoOrg> {
  try {
    await exigirEditor(ator);
    await db.$transaction(async (tx) => {
      const o = await ocupacaoAberta(tx, ocupacaoId);
      await tx.ocupacao.updateMany({ where: { membroId: o.membroId, fim: null, invalidadoEm: null, principal: true }, data: { principal: false } });
      await tx.ocupacao.update({ where: { id: o.id }, data: { principal: true } });
      await historico(tx, o.membroId, `Posição principal: ${o.posicao.nome}`, ator);
    });
    return { ok: true };
  } catch (e) {
    return traduzir(e);
  }
}

// ---------------------------------------------------------------- estrutura

export async function criarPosicao(d: { nome: string; areaId: string; cargoId: string; liderancaId: string | null }, ator: AtorGG): Promise<ResultadoOrg<{ id: string }>> {
  try {
    await exigirEditor(ator);
    const nome = d.nome.trim();
    if (!nome || nome.length > 200) throw new Recusa("DADOS_INVALIDOS");
    const p = await db.posicao.create({ data: { nome, areaId: d.areaId, cargoId: d.cargoId, liderancaId: d.liderancaId } });
    return { ok: true, id: p.id };
  } catch (e) {
    return traduzir(e);
  }
}

/** Renomear e mudar a liderança; área e cargo só sem histórico (regra do G&G). */
export async function editarPosicao(id: string, d: { nome: string; areaId: string; cargoId: string; liderancaId: string | null }, ator: AtorGG): Promise<ResultadoOrg> {
  try {
    await exigirEditor(ator);
    const nome = d.nome.trim();
    if (!nome || nome.length > 200) throw new Recusa("DADOS_INVALIDOS");
    await db.$transaction(async (tx) => {
      // Mesma trava do validar_hierarquia do G&G: duas edições simultâneas não fecham um ciclo.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(912001)`;
      const atual = await tx.posicao.findUnique({ where: { id } });
      if (!atual) throw new Recusa("NAO_ENCONTRADO");
      if ((atual.areaId !== d.areaId || atual.cargoId !== d.cargoId) && (await tx.ocupacao.count({ where: { posicaoId: id } }))) throw new Recusa("COM_HISTORICO");
      const todas = await tx.posicao.findMany({ select: { id: true, liderancaId: true } });
      if (temCiclo(todas.map((p) => ({ id: p.id, superior: p.liderancaId })), id, d.liderancaId)) throw new Recusa("CICLO");
      await tx.posicao.update({ where: { id }, data: { nome, areaId: d.areaId, cargoId: d.cargoId, liderancaId: d.liderancaId } });
    });
    return { ok: true };
  } catch (e) {
    return traduzir(e);
  }
}

// ---------------------------------------------------------------- importação (importar_membros)

/**
 * Lote atômico: uma linha ruim recusa tudo. Área e cargo precisam existir; reaproveita a posição
 * ativa inequívoca (área + cargo), cria se não houver nenhuma e recusa ambiguidade.
 * Chave repetida devolve a contagem anterior (idempotente).
 */
export async function importarMembros(linhas: LinhaImportacao[], chave: string, ator: AtorGG): Promise<ResultadoOrg<{ quantidade: number }>> {
  try {
    await exigirEditor(ator);
    const quantidade = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(912012)`;
      const feita = await tx.importacaoMembros.findUnique({ where: { id: chave } });
      if (feita) return feita.quantidade;
      const [areas, cargos, posicoes] = await Promise.all([tx.areaOrg.findMany({ where: { ativo: true } }), tx.cargoOrg.findMany({ where: { ativo: true } }), tx.posicao.findMany({ where: { ativo: true } })]);
      for (const [i, l] of linhas.entries()) {
        const linha = `Linha ${i + 1}`;
        const area = l.area ? areas.find((a) => normalizar(a.nome) === normalizar(l.area!)) : null;
        const cargo = l.cargo ? cargos.find((c) => normalizar(c.nome) === normalizar(l.cargo!)) : null;
        if (l.area && !area) throw new Recusa("IMPORTACAO", `${linha}: área "${l.area}" não existe.`);
        if (l.cargo && !cargo) throw new Recusa("IMPORTACAO", `${linha}: cargo "${l.cargo}" não existe.`);
        if (!!area !== !!cargo) throw new Recusa("IMPORTACAO", `${linha}: informe área e cargo juntos.`);
        // Como no importar_membros do G&G: já existe pelo nome ou pelo e-mail (sem caixa) → recusa o lote.
        const jaExiste = await tx.membro.count({ where: { OR: [{ nome: { equals: l.nome, mode: "insensitive" } }, ...(l.email ? [{ email: { equals: l.email, mode: "insensitive" as const } }] : [])] } });
        if (jaExiste) throw new Recusa("IMPORTACAO", `${linha}: membro já cadastrado.`);
        const m = await tx.membro.create({ data: { nome: l.nome, email: l.email, status: l.status, usuarioId: await contaPorEmail(tx, l.email) } });
        const entrada = l.entrada ? instanteDoPrazo(l.entrada) : null;
        await tx.vinculoIj.create({ data: { membroId: m.id, entrada } });
        if (area && cargo) {
          const candidatas = posicoes.filter((p) => p.areaId === area.id && p.cargoId === cargo.id);
          if (candidatas.length > 1) throw new Recusa("IMPORTACAO", `${linha}: mais de uma posição para ${area.nome} + ${cargo.nome}; atribua pelo organograma.`);
          let posicao = candidatas[0];
          if (!posicao) {
            posicao = await tx.posicao.create({ data: { nome: `${cargo.nome} de ${area.nome}`, areaId: area.id, cargoId: cargo.id } });
            posicoes.push(posicao);
          }
          await tx.ocupacao.create({ data: { membroId: m.id, posicaoId: posicao.id, inicio: entrada, principal: true } });
        }
        await historico(tx, m.id, "Importado em lote", ator);
      }
      await tx.importacaoMembros.create({ data: { id: chave, autorId: ator.id, quantidade: linhas.length } });
      return linhas.length;
    });
    return { ok: true, quantidade };
  } catch (e) {
    return traduzir(e);
  }
}

// ---------------------------------------------------------------- ficha

export async function historicoDe(membroId: string) {
  const hs = await db.historicoOrg.findMany({ where: { membroId }, orderBy: { criadoEm: "desc" }, take: 100, select: { id: true, evento: true, criadoEm: true, autor: { select: { nome: true } } } });
  return hs.map((h) => ({ id: h.id, evento: h.evento, em: h.criadoEm.toISOString(), autor: h.autor?.nome ?? null }));
}

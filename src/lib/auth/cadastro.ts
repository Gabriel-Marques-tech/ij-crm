/**
 * Cadastro único (GAB-105): Gestão → Usuários cadastra a pessoa num lugar só. Numa transação:
 * a conta do CRM (`criarConvite`), o membro do G&G (o mesmo e-mail ligado, o homônimo sem e-mail
 * confirmado na tela, ou um novo; sempre, mesmo sem posição) e, quando há posição escolhida, a
 * ocupação (início hoje, principal). Qualquer recusa no meio desfaz tudo.
 *
 * GAB-107: papel, lado e cargos da conta NÃO vêm do form: saem das posições vigentes do membro
 * (`derivarDoOrganograma` → `contaDaDerivacao`), e a área de entrada também (a área derivada,
 * senão Geral). Presidência e diretorias = GESTOR. O único controle é "Administrador", que só o
 * admin marca (conferido aqui). Atribuir ou encerrar posição pela edição recalcula a conta na
 * mesma transação (ADMIN nunca é rebaixado; sem posição vigente, a conta fica como está).
 *
 * Permissão: quem cadastra usuário na Gestão (gestor e admin), com a régua de sempre
 * (`podeAtribuirPapel`: gestor não cria nem mexe em admin; ninguém mexe na própria posição,
 * exceto o admin, como no lado/cargo de `atualizarUsuario`). Os serviços do G&G exigem
 * `ehEditorGG`; daqui eles são chamados pelas variantes `*Tx`, que não conferem: a regra
 * registrada é "gestor e admin atribuem/encerram posição pela Gestão", sem abrir para mais
 * ninguém. Editor de G&G que não é gestor continua com o que tinha (pelo G&G).
 */
import type { Area, AreaEntrada, Cargo, Papel, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { contaDaDerivacao, derivarDoOrganograma, descendentes, descreverConta, normalizar, pareceAreaGG, vigente, type ContaDerivada, type PostoDerivavel } from "@/lib/gg/modelo";
import {
  areasGG,
  atribuirPosicaoTx,
  ehCargoPo,
  encerrarOcupacaoTx,
  membroDaContaTx,
  postosDe,
  raizDe,
  Recusa,
  RecusaHomonimo,
  type AtorGG,
  type BaseOrg,
  type ErroOrg,
} from "@/lib/gg/organizacao";
import { diaDoPrazo } from "@/lib/calendario/semana";
import { liberarCanetasDe } from "@/lib/propostas/caneta-banco";
import { diaEmFuso } from "@/lib/projetos/aging";
import { resolverAreaEntrada } from "./areas";
import { podeAtribuirPapel } from "./papeis";
import { criarConvite, formatarLado, garantirAdminAtivoTx, RecusaAdmin, travarEntreAdminsTx, type DadosConvite, type ErroUsuario } from "./usuarios";

/**
 * `CONFLITO_DE_LADO`: posições vigentes em Vendas e em Projetos sem uma principal entre elas.
 * `CONFIRMAR_CONTA`: a conta que vai ser gravada não é a que a tela mostrava (ver `ContaAConfirmar`).
 */
export type ErroCadastro = ErroUsuario | ErroOrg | "CONFLITO_DE_LADO" | "CONFIRMAR_CONTA";
/**
 * Pedido de confirmação (GAB-107, revisão): `atual` = o que a tela mostrava (ou a conta de hoje, na
 * edição), `conta` = o que vai ser gravado, `posicoes` = as posições vigentes que levam a isso.
 */
export type ContaAConfirmar = { atual: string; conta: string; posicoes: string[] };
/** Falha; `homonimos` = membros sem e-mail e sem conta com o mesmo nome, para a tela pedir confirmação. */
export type FalhaCadastro = { ok: false; erro: ErroCadastro; detalhe?: string; homonimos?: { id: string; nome: string }[]; confirmarConta?: ContaAConfirmar };
export type ResultadoCadastro<T = object> = ({ ok: true } & T) | FalhaCadastro;
/**
 * Confirmações da tela: homônimo (ligar a ele, `ligarMembroId`, ou é outra pessoa, `criarMembroNovo`)
 * e `confirmarConta`: a conta resultante que quem cadastra/edita viu e aceitou (o texto de
 * `descreverConta`). Só vale se for exatamente a que vai ser gravada: confirmação velha não serve.
 */
export type ConfirmacaoMembro = { ligarMembroId?: string | null; criarMembroNovo?: boolean; confirmarConta?: string | null };
/** Ficha do G&G que já existia e foi ligada à conta, com as posições abertas dela (para o resultado do cadastro). */
export type FichaLigada = { nome: string; posicoes: string[] };

type Ator = { id: string; papel: Papel; nome?: string };

/** Desfaz a transação levando o erro de regra da conta (o Postgres não segue depois do erro). */
class Desfaz extends Error {
  constructor(readonly erro: ErroUsuario | "CONFLITO_DE_LADO") {
    super(erro);
  }
}

/** Recusa da régua da conta (alvo, papel), antes ou dentro da transação. */
class RecusaConta extends Desfaz {}

/** A conta resultante não é a que quem cadastra/edita viu: desfaz e pede confirmação explícita. */
class RecusaConfirmarConta extends Error {
  constructor(readonly pedido: ContaAConfirmar) {
    super("CONFIRMAR_CONTA");
  }
}

type ContaComparavel = { papel: Papel; area: Area | null; cargos: readonly Cargo[] };
const mesmaConta = (a: ContaComparavel, b: ContaComparavel) => a.papel === b.papel && a.area === b.area && [...a.cargos].sort().join() === [...b.cargos].sort().join();

const atorGG = (a: Ator): AtorGG => ({ id: a.id, nome: a.nome ?? "", papel: a.papel });
const hoje = () => diaEmFuso(new Date());

/** Exportada para o teste do P2002 real. */
export function traduzir(e: unknown): FalhaCadastro {
  if (e instanceof Desfaz) return { ok: false, erro: e.erro };
  if (e instanceof RecusaAdmin) return { ok: false, erro: e.erro };
  if (e instanceof RecusaConfirmarConta) return { ok: false, erro: "CONFIRMAR_CONTA", confirmarConta: e.pedido };
  if (e instanceof RecusaHomonimo) return { ok: false, erro: e.erro, homonimos: e.membros };
  if (e instanceof Recusa) return { ok: false, erro: e.erro, ...(e.detalhe ? { detalhe: e.detalhe } : {}) };
  // Índice `membro_email_unico` (lower(trim(email))): outro membro com o e-mail em outra grafia.
  const err = e as { code?: string; meta?: { target?: unknown; modelName?: unknown } };
  if (err?.code === "P2002" && err.meta?.modelName === "Membro" && String(err.meta?.target ?? "").includes("email")) return { ok: false, erro: "MEMBRO_EMAIL_EM_USO" };
  throw e;
}

async function fichaLigada(tx: Prisma.TransactionClient, membroId: string): Promise<FichaLigada> {
  const m = await tx.membro.findUniqueOrThrow({
    where: { id: membroId },
    select: { nome: true, ocupacoes: { where: { fim: null, invalidadoEm: null }, select: { posicao: { select: { area: { select: { nome: true } }, cargo: { select: { nome: true } } } } } } },
  });
  return { nome: m.nome, posicoes: m.ocupacoes.map((o) => `${o.posicao.area.nome} · ${o.posicao.cargo.nome}`) };
}

type PostoVigente = PostoDerivavel & { posicaoId: string; rotulo: string };

/**
 * Posições vigentes hoje do membro, como o organograma as vê (`carregarBase`: posição, área e
 * cargo ativos), no formato de `derivarDoOrganograma`. Lado = o da área-raiz; institucional = a área
 * da própria posição. `rotulo` = "Área · Cargo", para a tela de confirmação.
 */
async function postosVigentesTx(tx: Prisma.TransactionClient, membroId: string): Promise<PostoVigente[]> {
  const dia = hoje();
  const ocs = await tx.ocupacao.findMany({
    where: { membroId, invalidadoEm: null, posicao: { ativo: true, area: { ativo: true }, cargo: { ativo: true } } },
    select: {
      inicio: true,
      fim: true,
      principal: true,
      posicao: { select: { id: true, areaId: true, area: { select: { nome: true, tipo: true } }, cargo: { select: { id: true, nome: true, categoria: true, ehGp: true } } } },
    },
  });
  const vigentes = ocs.filter((o) => vigente({ inicio: o.inicio ? diaDoPrazo(o.inicio) : null, fim: o.fim ? diaDoPrazo(o.fim) : null }, dia));
  if (!vigentes.length) return [];
  const areas = await tx.areaOrg.findMany({ where: { ativo: true }, select: { id: true, nome: true, tipo: true, superiorId: true, ladoCrm: true, ehGG: true } });
  return vigentes.map((o) => {
    const c = o.posicao.cargo;
    return {
      ladoCrm: raizDe(areas, o.posicao.areaId)?.ladoCrm ?? null,
      institucional: o.posicao.area.tipo === "INSTITUCIONAL",
      categoria: c.categoria,
      ehGp: c.ehGp,
      ehPo: ehCargoPo(c),
      principal: o.principal,
      posicaoId: o.posicao.id,
      rotulo: `${o.posicao.area.nome} · ${c.nome}`,
    };
  });
}

/**
 * Grava papel/lado/cargos derivados; quem perdeu o direito solta a caneta. A área de entrada que a
 * conta já tinha fica, se ainda valer para o papel novo (o admin pode ter escolhido); senão, a derivada.
 * Devolve se mudou algo.
 */
async function gravarConta(
  tx: Prisma.TransactionClient,
  usuarioId: string,
  nova: ContaDerivada,
  porId: string,
  atual: { papel: Papel; area: Area | null; cargos: readonly Cargo[]; areaEntrada: AreaEntrada | null },
): Promise<boolean> {
  const mudou = atual.papel !== nova.papel || atual.area !== nova.area || [...atual.cargos].sort().join() !== [...nova.cargos].sort().join();
  if (!mudou) return false;
  const areaEntrada = resolverAreaEntrada(nova.papel, nova.area, atual.areaEntrada ?? nova.areaEntrada);
  await tx.usuario.update({ where: { id: usuarioId }, data: { papel: nova.papel, area: nova.area, cargos: nova.cargos, areaEntrada } });
  await liberarCanetasDe(tx, usuarioId, porId);
  return true;
}

/**
 * Cria a conta e SEMPRE o membro do G&G (ligado ou novo); com posição, também a ocupação
 * (principal). Papel/lado/cargos/área de entrada saem das posições vigentes do membro (a nova e as
 * de uma ficha já existente que foi ligada); o que o cliente mandar disso é ignorado. Homônimo
 * sem e-mail no G&G: falha com `homonimos` até a tela confirmar (`confirmacao`).
 * `administrador`: só um admin cadastra admin; de outro ator, recusa.
 * `previa`: o texto "Conta no CRM: …" que a tela mostrava. Se a conta gravada não for essa, pede
 * confirmação (sem `previa`, compara com a conta só da posição escolhida).
 */
export async function cadastrarPessoa(
  dados: Pick<DadosConvite, "nome" | "email" | "telefone"> & { posicaoId?: string | null; administrador?: boolean; previa?: string | null },
  por: Ator,
  confirmacao: ConfirmacaoMembro = {},
): Promise<ResultadoCadastro<{ usuarioId: string; membroId: string; fichaLigada: FichaLigada | null; token: string; expiraEm: Date; conta: ContaDerivada }>> {
  const posicaoId = dados.posicaoId || null;
  const administrador = dados.administrador === true;
  if (administrador && por.papel !== "ADMIN") return { ok: false, erro: "PAPEL_NAO_PERMITIDO" };
  try {
    const r = await db.$transaction(async (tx) => {
      // Só os campos de identidade passam; a conta nasce no menor papel e recebe o derivado abaixo.
      const c = await criarConvite({ nome: dados.nome, email: dados.email, telefone: dados.telefone, papel: "VISUALIZADOR", areaEntrada: "GERAL" }, por, tx);
      if (!c.ok) throw new Desfaz(c.erro);
      const m = await membroDaContaTx(tx, { usuarioId: c.usuarioId, nome: dados.nome, email: dados.email }, atorGG(por), {
        ligarMembroId: confirmacao.ligarMembroId,
        criarNovo: confirmacao.criarMembroNovo,
      });
      if (posicaoId) await atribuirPosicaoTx(tx, posicaoId, m.id, hoje(), atorGG(por), { principal: true });
      const postos = await postosVigentesTx(tx, m.id);
      const conta = contaDaDerivacao(derivarDoOrganograma(postos), { administrador });
      if (!conta) throw new Desfaz("CONFLITO_DE_LADO");
      // A prévia da tela é só da posição escolhida (sem posição: Visualizador). Ficha ligada com outras
      // posições (ex.: já colocada numa diretoria pelo G&G) pode dar outra conta: só com confirmação.
      const escolhida = postos.filter((p) => p.posicaoId === posicaoId).map((p) => ({ ...p, principal: true }));
      const mostrada = dados.previa || descreverConta(contaDaDerivacao(derivarDoOrganograma(escolhida), { administrador })!);
      const resultado = descreverConta(conta);
      if (resultado !== mostrada && confirmacao.confirmarConta !== resultado)
        throw new RecusaConfirmarConta({ atual: mostrada, conta: resultado, posicoes: postos.filter((p) => p.posicaoId !== posicaoId).map((p) => p.rotulo) });
      if (!podeAtribuirPapel(por.papel, conta.papel)) throw new Desfaz("PAPEL_NAO_PERMITIDO");
      await tx.usuario.update({ where: { id: c.usuarioId }, data: { papel: conta.papel, area: conta.area, cargos: conta.cargos, areaEntrada: conta.areaEntrada } });
      return { ...c, conta, membroId: m.id, fichaLigada: m.ligado ? await fichaLigada(tx, m.id) : null };
    });
    console.info(
      `[auditoria] usuario.convidado usuario=${r.usuarioId} por=${por.id} papel=${r.conta.papel} lado=${formatarLado(r.conta)} entrada=${r.conta.areaEntrada ?? "nenhuma"} membro=${r.membroId}${r.fichaLigada ? " membro_ligado=1" : ""} posicao=${posicaoId ?? "nenhuma"} derivado=1${confirmacao.confirmarConta ? " conta_confirmada=1" : ""}`,
    );
    return { ok: true, usuarioId: r.usuarioId, membroId: r.membroId, fichaLigada: r.fichaLigada, token: r.token, expiraEm: r.expiraEm, conta: r.conta };
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

/**
 * GAB-107: depois de atribuir/encerrar posição, a conta acompanha as posições que restam (mesma
 * transação). ADMIN nunca é rebaixado: continua ADMIN, mas lado e cargos acompanham as posições
 * (sem edição à mão, é o único jeito de mudá-los). Sem posição vigente, a conta fica como está: encerrar a
 * última posição não tranca ninguém fora (nem vira Visualizador sozinho); a gestão decide.
 * Conflito de lado: ao atribuir, recusa (marque uma principal); ao encerrar, mantém a conta, para
 * o encerramento não ficar travado.
 * Qualquer mudança na conta (papel, lado ou cargo) só com `confirmado` igual à conta resultante:
 * sem isso, desfaz tudo e devolve o pedido de confirmação. Devolve a conta como fica (para a tela) e a
 * linha de auditoria, se mudou.
 */
async function recalcularContaTx(
  tx: Prisma.TransactionClient,
  usuarioId: string,
  membroId: string,
  por: Ator,
  { recusarConflito, confirmado }: { recusarConflito: boolean; confirmado: string | null },
): Promise<{ conta: string; auditoria: string | null }> {
  const atual = await tx.usuario.findUniqueOrThrow({ where: { id: usuarioId }, select: { papel: true, area: true, cargos: true, areaEntrada: true } });
  const fica = { conta: descreverConta(atual), auditoria: null };
  const postos = await postosVigentesTx(tx, membroId);
  if (!postos.length) return fica;
  const conta = contaDaDerivacao(derivarDoOrganograma(postos), { administrador: atual.papel === "ADMIN" });
  if (!conta) {
    if (recusarConflito) throw new Desfaz("CONFLITO_DE_LADO");
    return fica;
  }
  if (!podeAtribuirPapel(por.papel, conta.papel)) throw new RecusaConta("PAPEL_NAO_PERMITIDO");
  if (!mesmaConta(conta, atual) && confirmado !== descreverConta(conta)) throw new RecusaConfirmarConta({ atual: descreverConta(atual), conta: descreverConta(conta), posicoes: postos.map((p) => p.rotulo) });
  const mudou = await gravarConta(tx, usuarioId, conta, por.id, atual);
  return { conta: descreverConta(conta), auditoria: mudou ? `${conta.papel} lado=${formatarLado(conta)}${confirmado ? " confirmada=1" : ""}` : null };
}

/** Edição de usuário: atribui uma posição (início hoje). Sem membro ligado, liga ou cria como no cadastro. */
export async function adicionarPosicaoAoUsuario(usuarioId: string, posicaoId: string, por: Ator, confirmacao: ConfirmacaoMembro = {}): Promise<ResultadoCadastro<{ conta: string }>> {
  try {
    const alvo = await alvoDaGestao(usuarioId, por);
    const conta = await db.$transaction(async (tx) => {
      await papelMantido(tx, alvo);
      const m = await membroDaContaTx(tx, { usuarioId: alvo.id, nome: alvo.nome, email: alvo.email }, atorGG(por), { ligarMembroId: confirmacao.ligarMembroId, criarNovo: confirmacao.criarMembroNovo });
      await atribuirPosicaoTx(tx, posicaoId, m.id, hoje(), atorGG(por));
      return recalcularContaTx(tx, alvo.id, m.id, por, { recusarConflito: true, confirmado: confirmacao.confirmarConta ?? null });
    });
    console.info(`[auditoria] usuario.posicao_atribuida usuario=${alvo.id} por=${por.id} posicao=${posicaoId}${conta.auditoria ? ` conta=${conta.auditoria}` : ""}`);
    return { ok: true, conta: conta.conta };
  } catch (e) {
    return traduzir(e);
  }
}

/** Edição de usuário: encerra hoje uma ocupação aberta do membro ligado a esta conta. */
export async function encerrarOcupacaoDoUsuario(usuarioId: string, ocupacaoId: string, por: Ator, { confirmarConta = null }: { confirmarConta?: string | null } = {}): Promise<ResultadoCadastro<{ conta: string }>> {
  try {
    const alvo = await alvoDaGestao(usuarioId, por);
    const conta = await db.$transaction(async (tx) => {
      await papelMantido(tx, alvo);
      const m = await tx.membro.findUnique({ where: { usuarioId: alvo.id }, select: { id: true } });
      if (!m) throw new Recusa("NAO_ENCONTRADO");
      await encerrarOcupacaoTx(tx, ocupacaoId, hoje(), atorGG(por), m.id);
      return recalcularContaTx(tx, alvo.id, m.id, por, { recusarConflito: false, confirmado: confirmarConta });
    });
    console.info(`[auditoria] usuario.ocupacao_encerrada usuario=${alvo.id} por=${por.id} ocupacao=${ocupacaoId}${conta.auditoria ? ` conta=${conta.auditoria}` : ""}`);
    return { ok: true, conta: conta.conta };
  } catch (e) {
    return traduzir(e);
  }
}

/**
 * "Administrador" na edição de usuário (GAB-107): só o admin marca ou desmarca, e nunca na própria conta
 * (ninguém se rebaixa; com um admin só, não há outro admin para rebaixá-lo). Marcar: papel ADMIN,
 * mantendo o lado e os cargos. Desmarcar: a conta volta a sair das posições vigentes (sem posição,
 * Visualizador), e só com `confirmarConta` igual à conta resultante. Devolve como a conta ficou.
 * Corrida entre dois admins (um tira o outro ao mesmo tempo): as linhas dos dois ficam travadas, quem
 * age tem de ainda ser admin ativo, e se depois da mudança não sobrar admin ativo, tudo é desfeito.
 */
export async function definirAdministrador(usuarioId: string, administrador: boolean, por: Ator, { confirmarConta = null }: { confirmarConta?: string | null } = {}): Promise<ResultadoCadastro<{ conta: string }>> {
  try {
    if (por.papel !== "ADMIN") throw new RecusaConta("PAPEL_NAO_PERMITIDO");
    const alvo = await db.usuario.findUnique({ where: { id: usuarioId }, select: { id: true, papel: true, area: true, cargos: true, areaEntrada: true } });
    if (!alvo) throw new RecusaConta("USUARIO_NAO_ENCONTRADO");
    if ((alvo.papel === "ADMIN") === administrador) return { ok: true, conta: descreverConta(alvo) };
    if (alvo.id === por.id) throw new RecusaConta("NAO_PODE_ALTERAR_A_SI");
    const conta = await db.$transaction(async (tx) => {
      await travarEntreAdminsTx(tx, por.id, alvo.id);
      await papelMantido(tx, alvo);
      if (administrador) {
        const areaEntrada = resolverAreaEntrada("ADMIN", alvo.area, alvo.areaEntrada ?? alvo.area ?? "GERAL");
        await tx.usuario.update({ where: { id: alvo.id }, data: { papel: "ADMIN", areaEntrada } });
        return { papel: "ADMIN" as const, area: alvo.area, cargos: alvo.cargos };
      }
      const m = await tx.membro.findUnique({ where: { usuarioId: alvo.id }, select: { id: true } });
      const nova = contaDaDerivacao(derivarDoOrganograma(m ? await postosVigentesTx(tx, m.id) : []));
      if (!nova) throw new Desfaz("CONFLITO_DE_LADO");
      const resultado = descreverConta(nova);
      if (confirmarConta !== resultado) throw new RecusaConfirmarConta({ atual: descreverConta(alvo), conta: resultado, posicoes: m ? (await postosVigentesTx(tx, m.id)).map((x) => x.rotulo) : [] });
      await gravarConta(tx, alvo.id, nova, por.id, alvo);
      await garantirAdminAtivoTx(tx);
      return nova;
    });
    console.info(`[auditoria] usuario.papel_alterado usuario=${alvo.id} por=${por.id} de=${alvo.papel} para=${conta.papel} lado=${formatarLado(conta)} origem=administrador`);
    return { ok: true, conta: descreverConta(conta) };
  } catch (e) {
    return traduzir(e);
  }
}

// ---------------------------------------------------------------- leitura para a tela da Gestão

/** O que a posição sugere para a conta (`derivarDoOrganograma` com ela como única ocupação, principal). */
export type SugestaoConta = { papel: Papel; area: Area | null; cargos: Cargo[] };
/** Uma posição ativa. `rotulo` = "Área · Cargo"; `cargo` = o que o select de cargo mostra. */
export type OpcaoPosicao = { id: string; rotulo: string; cargo: string; ehGG: boolean; pareceGG: boolean; sugestao: SugestaoConta };
/** Nó do organograma (área de topo ou frente) com as posições ativas que ficam nele. */
export type NoPosicoes = { id: string; nome: string; posicoes: OpcaoPosicao[] };
/** Área de topo, com as posições direto nela e as frentes (todas as abaixo dela, achatadas). */
export type AreaPosicoes = NoPosicoes & { frentes: NoPosicoes[]; ehGG: boolean; pareceGG: boolean };
export type OcupacaoDaConta = { ocupacaoId: string; rotulo: string; principal: boolean; inicio: string | null };

const comparar = (a: string, b: string) => a.localeCompare(b, "pt-BR");

/**
 * Posições ativas para a seleção em cascata "Posição na IJ" (área de topo → frente → cargo).
 * Só entram áreas de topo com alguma posição ativa nelas ou nas frentes. O cargo leva o nome da
 * posição quando o mesmo nó tem duas posições com o mesmo cargo.
 * `temAreaGG`: há área marcada `ehGG` (sem ela, ninguém vira editor de G&G pela posição).
 */
export function opcoesDePosicao(base: BaseOrg): { areas: AreaPosicoes[]; temAreaGG: boolean } {
  const gg = areasGG(base.areas);
  const cargo = (id: string) => base.cargos.find((c) => c.id === id);
  const no = (areaId: string): OpcaoPosicao[] => {
    const a = base.areas.find((x) => x.id === areaId)!;
    const raiz = raizDe(base.areas, a.id) ?? a;
    const ps = base.posicoes.filter((p) => p.areaId === areaId && cargo(p.cargoId));
    const contagem = new Map<string, number>();
    for (const p of ps) contagem.set(p.cargoId, (contagem.get(p.cargoId) ?? 0) + 1);
    return ps
      .map((p) => {
        const c = cargo(p.cargoId)!;
        const d = derivarDoOrganograma([{ ladoCrm: raiz.ladoCrm, institucional: a.tipo === "INSTITUCIONAL", categoria: c.categoria, ehGp: c.ehGp, ehPo: ehCargoPo(c), principal: true }]);
        const nomeCargo = (contagem.get(p.cargoId) ?? 0) > 1 ? `${c.nome} (${p.nome})` : c.nome;
        return {
          id: p.id,
          rotulo: `${a.nome} · ${nomeCargo}`,
          cargo: nomeCargo,
          ehGG: gg.has(a.id),
          pareceGG: gg.has(a.id) || pareceAreaGG(a.nome) || pareceAreaGG(raiz.nome),
          sugestao: { papel: d.papel ?? "VISUALIZADOR", area: d.area, cargos: d.cargos },
        };
      })
      .sort((x, y) => comparar(x.cargo, y.cargo));
  };
  const areas = base.areas
    .filter((a) => a.superiorId === null || !base.areas.some((x) => x.id === a.superiorId))
    .map((a): AreaPosicoes => {
      const abaixo = [...descendentes(base.areas, a.id)].filter((id) => id !== a.id).map((id) => base.areas.find((x) => x.id === id)!);
      // Frentes de mesmo nome em ramos diferentes mostram o caminho abaixo da área ("Pessoas · Seleção").
      // O banco já barra nome igual (lower/trim); aqui "igual" também ignora acento e espaços, que ele deixa passar.
      const caminho = (f: (typeof abaixo)[number]) => {
        const nomes: string[] = [];
        for (let x: typeof f | undefined = f; x && x.id !== a.id; x = base.areas.find((y) => y.id === x!.superiorId)) nomes.unshift(x.nome);
        return nomes.join(" · ");
      };
      const chave = (nome: string) => normalizar(nome).replace(/\s+/g, " ");
      const repetido = (nome: string) => abaixo.filter((x) => chave(x.nome) === chave(nome)).length > 1;
      const frentes = abaixo
        .map((f) => ({ id: f.id, nome: repetido(f.nome) ? caminho(f) : f.nome, posicoes: no(f.id) }))
        .filter((f) => f.posicoes.length > 0)
        .sort((x, y) => comparar(x.nome, y.nome));
      return { id: a.id, nome: a.nome, posicoes: no(a.id), frentes, ehGG: gg.has(a.id), pareceGG: gg.has(a.id) || pareceAreaGG(a.nome) };
    })
    .filter((a) => a.posicoes.length > 0 || a.frentes.length > 0)
    .sort((x, y) => comparar(x.nome, y.nome));
  return { areas, temAreaGG: gg.size > 0 };
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

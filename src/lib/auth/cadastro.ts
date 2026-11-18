/**
 * Cadastro único (GAB-105): Gestão → Usuários cadastra a pessoa num lugar só. Numa transação:
 * a conta do CRM (`criarConvite`) e, quando há posição escolhida, o membro do G&G (o mesmo
 * e-mail ligado, o homônimo sem e-mail confirmado na tela, ou um novo) e a ocupação da posição
 * (início hoje, principal). Sem posição, só a conta. Qualquer recusa no meio desfaz tudo.
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
import { derivarDoOrganograma, descendentes, normalizar, pareceAreaGG } from "@/lib/gg/modelo";
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
import { diaEmFuso } from "@/lib/projetos/aging";
import { podeAtribuirPapel } from "./papeis";
import { criarConvite, formatarLado, type DadosConvite, type ErroUsuario } from "./usuarios";

export type ErroCadastro = ErroUsuario | ErroOrg;
/** Falha; `homonimos` = membros sem e-mail e sem conta com o mesmo nome, para a tela pedir confirmação. */
export type FalhaCadastro = { ok: false; erro: ErroCadastro; detalhe?: string; homonimos?: { id: string; nome: string }[] };
export type ResultadoCadastro<T = object> = ({ ok: true } & T) | FalhaCadastro;
/** Confirmação da tela quando há homônimo: ligar a ele (`ligarMembroId`) ou é outra pessoa (`criarMembroNovo`). */
export type ConfirmacaoMembro = { ligarMembroId?: string | null; criarMembroNovo?: boolean };
/** Ficha do G&G que já existia e foi ligada à conta, com as posições abertas dela (para o resultado do cadastro). */
export type FichaLigada = { nome: string; posicoes: string[] };

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

/** Exportada para o teste do P2002 real. */
export function traduzir(e: unknown): FalhaCadastro {
  if (e instanceof Desfaz) return { ok: false, erro: e.erro };
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

/**
 * Sem posição, só a conta (como antes do cadastro único); com posição, também o membro e a
 * ocupação. Homônimo sem e-mail no G&G: falha com `homonimo` até a tela confirmar (`confirmacao`).
 */
export async function cadastrarPessoa(
  dados: DadosConvite & { posicaoId?: string | null },
  por: Ator,
  confirmacao: ConfirmacaoMembro = {},
): Promise<ResultadoCadastro<{ usuarioId: string; membroId: string | null; fichaLigada: FichaLigada | null; token: string; expiraEm: Date }>> {
  const posicaoId = dados.posicaoId || null;
  try {
    const r = await db.$transaction(async (tx) => {
      const c = await criarConvite(dados, por, tx);
      if (!c.ok) throw new Desfaz(c.erro);
      if (!posicaoId) return { ...c, membroId: null, fichaLigada: null };
      const m = await membroDaContaTx(tx, { usuarioId: c.usuarioId, nome: dados.nome, email: dados.email }, atorGG(por), {
        ligarMembroId: confirmacao.ligarMembroId,
        criarNovo: confirmacao.criarMembroNovo,
      });
      await atribuirPosicaoTx(tx, posicaoId, m.id, hoje(), atorGG(por), { principal: true });
      return { ...c, membroId: m.id, fichaLigada: m.ligado ? await fichaLigada(tx, m.id) : null };
    });
    console.info(
      `[auditoria] usuario.convidado usuario=${r.usuarioId} por=${por.id} papel=${r.papel} lado=${formatarLado(r)} entrada=${r.areaEntrada ?? "nenhuma"} membro=${r.membroId ?? "nenhum"}${r.fichaLigada ? " membro_ligado=1" : ""} posicao=${posicaoId ?? "nenhuma"}`,
    );
    return { ok: true, usuarioId: r.usuarioId, membroId: r.membroId, fichaLigada: r.fichaLigada, token: r.token, expiraEm: r.expiraEm };
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
export async function adicionarPosicaoAoUsuario(usuarioId: string, posicaoId: string, por: Ator, confirmacao: ConfirmacaoMembro = {}): Promise<ResultadoCadastro> {
  try {
    const alvo = await alvoDaGestao(usuarioId, por);
    await db.$transaction(async (tx) => {
      await papelMantido(tx, alvo);
      const m = await membroDaContaTx(tx, { usuarioId: alvo.id, nome: alvo.nome, email: alvo.email }, atorGG(por), { ligarMembroId: confirmacao.ligarMembroId, criarNovo: confirmacao.criarMembroNovo });
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
        const d = derivarDoOrganograma([{ ladoCrm: raiz.ladoCrm, categoria: c.categoria, ehGp: c.ehGp, ehPo: ehCargoPo(c), principal: true }]);
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

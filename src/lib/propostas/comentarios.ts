/**
 * Comentários na proposta (GAB-91, spec fase 2 §4.6). A tela (server actions
 * + polling em /api/projetos/[id]/comentarios) e o conector MCP chamam ESTAS
 * funções — nenhuma regra mora fora.
 *
 * - Quem vê a proposta (GAB-98, `./acesso`) e está ATIVO comenta, responde, resolve
 *   e reabre, em qualquer etapa e sem a caneta. Comentar não edita o texto (a caneta
 *   segue valendo para editar). VISUALIZADOR não vê proposta: não comenta mais.
 * - Comentário geral ou preso a um trecho (âncora = trecho citado + contexto,
 *   `./ancora.ts`). Da tela vem a âncora pronta (o editor pode ter texto ainda
 *   não gravado pelo autosave); do MCP vem só o trecho, que o servidor acha no
 *   rascunho atual (não achou → TRECHO_NAO_ENCONTRADO).
 * - Respostas: um nível; responder a uma resposta entra na mesma thread.
 * - Resolver/reabrir: estado na raiz + evento na Timeline do Projeto (o
 *   histórico, marcado "via MCP" pelo `db` quando for o caso).
 * - Preso à PROPOSTA, não à versão: sobrevive a versões novas. Trecho que sumiu
 *   do rascunho = `trechoAlterado` (o comentário continua visível).
 * - Aviso só no app (COMENTARIO) para o dono da caneta, depois do commit, pela
 *   camada `emitirAvisos`; quem comentou nunca avisa a si mesmo.
 *
 * Revisão (GAB-101, spec proposta-folha §6):
 * - Sugestão aplicável: o texto novo de um trecho de um bloco. Quem tem a caneta aplica
 *   (`aplicarSugestao`), pelo mesmo núcleo do autosave, e isso resolve a conversa.
 * - Lote: comentário pendente só o autor vê, em tudo (lista, carimbo do polling, MCP, id), e não
 *   conta como aberto. `enviarRevisao` publica tudo e gera um único aviso.
 * - Campo: comentário preso a um dado estruturado, sem sugestão (um clique mudaria valor ou prazo).
 * - Por id, nenhuma ação conta se o comentário existe para quem não pode vê-lo: inexistente, sem
 *   acesso à proposta e pendente de outra pessoa dão o mesmo COMENTARIO_NAO_ENCONTRADO.
 */
import { emViaMcp } from "@/lib/canal";
import { emitirAvisos } from "@/lib/avisos/avisos";
import { db } from "@/lib/db";
import { podeVerPropostaDoProjeto } from "./acesso";
import { TITULO_BLOCO_DADOS } from "./blocos-dados";
import { TIPOS_BLOCO_DADOS } from "./documento";
import { ancoraDoBloco, CONTEXTO_ANCORA, criarAncora, localizarAncora, normalizarBloco, normalizarContexto, normalizarTrecho, textoPlano, TRECHO_MAX, type Ancora } from "./ancora";
import { CAMPOS_COMENTARIO, COMENTARIO_MAX, SUGESTAO_MAX, type CampoComentario } from "./comentarios-limites";
import { documentoParaMarkdown, markdownParaDocumento } from "./markdown";
import { alterarRascunho, type ConteudoEntrada, type Falha as FalhaProposta } from "./propostas";
import { aplicarNoDocumento, localizarSugestao, temCaractereReservado, trechoSugerivel } from "./sugestao-trecho";

export { COMENTARIO_MAX };

export type ErroComentario =
  | "PROJETO_NAO_ENCONTRADO"
  | "PROPOSTA_NAO_ENCONTRADA"
  | "COMENTARIO_NAO_ENCONTRADO"
  | "SEM_PERMISSAO"
  | "TEXTO_VAZIO"
  | "TEXTO_LONGO"
  | "TRECHO_INVALIDO"
  | "TRECHO_NAO_ENCONTRADO"
  | "JA_RESOLVIDO"
  | "NAO_RESOLVIDO"
  | "CAMPO_INVALIDO"
  | "SUGESTAO_INVALIDA"
  | "SUGESTAO_LONGA"
  | "SUGESTAO_IGUAL"
  | "SEM_SUGESTAO"
  | "SUGESTAO_DESATUALIZADA"
  | "SUGESTAO_JA_APLICADA"
  | "PENDENTE"
  | "NAO_PENDENTE"
  | "NADA_PENDENTE";

export const MENSAGEM_ERRO_COMENTARIO: Record<ErroComentario, string> = {
  PROJETO_NAO_ENCONTRADO: "Projeto não encontrado (ou está na lixeira).",
  PROPOSTA_NAO_ENCONTRADA: "Este projeto ainda não tem proposta.",
  COMENTARIO_NAO_ENCONTRADO: "Comentário não encontrado.",
  SEM_PERMISSAO: "Só quem tem acesso à proposta comenta.",
  TEXTO_VAZIO: "Escreva o comentário.",
  TEXTO_LONGO: `Comentário longo demais (máximo ${COMENTARIO_MAX} caracteres).`,
  TRECHO_INVALIDO: `Trecho inválido: selecione de 1 a ${TRECHO_MAX} caracteres do texto.`,
  TRECHO_NAO_ENCONTRADO: "Esse trecho não está no texto atual da proposta. Cite o texto exato como aparece (sem a marcação Markdown).",
  JA_RESOLVIDO: "Este comentário já está resolvido.",
  NAO_RESOLVIDO: "Este comentário não está resolvido.",
  CAMPO_INVALIDO: "Campo inválido: comente valor, prazo, escopo ou entregas.",
  SUGESTAO_INVALIDA: "Sugestão só vale para um trecho de um mesmo bloco de texto. Dados e blocos Cronograma e Investimento aceitam comentário.",
  SUGESTAO_LONGA: `Sugestão longa demais (máximo ${SUGESTAO_MAX} caracteres).`,
  SUGESTAO_IGUAL: "A sugestão é igual ao trecho: mude o texto.",
  SEM_SUGESTAO: "Este comentário não tem sugestão.",
  SUGESTAO_DESATUALIZADA: "O trecho mudou depois da sugestão: ela está desatualizada e não se aplica.",
  SUGESTAO_JA_APLICADA: "Esta sugestão já foi aplicada, ou a conversa já foi resolvida.",
  PENDENTE: "Este comentário ainda está na sua revisão: envie a revisão antes.",
  NAO_PENDENTE: "Este comentário já foi publicado.",
  NADA_PENDENTE: "Não há comentários na sua revisão.",
};

type Falha = { ok: false; erro: ErroComentario };
type Ator = { id: string };

export type ComentarioLido = { id: string; autor: { id: string; nome: string }; texto: string; criadoEm: Date; viaMcp: boolean; pendente: boolean };
export type SugestaoLida = {
  texto: string;
  aplicada: { por: string | null; em: Date } | null;
  /** O trecho mudou e ainda não foi aplicada: não se aplica mais. */
  desatualizada: boolean;
};
export type Thread = ComentarioLido & {
  /** null = comentário geral ou de campo. */
  ancora: Ancora | null;
  campo: CampoComentario | null;
  sugestao: SugestaoLida | null;
  /** O trecho não está mais no rascunho atual (editado/apagado). */
  trechoAlterado: boolean;
  resolvido: { por: string | null; em: Date } | null;
  respostas: ComentarioLido[];
};

/** Texto puro: apara e tira NUL (o Postgres recusa); o React escapa o resto na tela. */
function limparTexto(t: string): { ok: true; texto: string } | Falha {
  const texto = t.replace(/\u0000/g, "").trim();
  if (!texto) return { ok: false, erro: "TEXTO_VAZIO" };
  if (texto.length > COMENTARIO_MAX) return { ok: false, erro: "TEXTO_LONGO" };
  return { ok: true, texto };
}

/** Autor RELIDO do banco: ativo e com acesso à proposta deste projeto (a regra vale para a tela e o MCP). */
async function autorComAcesso(id: string, projetoId: string) {
  const u = await db.usuario.findUnique({ where: { id }, select: { id: true, nome: true, ativo: true, papel: true, area: true, cargos: true } });
  return u?.ativo && (await podeVerPropostaDoProjeto(u, projetoId)) ? u : null;
}

/** Proposta de Projeto vivo (fora da lixeira), com o que o aviso precisa. */
async function propostaViva(projetoId: string): Promise<{ id: string; projetoId: string; titulo: string; canetaComId: string | null; conteudoMd: string } | Falha> {
  const projeto = await db.projeto.findFirst({
    where: { id: projetoId, deletadoEm: null },
    select: { titulo: true, proposta: { select: { id: true, canetaComId: true, conteudoMd: true } } },
  });
  if (!projeto) return { ok: false, erro: "PROJETO_NAO_ENCONTRADO" };
  if (!projeto.proposta) return { ok: false, erro: "PROPOSTA_NAO_ENCONTRADA" };
  return { ...projeto.proposta, projetoId, titulo: projeto.titulo };
}

const ehFalha = (x: object): x is Falha => (x as { ok?: unknown }).ok === false;

const NAO_ENCONTRADO: Falha = { ok: false, erro: "COMENTARIO_NAO_ENCONTRADO" };

/**
 * Comentário por id, para quem pode vê-lo: autor relido do banco, com acesso à proposta, e pendente
 * só para quem o escreveu. Qualquer outro caso é "não encontrado", o mesmo de um id que não existe.
 */
async function comentarioVisivel(comentarioId: string, ator: Ator) {
  const c = await db.propostaComentario.findUnique({
    where: { id: comentarioId },
    select: { id: true, paiId: true, autorId: true, pendente: true, pai: { select: { pendente: true } }, proposta: { select: { projetoId: true } } },
  });
  if (!c) return NAO_ENCONTRADO;
  const autor = await autorComAcesso(ator.id, c.proposta.projetoId);
  if (!autor || (c.pendente && c.autorId !== autor.id)) return NAO_ENCONTRADO;
  const proposta = await propostaViva(c.proposta.projetoId);
  if (ehFalha(proposta)) return NAO_ENCONTRADO;
  return { raizId: c.paiId ?? c.id, proposta, autor, comentario: c, raizPendente: c.pai ? c.pai.pendente : c.pendente };
}

/**
 * Âncora vinda da tela, no formato CANÔNICO do texto plano (o editor já
 * normaliza; aqui de novo, por defesa: cliente velho ou chamada direta). Sem
 * isso, "a  b" digitado no editor nunca seria achado no rascunho salvo.
 */
function ancoraDaTela(a: Ancora): Ancora | null {
  if (typeof a?.trecho !== "string" || typeof a.antes !== "string" || typeof a.depois !== "string") return null;
  const trecho = normalizarTrecho(a.trecho);
  if (!trecho || trecho.length > TRECHO_MAX) return null;
  return { trecho, antes: normalizarContexto(a.antes).slice(-CONTEXTO_ANCORA), depois: normalizarContexto(a.depois).slice(0, CONTEXTO_ANCORA) };
}

/** Avisa (só no app) o dono da caneta. Depois do commit; nunca lança (`emitirAvisos`). */
async function avisarDono(p: { projetoId: string; titulo: string; canetaComId: string | null }, autor: { id: string; nome: string }, resposta: boolean) {
  if (!p.canetaComId || p.canetaComId === autor.id) return;
  const titulo = resposta ? `${autor.nome} respondeu a um comentário na proposta de "${p.titulo}"` : `${autor.nome} comentou na proposta de "${p.titulo}"`;
  await emitirAvisos([{ usuarioId: p.canetaComId, tipo: "COMENTARIO", titulo, projetoId: p.projetoId }]);
}

export type NovoComentario = {
  texto: string;
  /** Âncora pronta (tela) ou o texto citado (MCP: o servidor acha no rascunho atual, primeira ocorrência). */
  trecho?: Ancora | string | null;
  campo?: CampoComentario | null;
  /** Texto novo do trecho; "" apaga. Sem `texto`, vale um texto padrão. */
  sugestao?: string | null;
  /** "Adicionar à revisão": só o autor vê até `enviarRevisao`. */
  pendente?: boolean;
};

const TEXTO_PADRAO_SUGESTAO = "Sugestão de texto.";

/** Comentário novo (raiz): geral, em trecho ou em campo; com sugestão ou não; agora ou na revisão. */
export async function comentar(projetoId: string, e: NovoComentario, ator: Ator): Promise<{ ok: true; comentario: { id: string } } | Falha> {
  const comSugestao = typeof e.sugestao === "string";
  const t = limparTexto(comSugestao && !e.texto.trim() ? TEXTO_PADRAO_SUGESTAO : e.texto);
  if (!t.ok) return t;
  if (e.campo && !CAMPOS_COMENTARIO.includes(e.campo)) return { ok: false, erro: "CAMPO_INVALIDO" };
  if (e.campo && (e.trecho || comSugestao)) return { ok: false, erro: e.trecho ? "TRECHO_INVALIDO" : "SUGESTAO_INVALIDA" };
  // Acesso primeiro: quem não vê a proposta não descobre se ela existe.
  const autor = await autorComAcesso(ator.id, projetoId);
  if (!autor) return { ok: false, erro: "SEM_PERMISSAO" };
  const p = await propostaViva(projetoId);
  if (ehFalha(p)) return p;

  let ancora: Ancora | null = null;
  if (typeof e.trecho === "string") {
    // Mesmo formato do texto plano canônico ("a  b" citado acha "a b").
    const citado = normalizarTrecho(e.trecho);
    if (!citado || citado.length > TRECHO_MAX) return { ok: false, erro: "TRECHO_INVALIDO" };
    const doc = markdownParaDocumento(p.conteudoMd);
    const plano = textoPlano(doc).texto;
    const i = plano.indexOf(citado);
    // O texto real vem primeiro; sem ele, citar o título de um bloco que está na folha é comentar o bloco (MCP, GAB-100).
    const bloco = TIPOS_BLOCO_DADOS.find((tipo) => TITULO_BLOCO_DADOS[tipo] === citado);
    ancora = i !== -1 ? criarAncora(plano, i, i + citado.length) : bloco ? ancoraDoBloco(doc, bloco) : null;
    if (!ancora) return { ok: false, erro: "TRECHO_NAO_ENCONTRADO" };
  } else if (e.trecho) {
    ancora = ancoraDaTela(e.trecho);
    if (!ancora) return { ok: false, erro: "TRECHO_INVALIDO" };
  }

  let sugestao: string | null = null;
  if (comSugestao) {
    if (!ancora || !trechoSugerivel(ancora.trecho) || temCaractereReservado(e.sugestao!)) return { ok: false, erro: "SUGESTAO_INVALIDA" };
    // Um bloco só, no formato canônico, como o Markdown guardaria.
    sugestao = normalizarBloco(e.sugestao!).texto;
    if (sugestao.length > SUGESTAO_MAX) return { ok: false, erro: "SUGESTAO_LONGA" };
    if (sugestao === ancora.trecho) return { ok: false, erro: "SUGESTAO_IGUAL" };
  }

  const pendente = e.pendente === true;
  const c = await db.propostaComentario.create({
    data: { propostaId: p.id, autorId: autor.id, texto: t.texto, trecho: ancora?.trecho ?? null, trechoAntes: ancora?.antes ?? null, trechoDepois: ancora?.depois ?? null, campo: e.campo ?? null, sugestao, pendente, viaMcp: emViaMcp() },
    select: { id: true },
  });
  if (!pendente) await avisarDono(p, autor, false);
  return { ok: true, comentario: c };
}

/** Resposta na thread de `comentarioId` (resposta a resposta vai para a mesma raiz). Na própria revisão pendente, a resposta também fica pendente. */
export async function responderComentario(comentarioId: string, texto: string, ator: Ator, opcoes: { pendente?: boolean } = {}): Promise<{ ok: true; comentario: { id: string } } | Falha> {
  const t = limparTexto(texto);
  if (!t.ok) return t;
  const r = await comentarioVisivel(comentarioId, ator);
  if (ehFalha(r)) return r;
  const pendente = opcoes.pendente === true || r.raizPendente;
  const c = await db.propostaComentario.create({
    data: { propostaId: r.proposta.id, paiId: r.raizId, autorId: r.autor.id, texto: t.texto, pendente, viaMcp: emViaMcp() },
    select: { id: true },
  });
  if (!pendente) await avisarDono(r.proposta, r.autor, true);
  return { ok: true, comentario: c };
}

async function mudarResolucao(comentarioId: string, ator: Ator, resolver: boolean): Promise<{ ok: true } | Falha> {
  const r = await comentarioVisivel(comentarioId, ator);
  if (ehFalha(r)) return r;
  if (r.raizPendente) return { ok: false, erro: "PENDENTE" };
  const agora = new Date();
  return db.$transaction(async (tx) => {
    // Condicional no próprio UPDATE: duas pessoas resolvendo juntas → uma só registra.
    const n = await tx.propostaComentario.updateMany({
      where: { id: r.raizId, resolvidoEm: resolver ? null : { not: null } },
      data: resolver ? { resolvidoEm: agora, resolvidoPorId: r.autor.id } : { resolvidoEm: null, resolvidoPorId: null },
    });
    if (n.count === 0) return { ok: false as const, erro: resolver ? ("JA_RESOLVIDO" as const) : ("NAO_RESOLVIDO" as const) };
    await tx.timeline.create({
      data: { projetoId: r.proposta.projetoId, tipo: "PROPOSTA", usuarioId: r.autor.id, em: agora, payload: { evento: resolver ? "comentario_resolvido" : "comentario_reaberto", comentarioId: r.raizId } },
    });
    return { ok: true as const };
  });
}

export function resolverComentario(comentarioId: string, ator: Ator) {
  return mudarResolucao(comentarioId, ator, true);
}

export function reabrirComentario(comentarioId: string, ator: Ator) {
  return mudarResolucao(comentarioId, ator, false);
}

// ---------------------------------------------------------------- revisão em lote

/** Publica todos os pendentes do autor nesta proposta. Um único aviso, depois do commit. */
export async function enviarRevisao(projetoId: string, ator: Ator): Promise<{ ok: true; publicados: number } | Falha> {
  const autor = await autorComAcesso(ator.id, projetoId);
  if (!autor) return { ok: false, erro: "SEM_PERMISSAO" };
  const p = await propostaViva(projetoId);
  if (ehFalha(p)) return p;
  const publicados = await db.$transaction(async (tx) => {
    // Condicional no próprio UPDATE: dois cliques em "Enviar" → só um publica e só um avisa.
    const n = await tx.propostaComentario.updateMany({ where: { propostaId: p.id, autorId: autor.id, pendente: true }, data: { pendente: false } });
    if (n.count > 0) await tx.timeline.create({ data: { projetoId, tipo: "PROPOSTA", usuarioId: autor.id, payload: { evento: "revisao_enviada", comentarios: n.count } } });
    return n.count;
  });
  if (publicados === 0) return { ok: false, erro: "NADA_PENDENTE" };
  if (p.canetaComId && p.canetaComId !== autor.id) {
    const titulo = `${autor.nome} enviou uma revisão com ${publicados} ${publicados === 1 ? "comentário" : "comentários"} na proposta de "${p.titulo}"`;
    await emitirAvisos([{ usuarioId: p.canetaComId, tipo: "COMENTARIO", titulo, projetoId }]);
  }
  return { ok: true, publicados };
}

/** Tira da revisão um comentário pendente do autor (nunca foi publicado). Levar a raiz leva as respostas pendentes dela. */
export async function descartarPendente(comentarioId: string, ator: Ator): Promise<{ ok: true } | Falha> {
  const r = await comentarioVisivel(comentarioId, ator);
  if (ehFalha(r)) return r;
  if (!r.comentario.pendente) return { ok: false, erro: "NAO_PENDENTE" };
  const n = await db.propostaComentario.deleteMany({ where: { id: comentarioId, autorId: r.autor.id, pendente: true } });
  return n.count ? { ok: true } : { ok: false, erro: "NAO_PENDENTE" };
}

// ---------------------------------------------------------------- sugestão

class RecusaDaSugestao extends Error {
  constructor(readonly erro: ErroComentario) {
    super(erro);
  }
}

/**
 * Aplica a sugestão: troca o trecho no texto (o que está na tela, `conteudo`, ou o salvo) e grava pelo
 * núcleo do autosave, que confere caneta, status e revisão. Na mesma transação, resolve a conversa e
 * registra quem aplicou. `projetoId` amarra o texto da tela à proposta do comentário: id de outra
 * proposta é "não encontrado", e nunca grava o texto de uma na outra.
 */
export async function aplicarSugestao(
  projetoId: string,
  comentarioId: string,
  m: { revisao: number; conteudo?: ConteudoEntrada },
  ator: Ator,
): Promise<{ ok: true; revisao: number } | Falha | FalhaProposta> {
  const r = await comentarioVisivel(comentarioId, ator);
  if (ehFalha(r)) return r;
  if (r.proposta.projetoId !== projetoId) return NAO_ENCONTRADO;
  if (r.raizPendente) return { ok: false, erro: "PENDENTE" };
  try {
    return await alterarRascunho(
      projetoId,
      {
        ...m,
        transformar: async (tx, md) => {
          // Relido sob o lock da proposta: dois cliques não aplicam duas vezes.
          const c = await tx.propostaComentario.findUniqueOrThrow({ where: { id: r.raizId }, select: { sugestao: true, sugestaoAplicadaEm: true, resolvidoEm: true, trecho: true, trechoAntes: true, trechoDepois: true } });
          if (c.sugestao === null || !c.trecho) throw new RecusaDaSugestao("SEM_SUGESTAO");
          if (c.sugestaoAplicadaEm || c.resolvidoEm) throw new RecusaDaSugestao("SUGESTAO_JA_APLICADA");
          const doc = markdownParaDocumento(md);
          const faixa = localizarSugestao(textoPlano(doc).texto, { trecho: c.trecho, antes: c.trechoAntes ?? "", depois: c.trechoDepois ?? "" });
          const novo = faixa && aplicarNoDocumento(doc, faixa, c.sugestao);
          if (!novo) throw new RecusaDaSugestao("SUGESTAO_DESATUALIZADA");
          return documentoParaMarkdown(novo);
        },
      },
      r.autor,
      async (tx) => {
        const agora = new Date();
        await tx.propostaComentario.update({ where: { id: r.raizId }, data: { sugestaoAplicadaEm: agora, sugestaoAplicadaPorId: r.autor.id, resolvidoEm: agora, resolvidoPorId: r.autor.id } });
        await tx.timeline.create({ data: { projetoId, tipo: "PROPOSTA", usuarioId: r.autor.id, em: agora, payload: { evento: "sugestao_aplicada", comentarioId: r.raizId } } });
      },
    );
  } catch (e) {
    if (e instanceof RecusaDaSugestao) return { ok: false, erro: e.erro };
    throw e;
  }
}

// ---------------------------------------------------------------- leitura

/** Só o autor vê os próprios pendentes: vale para a lista e para o carimbo, e o carimbo não muda com a revisão dos outros. */
const visivelPara = (leitor: Ator) => ({ OR: [{ pendente: false }, { autorId: leitor.id }] });

/**
 * Carimbo barato para o polling: quantos comentários + o último `atualizado_em`
 * (um aggregate no índice da proposta). Muda a cada comentário, resposta,
 * resolver ou reabrir, e com os pendentes só para o autor deles.
 */
export async function versaoDosComentarios(projetoId: string, leitor: Ator): Promise<string> {
  const a = await db.propostaComentario.aggregate({ where: { proposta: { projetoId }, ...visivelPara(leitor) }, _count: { _all: true }, _max: { atualizadoEm: true } });
  return carimbo(a._count._all, a._max.atualizadoEm);
}

function carimbo(n: number, max: Date | null | undefined): string {
  return `${n}.${max?.getTime() ?? 0}`;
}

/** Threads que o leitor vê (mais antigas primeiro), com "trecho alterado" contra o rascunho atual. null = sem projeto vivo/proposta. */
export async function listarComentarios(projetoId: string, leitor: Ator): Promise<{ versao: string; threads: Thread[] } | null> {
  const p = await propostaViva(projetoId);
  if (ehFalha(p)) return null;
  const linhas = await db.propostaComentario.findMany({
      where: { propostaId: p.id, ...visivelPara(leitor) },
      orderBy: [{ criadoEm: "asc" }, { id: "asc" }],
      select: {
        id: true,
        paiId: true,
        texto: true,
        trecho: true,
        trechoAntes: true,
        trechoDepois: true,
        campo: true,
        sugestao: true,
        sugestaoAplicadaEm: true,
        pendente: true,
        viaMcp: true,
        criadoEm: true,
        atualizadoEm: true,
        resolvidoEm: true,
        autor: { select: { id: true, nome: true } },
        resolvidoPor: { select: { nome: true } },
        sugestaoAplicadaPor: { select: { nome: true } },
      },
    });
  // Versão das PRÓPRIAS linhas lidas (uma query só): nunca descreve um estado diferente do que vai junto.
  const versao = carimbo(
    linhas.length,
    linhas.reduce<Date | null>((m, l) => (!m || l.atualizadoEm > m ? l.atualizadoEm : m), null),
  );
  const plano = linhas.some((l) => l.trecho) ? textoPlano(markdownParaDocumento(p.conteudoMd)).texto : "";
  const threads: Thread[] = [];
  const porId = new Map<string, Thread>();
  const base = (l: (typeof linhas)[number]): ComentarioLido => ({ id: l.id, autor: l.autor, texto: l.texto, criadoEm: l.criadoEm, viaMcp: l.viaMcp, pendente: l.pendente });
  for (const l of linhas) {
    if (l.paiId) continue;
    const ancora = l.trecho ? { trecho: l.trecho, antes: l.trechoAntes ?? "", depois: l.trechoDepois ?? "" } : null;
    const aplicada = l.sugestaoAplicadaEm ? { por: l.sugestaoAplicadaPor?.nome ?? null, em: l.sugestaoAplicadaEm } : null;
    const t: Thread = {
      ...base(l),
      ancora,
      campo: l.campo as CampoComentario | null,
      sugestao: l.sugestao !== null && ancora ? { texto: l.sugestao, aplicada, desatualizada: !aplicada && localizarSugestao(plano, ancora) === null } : null,
      trechoAlterado: ancora ? localizarAncora(plano, ancora) === null : false,
      resolvido: l.resolvidoEm ? { por: l.resolvidoPor?.nome ?? null, em: l.resolvidoEm } : null,
      respostas: [],
    };
    threads.push(t);
    porId.set(l.id, t);
  }
  for (const l of linhas) if (l.paiId) porId.get(l.paiId)?.respostas.push(base(l));
  return { versao, threads };
}

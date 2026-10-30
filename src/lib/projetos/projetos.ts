/**
 * Serviço de projetos do Kanban (GAB-29): criar card, mover, editar
 * inline, notas e leitura. Permissão é do chamador (`exigirEscrita`): pela
 * matriz de papéis (§4.5) qualquer usuário que escreve cria/edita/move. O
 * serviço ainda recusa VISUALIZADOR (`SEM_PERMISSAO`) quando o ator traz papel.
 *
 * Concorrência: criar e mover tomam o lock de pipeline da Gestão de fases
 * (`travarPipelines`, ordem fixa por id) e releem a fase destino DEPOIS do
 * lock — assim um card nunca cai numa fase que acabou de ser arquivada. Mover
 * para terminal trava também os quadros que o gancho do GAB-32 vai tocar
 * (`pipelinesExtrasDoTerminal`), todos de uma vez e na mesma ordem. Editar trava só a linha do card
 * (`FOR UPDATE`) para o "antes" da Timeline ser o valor que de fato mudou.
 *
 * Todo acesso filtra `deletadoEm: null`: card soft-deletado não aparece, não
 * move e não edita.
 */
import type { Fase, Origem, OrigemTransicao, Papel, Prisma, TipoTerminal, TipoTimeline } from "@prisma/client";
import { podeEscrever, QUEM_ATUA } from "@/lib/auth/papeis";
import { db } from "@/lib/db";
import { SELECAO_NOME_EXIBIDO, nomeExibido } from "@/lib/entidades/vinculo";
import { listarPipelines, travarPipelines } from "@/lib/fases/fases";
import { diaEmFuso } from "./aging";
import { validarTitulo, type CampoEditavel, type ValorCampo } from "./campos";
import { mudancaDescricao, PREVIA_DESCRICAO } from "./descricao";
import { ErroDeRegra, type ErroProjeto } from "./erros";

// Reexport: `feita.ts` (Minha Semana) importa daqui.
export { ErroDeRegra };
import { aoEntrarEmTerminal, pipelinesExtrasDoTerminal } from "./terminal";
import type { DadosTerminal } from "./terminal-regras";

export type { ErroProjeto } from "./erros";

export type Resultado<T = object> = ({ ok: true } & T) | { ok: false; erro: ErroProjeto };

type Tx = Prisma.TransactionClient;
/** `papel` opcional: import/WhatsApp agem em nome de alguém sem sessão. Veio → é conferido. */
type Ator = { id: string; papel?: Papel };

/** Defesa em profundidade (a action já chamou `exigirEscrita`): VISUALIZADOR não escreve. */
function soLeitura(por: Ator): boolean {
  return por.papel !== undefined && !podeEscrever(por.papel);
}

function traduzir<T>(e: unknown): Resultado<T> {
  if (e instanceof ErroDeRegra) return { ok: false, erro: e.erro };
  throw e;
}

async function idsDePipelines(tx: Tx, chaves: string[]): Promise<string[]> {
  if (chaves.length === 0) return [];
  const ps = await tx.pipeline.findMany({ where: { chave: { in: chaves } }, select: { id: true } });
  return ps.map((p) => p.id);
}

/** Pressupõe o lock do pipeline: relê a fase e valida que serve de destino. */
async function faseDestino(tx: Tx, faseId: string, pipelineId: string): Promise<Fase> {
  const f = await tx.fase.findUnique({ where: { id: faseId } });
  if (!f) throw new ErroDeRegra("FASE_NAO_ENCONTRADA");
  if (f.pipelineId !== pipelineId) throw new ErroDeRegra("FASE_DE_OUTRO_PIPELINE");
  if (f.arquivadaEm) throw new ErroDeRegra("FASE_ARQUIVADA");
  return f;
}

// ---------------------------------------------------------------- leitura

export type CardDoQuadro = {
  id: string;
  titulo: string;
  /** Até `PREVIA_DESCRICAO` caracteres (cortada no banco); o texto inteiro só em `obterCard`. */
  descricaoPrevia: string | null;
  descricaoTruncada: boolean;
  faseId: string;
  faseDesde: Date;
  revisar: boolean;
  proximaAcao: string | null;
  proximaAcaoEm: Date | null;
  origem: Origem | null;
  estado: string | null;
  responsavel: { id: string; nome: string; foto?: { atualizadoEm: Date } | null };
  empresa: { nome: string } | null;
  /** Último fechamento (mantido ao reabrir): pré-preenche o diálogo de ganho/perda. */
  valorFechado: { toFixed(n: number): string } | null;
  motivoPerda: string | null;
};

export type Quadro = {
  pipeline: { id: string; chave: string; nome: string };
  fases: Fase[];
  cards: CardDoQuadro[];
};

/**
 * Um quadro (pipeline) para o Kanban: fases ATIVAS em (ordem, criadoEm) e os
 * cards vivos delas. Cards mais recentes na fase primeiro (sem ordenação
 * manual dentro da coluna na v1).
 */
export async function listarQuadro(pipelineChave: string): Promise<Quadro | null> {
  const p = (await listarPipelines()).find((x) => x.chave === pipelineChave);
  if (!p) return null;
  const [cards, previas] = await Promise.all([
    db.projeto.findMany({
      where: { pipelineId: p.id, deletadoEm: null, faseId: { in: p.fases.map((f) => f.id) } },
      orderBy: [{ faseDesde: "desc" }, { id: "asc" }],
      select: {
        id: true,
        titulo: true,
        faseId: true,
        faseDesde: true,
        revisar: true,
        proximaAcao: true,
        proximaAcaoEm: true,
        origem: true,
        estado: true,
        responsavel: { select: { id: true, nome: true, foto: { select: { atualizadoEm: true } } } },
        // Empresa mesclada aparece com o nome da principal (merge 1 nível, GAB-36).
        empresa: { select: SELECAO_NOME_EXIBIDO },
        valorFechado: true,
        motivoPerda: true,
      },
    }),
    // Descrição pode ter 5000 caracteres: o quadro recebe só a prévia, cortada no
    // banco (LEFT conta caracteres, não bytes — não parte emoji).
    db.$queryRaw<{ id: string; previa: string; truncada: boolean }[]>`
      SELECT id, LEFT(descricao, ${PREVIA_DESCRICAO}::int) AS previa, char_length(descricao) > ${PREVIA_DESCRICAO}::int AS truncada
      FROM oportunidade
      WHERE pipeline_id = ${p.id} AND deletado_em IS NULL AND descricao IS NOT NULL`,
  ]);
  const previaPorId = new Map(previas.map((r) => [r.id, r]));
  return {
    pipeline: { id: p.id, chave: p.chave, nome: p.nome },
    fases: p.fases,
    cards: cards.map((c) => ({
      ...c,
      descricaoPrevia: previaPorId.get(c.id)?.previa ?? null,
      descricaoTruncada: previaPorId.get(c.id)?.truncada ?? false,
      empresa: c.empresa ? { nome: nomeExibido(c.empresa) } : null,
    })),
  };
}

export async function obterCard(id: string) {
  return db.projeto.findFirst({
    where: { id, deletadoEm: null },
    include: {
      pipeline: { select: { id: true, chave: true, nome: true } },
      fase: true,
      responsavel: { select: { id: true, nome: true, foto: { select: { atualizadoEm: true } } } },
      empresa: { select: { id: true, nome: true } },
      contato: { select: { id: true, nome: true } },
      // Cards de projetos da v1 unidos a este pela migração do ciclo único (GAB-81):
      // a Timeline herdada cita os ids deles — para a UI, são este mesmo card.
      absorvidos: { select: { id: true } },
      // Venda ↔ card de projetos da v1 que ficaram SEPARADOS (pares não unidos, GAB-81):
      // links da Timeline. A UI só linka os vivos e não absorvidos.
      vendaOrigem: { select: { id: true, titulo: true, deletadoEm: true, absorvidoPorId: true, pipeline: { select: { chave: true } } } },
      cardProjetos: { select: { id: true, titulo: true, deletadoEm: true, absorvidoPorId: true, pipeline: { select: { chave: true } } } },
      timeline: {
        orderBy: [{ em: "asc" }, { id: "asc" }],
        include: { usuario: { select: { id: true, nome: true } } },
      },
    },
  });
}

export type DetalheCard = NonNullable<Awaited<ReturnType<typeof obterCard>>>;

/** Quem pode ser responsável: usuários ativos que atuam em card (sem VISUALIZADOR). */
export async function listarResponsaveis() {
  return db.usuario.findMany({ where: { ativo: true, ...QUEM_ATUA }, orderBy: { nome: "asc" }, select: { id: true, nome: true } });
}

/** id → nome, inclusive inativos (a Timeline cita quem já saiu). */
export async function nomesDeUsuarios(ids: Iterable<string>): Promise<Map<string, string>> {
  const lista = [...new Set(ids)];
  if (lista.length === 0) return new Map();
  const us = await db.usuario.findMany({ where: { id: { in: lista } }, select: { id: true, nome: true } });
  return new Map(us.map((u) => [u.id, u.nome]));
}

// ---------------------------------------------------------------- escrita

/**
 * Núcleo de "card nasce" (UI, import): grava o projeto, a TransicaoFase
 * de entrada no funil (`de_fase_id` null — base das métricas de tempo por
 * fase) e a Timeline de criação. Pressupõe o lock do pipeline e a fase já
 * validada pelo chamador. `entrada` = fase/instante em que o card entrou no
 * funil (o import pode ter histórico: entrou numa fase, hoje está em outra).
 */
export async function inserirCard(
  tx: Tx,
  args: {
    data: Prisma.ProjetoUncheckedCreateInput;
    entrada: { faseId: string; em: Date };
    porId: string;
    origem: OrigemTransicao;
    timeline: { tipo: TipoTimeline; payload: Prisma.InputJsonValue; em: Date };
  },
): Promise<string> {
  const op = await tx.projeto.create({ data: args.data, select: { id: true } });
  await tx.transicaoFase.create({
    data: { projetoId: op.id, deFaseId: null, paraFaseId: args.entrada.faseId, usuarioId: args.porId, origem: args.origem, em: args.entrada.em },
  });
  await tx.timeline.create({ data: { projetoId: op.id, tipo: args.timeline.tipo, payload: args.timeline.payload, usuarioId: args.porId, em: args.timeline.em } });
  return op.id;
}

/**
 * Núcleo do movimento (Kanban, import): fase/fase_desde, TransicaoFase,
 * Timeline MOVIMENTACAO e os ganchos de terminal (sai antes de entrar).
 * Pressupõe os locks já tomados (`travarPipelines` com os extras do
 * terminal) e `origem`/`destino` relidos depois do lock. `transicao: false`
 * quando o chamador grava a TransicaoFase por outro caminho (histórico do import).
 */
export async function registrarMovimento(
  tx: Tx,
  args: {
    projetoId: string;
    pipelineChave: string;
    origem: Fase;
    destino: Fase;
    porId: string;
    em: Date;
    origemTransicao: OrigemTransicao;
    transicao?: boolean;
    /** Marca extra no payload da MOVIMENTACAO (ex.: `"IMPORT"`). */
    via?: string;
    dadosTerminal?: unknown;
  },
): Promise<void> {
  const { projetoId: id, origem, destino, em } = args;
  // Entradas da Timeline depois da MOVIMENTACAO: `em` estritamente crescente.
  let passo = 0;
  const instante = () => new Date(em.getTime() + ++passo);
  await tx.projeto.update({ where: { id }, data: { faseId: destino.id, faseDesde: em } });
  if (args.transicao !== false) {
    await tx.transicaoFase.create({ data: { projetoId: id, deFaseId: origem.id, paraFaseId: destino.id, usuarioId: args.porId, origem: args.origemTransicao, em } });
  }
  const payload = { deFaseId: origem.id, paraFaseId: destino.id, ...(args.via ? { via: args.via } : {}) };
  await tx.timeline.create({ data: { projetoId: id, tipo: "MOVIMENTACAO", payload, usuarioId: args.porId, em } });
  if (destino.isTerminal) {
    await aoEntrarEmTerminal({
      tx,
      projetoId: id,
      pipelineChave: args.pipelineChave,
      deFaseId: origem.id,
      destino,
      porUsuarioId: args.porId,
      em,
      instante,
      dados: args.dadosTerminal,
    });
  }
}

export async function criarCard(
  dados: { pipelineId: string; faseId: string; titulo: string; /** Já validada (`descricaoSchema`). */ descricao?: string | null },
  por: Ator,
): Promise<Resultado<{ id: string }>> {
  if (soLeitura(por)) return { ok: false, erro: "SEM_PERMISSAO" };
  const titulo = validarTitulo(dados.titulo);
  if (!titulo) return { ok: false, erro: "TITULO_INVALIDO" };
  const { descricao, ...resto } = dados;
  try {
    const id = await db.$transaction(async (tx) => {
      if (!(await travarPipelines(tx, [dados.pipelineId]))) throw new ErroDeRegra("PIPELINE_NAO_ENCONTRADO");
      return criarCardTravado(tx, { ...resto, titulo, responsavelId: por.id, via: "UI", campos: descricao ? { descricao } : undefined }, por);
    });
    return { ok: true, id };
  } catch (e) {
    return traduzir(e);
  }
}

export type NovoCard = {
  pipelineId: string;
  faseId: string;
  titulo: string;
  responsavelId: string;
  via: "UI" | "WHATSAPP";
  /** Campos já interpretados (ingestão do WhatsApp, GAB-34). */
  campos?: Omit<Prisma.ProjetoUncheckedCreateInput, "id" | "pipelineId" | "faseId" | "titulo" | "responsavelId" | "criadoVia" | "faseDesde" | "criadoEm">;
  agora?: Date;
};

/**
 * Corpo de `criarCard` numa transação que JÁ tem o lock do pipeline
 * (`travarPipelines`). Relê a fase depois do lock e recusa terminal
 * (`FASE_TERMINAL`). Lança `ErroDeRegra`. Usado pela ingestão do WhatsApp
 * (GAB-34), que cria Empresa/Contato na mesma transação.
 */
export async function criarCardTravado(tx: Tx, dados: NovoCard, por: Ator): Promise<string> {
  const titulo = validarTitulo(dados.titulo);
  if (!titulo) throw new ErroDeRegra("TITULO_INVALIDO");
  const f = await faseDestino(tx, dados.faseId, dados.pipelineId);
  // Ganho/perdido só por movimento: é ele que passa por `aoEntrarEmTerminal`.
  if (f.isTerminal) throw new ErroDeRegra("FASE_TERMINAL");
  const agora = dados.agora ?? new Date();
  return inserirCard(tx, {
    data: {
      ...dados.campos,
      pipelineId: dados.pipelineId,
      faseId: f.id,
      titulo,
      responsavelId: dados.responsavelId,
      criadoVia: dados.via,
      faseDesde: agora,
      criadoEm: agora,
    },
    entrada: { faseId: f.id, em: agora },
    porId: por.id,
    origem: dados.via,
    timeline: { tipo: "CRIACAO", payload: { faseId: f.id, via: dados.via }, em: agora },
  });
}

/**
 * Move o card para `paraFaseId` (qualquer direção). Mesma fase → no-op.
 * Destino terminal → `aoEntrarEmTerminal` (ganho/perdido, GAB-32; ganho em
 * Vendas leva o card para o Handoff de Projetos, GAB-81). Tudo na mesma
 * transação: erro de regra do gancho (ex.: perdido sem motivo) desfaz o
 * movimento inteiro. Só move dentro do quadro do card.
 */
export async function moverCard(
  id: string,
  paraFaseId: string,
  por: Ator,
  opts: { dadosTerminal?: DadosTerminal } = {},
): Promise<Resultado<{ mudou: boolean; terminal: TipoTerminal | null }>> {
  if (soLeitura(por)) return { ok: false, erro: "SEM_PERMISSAO" };
  try {
    return await moverUmaVez(id, paraFaseId, por, opts);
  } catch (e) {
    return traduzir(e);
  }
}

async function moverUmaVez(
  id: string,
  paraFaseId: string,
  por: Ator,
  opts: { dadosTerminal?: DadosTerminal },
): Promise<Resultado<{ mudou: boolean; terminal: TipoTerminal | null }>> {
  return db.$transaction(async (tx) => {
    const alvo = await tx.projeto.findFirst({
      where: { id, deletadoEm: null },
      select: { pipelineId: true, pipeline: { select: { chave: true } } },
    });
    if (!alvo) throw new ErroDeRegra("CARD_NAO_ENCONTRADO");
    // Antes do lock só para decidir QUAIS quadros travar (pipelineId de fase
    // nunca muda; o do card muda no ganho, sob o lock: reconferido abaixo).
    // O tipo terminal pode mudar: também é reconferido.
    const previa = await tx.fase.findUnique({ where: { id: paraFaseId }, select: { tipoTerminal: true } });
    const extras = await idsDePipelines(tx, pipelinesExtrasDoTerminal(alvo.pipeline.chave, previa?.tipoTerminal ?? null));
    await travarPipelines(tx, [alvo.pipelineId, ...extras]);

    const op = await tx.projeto.findFirst({ where: { id, deletadoEm: null }, select: { faseId: true, pipelineId: true } });
    if (!op) throw new ErroDeRegra("CARD_NAO_ENCONTRADO");
    // Um ganho concorrente levou o card para Projetos entre a leitura e o lock.
    if (op.pipelineId !== alvo.pipelineId) throw new ErroDeRegra("CONFLITO_CONCORRENTE");
    const destino = await faseDestino(tx, paraFaseId, alvo.pipelineId);
    if (destino.id === op.faseId) return { ok: true as const, mudou: false, terminal: null };
    // Gestor mudou o tipo terminal da fase entre a prévia e o lock: o conjunto
    // travado pode não bastar, e travar mais agora quebraria a ordem. Recusa.
    const necessarios = await idsDePipelines(tx, pipelinesExtrasDoTerminal(alvo.pipeline.chave, destino.tipoTerminal));
    if (necessarios.some((p) => !extras.includes(p))) throw new ErroDeRegra("CONFLITO_CONCORRENTE");

    const origem = await tx.fase.findUniqueOrThrow({ where: { id: op.faseId } });

    await registrarMovimento(tx, {
      projetoId: id,
      pipelineChave: alvo.pipeline.chave,
      origem,
      destino,
      porId: por.id,
      em: new Date(),
      origemTransicao: "UI",
      dadosTerminal: opts.dadosTerminal,
    });
    return { ok: true as const, mudou: true, terminal: destino.tipoTerminal };
  });
}

export type PatchCard = Partial<Record<CampoEditavel, ValorCampo>>;

/** Valor como fica no payload da Timeline: JSON simples e comparável. */
function serializar(campo: CampoEditavel, v: unknown): string | boolean | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return campo === "proximaAcaoEm" ? diaEmFuso(v) : v.toISOString();
  if (typeof v === "boolean") return v;
  if (typeof v === "object" && "toFixed" in v && typeof v.toFixed === "function") return (v as { toFixed(n: number): string }).toFixed(2);
  return String(v);
}

/**
 * Edita campos do card. Só os que de fato mudaram são gravados, cada um com
 * uma Timeline `CAMPO_ALTERADO { campo, antes, depois }`, na ordem do patch.
 * Valores já vêm interpretados (`interpretarCampo`); aqui só regras de banco.
 */
export async function editarCard(id: string, patch: PatchCard, por: Ator): Promise<Resultado<{ alterados: CampoEditavel[] }>> {
  if (soLeitura(por)) return { ok: false, erro: "SEM_PERMISSAO" };
  if ("titulo" in patch && (typeof patch.titulo !== "string" || !validarTitulo(patch.titulo))) {
    return { ok: false, erro: "TITULO_INVALIDO" };
  }
  try {
    const alterados = await db.$transaction((tx) => aplicarPatch(tx, id, patch, por));
    return { ok: true, alterados };
  } catch (e) {
    return traduzir(e);
  }
}

/**
 * Corpo de `editarCard` dentro de uma transação já aberta (ex.: "marcar
 * feita" da Minha Semana grava a NOTA e o patch juntos). Lança `ErroDeRegra`;
 * o chamador traduz com `traduzir`. `aPartirDe` = `em` da 1ª Timeline (as
 * seguintes somam 1 ms cada), para ordenar depois de algo já gravado na tx.
 */
export async function aplicarPatch(tx: Tx, id: string, patch: PatchCard, por: Ator, aPartirDe?: number): Promise<CampoEditavel[]> {
  const campos = Object.keys(patch) as CampoEditavel[];
  const travado = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM oportunidade WHERE id = ${id} AND deletado_em IS NULL FOR UPDATE`;
  if (travado.length === 0) throw new ErroDeRegra("CARD_NAO_ENCONTRADO");
  const atual = await tx.projeto.findUniqueOrThrow({ where: { id } });

  const mudancas: { campo: CampoEditavel; antes: string | boolean | null; depois: string | boolean | null }[] = [];
  for (const campo of campos) {
    const antes = serializar(campo, atual[campo]);
    const depois = serializar(campo, patch[campo]);
    if (antes !== depois) mudancas.push({ campo, antes, depois });
  }
  if (mudancas.length === 0) return [];

  const data: Prisma.ProjetoUncheckedUpdateInput = {};
  for (const { campo } of mudancas) {
    const v = patch[campo] ?? null;
    if (campo === "responsavelId") {
      const u = await tx.usuario.findUnique({ where: { id: String(v) }, select: { ativo: true, papel: true } });
      if (!u?.ativo || u.papel === "VISUALIZADOR") throw new ErroDeRegra("RESPONSAVEL_INVALIDO");
      data.responsavelId = String(v);
    } else if (campo === "titulo") {
      data.titulo = validarTitulo(String(v))!;
    } else if (campo === "revisar") {
      data.revisar = v === true;
    } else if (campo === "origem") {
      data.origem = v as Origem | null;
    } else if (campo === "proximaAcaoEm") {
      data.proximaAcaoEm = v as Date | null;
    } else {
      (data as Record<string, unknown>)[campo] = v;
    }
  }
  await tx.projeto.update({ where: { id }, data });

  // `em` estritamente crescente: a Timeline ordena por `em` e as entradas
  // de um mesmo patch precisam manter a ordem.
  const base = aPartirDe ?? Date.now();
  await tx.timeline.createMany({
    data: mudancas.map((m, i) => ({
      projetoId: id,
      tipo: "CAMPO_ALTERADO" as TipoTimeline,
      // Descrição (até 5000): a Timeline guarda só a prévia de antes/depois.
      payload: m.campo === "descricao" ? mudancaDescricao(m.campo, m.antes as string | null, m.depois as string | null) : m,
      usuarioId: por.id,
      em: new Date(base + i),
    })),
  });
  return mudancas.map((m) => m.campo);
}

export const NOTA_MAX = 5000;

export async function adicionarNota(id: string, texto: string, por: Ator): Promise<Resultado> {
  if (soLeitura(por)) return { ok: false, erro: "SEM_PERMISSAO" };
  const t = texto.trim();
  if (t.length === 0 || t.length > NOTA_MAX) return { ok: false, erro: "NOTA_INVALIDA" };
  const op = await db.projeto.findFirst({ where: { id, deletadoEm: null }, select: { id: true } });
  if (!op) return { ok: false, erro: "CARD_NAO_ENCONTRADO" };
  await db.timeline.create({ data: { projetoId: id, tipo: "NOTA", payload: { texto: t }, usuarioId: por.id } });
  return { ok: true };
}

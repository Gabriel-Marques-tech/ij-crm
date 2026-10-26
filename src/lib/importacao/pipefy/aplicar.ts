/**
 * Grava os cards do Pipefy no banco (GAB-37). Idempotente por `pipefy_id`:
 * rodar de novo o mesmo arquivo não cria nada nem duplica TransicaoFase/Timeline.
 *
 * Lotes: `TAMANHO_LOTE` cards por transação. Cada transação começa com
 * `travarPipelines([vendas, projetos])` (ordem por id; nenhum outro lock de
 * pipeline) e relê as fases depois do lock. Lote que falha é refeito card a
 * card (uma transação por card): só o card que de fato falha vai para o
 * relatório de erros, o resto do lote e os lotes já gravados ficam.
 *
 * Card novo: Oportunidade em Vendas com `criado_via=IMPORT`, `fase_desde` =
 * entrada na fase atual (histórico do CSV) ou o instante do import, Timeline
 * `IMPORT`. Histórico no CSV → `TransicaoFase` retroativas (origem IMPORT,
 * uma por fase, na ordem de entrada); sem histórico, só `fase_desde`.
 * Fase terminal → `aoEntrarEmTerminal` (GAB-32) dentro da mesma transação:
 * ganho em Vendas cria o card de projeto pelo mesmo caminho do Kanban (um por
 * venda, `origem_oportunidade_id` único; P2002 de outro escritor → o lote é
 * refeito e o gancho enxerga o projeto como "já existe"). Card do Pipefy numa
 * fase de Projetos = venda ganha + projeto movido para aquela fase.
 *
 * Card existente (mesmo `pipefy_id`): o Pipefy é a fonte até o go-live —
 * campos com valor no CSV sobrescrevem, campo vazio no CSV mantém o do CRM,
 * fase diferente move (Timeline MOVIMENTACAO + TransicaoFase IMPORT, ganchos
 * de terminal), empresa/contato só são preenchidos se o card não tiver. Uma
 * Timeline `IMPORT { acao: "atualizado", mudancas }` só quando algo mudou.
 * Card na lixeira não volta: é pulado.
 *
 * Contato/empresa: só match exato (`encontrarContatoPorIdentificador`,
 * `encontrarEmpresa` — e só `via: "cnpj"` vincula). Telefone/email de contato
 * na lixeira (BLOQUEADO_EXCLUIDO) → card pulado com "contato excluído na
 * lixeira". Empresa sem CNPJ: uma empresa NOVA por nome dentro deste import
 * (nunca casa com empresa já existente pelo nome).
 */
import type { Fase, Origem, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { travarPipelines } from "@/lib/fases/fases";
import { encontrarContatoPorIdentificador, encontrarEmpresa } from "@/lib/contatos/match";
import { ehDominioPublico, formatarCnpj, normalizarDominio } from "@/lib/normalizacao";
import { registrarErro } from "@/lib/erros/registrar";
import { ErroDeRegra } from "@/lib/oportunidades/erros";
import { aoEntrarEmTerminal, aoSairDeTerminal, ehConflitoDeProjetoDaVenda } from "@/lib/oportunidades/terminal";
import {
  DETALHE_PERDA_MAX,
  FASE_INICIAL_PROJETOS,
  PIPELINE_PROJETOS,
  PIPELINE_VENDAS,
  motivoDeTexto,
  valorParaCampo,
  type DadosTerminal,
} from "@/lib/oportunidades/terminal-regras";
import type { CardPipefy, HistoricoFase, Ocorrencia } from "./interpretar";
import { resolverResponsavel, type Mapeamento, type UsuarioCrm } from "./mapeamento";
import { normalizarTexto } from "./valores";

type Tx = Prisma.TransactionClient;

export const TAMANHO_LOTE = 25;
/** Lote grande segura o lock de Vendas/Projetos: o Kanban espera até o fim do lote. */
const OPCOES_TX = { timeout: 120_000, maxWait: 20_000 } as const;

export type Relatorio = {
  /** Cards distintos no arquivo (depois de tirar as linhas repetidas). */
  total: number;
  criados: number;
  /** Cards que já existiam (mesmo pipefy_id) e foram reprocessados, com ou sem mudança. */
  atualizados: number;
  /** Dos atualizados, quantos não tinham nada a mudar. */
  semMudanca: number;
  /** Linhas/cards não gravados (erro de linha do CSV ou do card). */
  pulados: number;
  duplicadas: number;
  projetosCriados: number;
  erros: Ocorrencia[];
  avisos: Ocorrencia[];
};

type Desfecho =
  | { tipo: "criado" | "atualizado" | "semMudanca"; projetoCriado: boolean; avisos: string[] }
  | { tipo: "pulado"; motivo: string };

type Ctx = {
  tx: Tx;
  admin: { id: string };
  agora: Date;
  vendasId: string;
  projetosId: string;
  fases: Map<string, Fase>;
  mapeamento: Mapeamento;
  nomesFase: Map<string, string>;
  usuarios: UsuarioCrm[];
  /** Empresas criadas por nome NESTE import (nome normalizado → id). */
  empresasPorNome: Map<string, string>;
};

type Passo = { h: HistoricoFase; fase: Fase };

function pulado(motivo: string): Desfecho {
  return { tipo: "pulado", motivo };
}

function faseDoMapa(ctx: Ctx, chave: string): Fase | null {
  const id = ctx.mapeamento[chave];
  return id ? (ctx.fases.get(id) ?? null) : null;
}

/** Ganho de Vendas para onde vai a venda de um card que o Pipefy já pôs em Projetos. */
function faseGanhoVendas(ctx: Ctx): Fase | null {
  const ganhos = [...ctx.fases.values()]
    .filter((f) => f.pipelineId === ctx.vendasId && f.tipoTerminal === "GANHO" && !f.arquivadaEm)
    .sort((a, b) => a.ordem - b.ordem);
  return ganhos.find((f) => f.chave === "contrato_assinado") ?? ganhos[0] ?? null;
}

const entradaDe = (passos: Passo[], faseId: string): Date | null => {
  const p = passos.find((x) => x.fase.id === faseId);
  return p ? (p.h.ultimaEntrada ?? p.h.entrada) : null;
};

/**
 * Cadeia de transições retroativas: uma por fase com data de entrada, na
 * ordem. `inicial` = fase de onde a cadeia parte (projeto nasce em
 * em_execucao pelo gancho); a própria inicial não gera transição.
 */
function cadeia(passos: Passo[], inicial: string | null): { de: string | null; para: string; em: Date }[] {
  const comData = passos
    .map((p) => ({ fase: p.fase, em: p.h.entrada ?? p.h.ultimaEntrada }))
    .filter((p): p is { fase: Fase; em: Date } => p.em !== null && p.fase.id !== inicial)
    .sort((a, b) => a.em.getTime() - b.em.getTime());
  let de = inicial;
  return comData.map((p) => {
    const t = { de, para: p.fase.id, em: p.em };
    de = p.fase.id;
    return t;
  });
}

/** Grava as transições esperadas que ainda não existem (chave: fase destino + instante). */
async function sincronizarTransicoes(ctx: Ctx, oportunidadeId: string, esperadas: ReturnType<typeof cadeia>): Promise<number> {
  if (esperadas.length === 0) return 0;
  const existentes = await ctx.tx.transicaoFase.findMany({ where: { oportunidadeId, origem: "IMPORT" }, select: { paraFaseId: true, em: true } });
  const ja = new Set(existentes.map((e) => `${e.paraFaseId}@${e.em.getTime()}`));
  const novas = esperadas.filter((t) => !ja.has(`${t.para}@${t.em.getTime()}`));
  if (novas.length === 0) return 0;
  await ctx.tx.transicaoFase.createMany({
    data: novas.map((t) => ({ oportunidadeId, deFaseId: t.de, paraFaseId: t.para, usuarioId: ctx.admin.id, origem: "IMPORT" as const, em: t.em })),
  });
  return novas.length;
}

function dadosTerminal(destino: Fase, card: CardPipefy): DadosTerminal {
  if (destino.tipoTerminal === "PERDIDO") {
    const texto = card.motivoPerda?.trim();
    if (!texto) return { motivo: "outro", detalhe: "Importado do Pipefy sem motivo." };
    const m = motivoDeTexto(texto);
    const detalhe = (m.motivo === "outro" ? m.detalhe || texto : m.detalhe).slice(0, DETALHE_PERDA_MAX);
    return { motivo: m.motivo || "outro", detalhe };
  }
  return card.valorFechado ? { valorFechado: valorParaCampo(card.valorFechado) } : {};
}

async function entrarTerminal(ctx: Ctx, oportunidadeId: string, pipelineChave: string, deFaseId: string, destino: Fase, em: Date, card: CardPipefy) {
  let passo = 0;
  await aoEntrarEmTerminal({
    tx: ctx.tx,
    oportunidadeId,
    pipelineChave,
    deFaseId,
    destino,
    porUsuarioId: ctx.admin.id,
    em,
    instante: () => new Date(em.getTime() + ++passo),
    dados: dadosTerminal(destino, card),
  });
}

/** Movimento feito pelo import: mesmos efeitos do `moverCard`, com a data do Pipefy e origem IMPORT. */
async function moverImportado(ctx: Ctx, oportunidadeId: string, pipelineChave: string, deFaseId: string, destino: Fase, em: Date, passos: Passo[], card: CardPipefy) {
  const { tx } = ctx;
  const origem = ctx.fases.get(deFaseId) ?? (await tx.fase.findUniqueOrThrow({ where: { id: deFaseId } }));
  await tx.oportunidade.update({ where: { id: oportunidadeId }, data: { faseId: destino.id, faseDesde: em } });
  // Com histórico da fase destino, a transição vem da cadeia (`sincronizarTransicoes`).
  if (!passos.some((p) => p.fase.id === destino.id && (p.h.entrada ?? p.h.ultimaEntrada))) {
    await tx.transicaoFase.create({ data: { oportunidadeId, deFaseId, paraFaseId: destino.id, usuarioId: ctx.admin.id, origem: "IMPORT", em } });
  }
  await tx.timeline.create({
    data: { oportunidadeId, tipo: "MOVIMENTACAO", payload: { deFaseId, paraFaseId: destino.id, via: "IMPORT" }, usuarioId: ctx.admin.id, em },
  });
  if (origem.isTerminal) {
    let passo = 0;
    await aoSairDeTerminal({ tx, oportunidadeId, pipelineChave, origem, destino, porUsuarioId: ctx.admin.id, em, instante: () => new Date(em.getTime() + ++passo) });
  }
  if (destino.isTerminal) await entrarTerminal(ctx, oportunidadeId, pipelineChave, deFaseId, destino, em, card);
}

/** Leva o projeto da venda para a fase de Projetos em que o Pipefy está. true = mudou algo. */
async function posicionarProjeto(ctx: Ctx, vendaId: string, destino: Fase, passos: Passo[], card: CardPipefy, avisos: string[]): Promise<boolean> {
  const proj = await ctx.tx.oportunidade.findUnique({ where: { origemOportunidadeId: vendaId }, select: { id: true, faseId: true, faseDesde: true, deletadoEm: true } });
  if (!proj) {
    avisos.push("Venda sem card de projeto: a fase de Projetos do Pipefy não foi aplicada.");
    return false;
  }
  if (proj.deletadoEm) {
    avisos.push("O card de projeto desta venda está na lixeira: não foi movido.");
    return false;
  }
  let mudou = false;
  const desdeHist = entradaDe(passos, destino.id);
  if (proj.faseId !== destino.id) {
    await moverImportado(ctx, proj.id, PIPELINE_PROJETOS, proj.faseId, destino, desdeHist ?? ctx.agora, passos, card);
    mudou = true;
  } else if (desdeHist && proj.faseDesde.getTime() !== desdeHist.getTime()) {
    await ctx.tx.oportunidade.update({ where: { id: proj.id }, data: { faseDesde: desdeHist } });
    mudou = true;
  }
  const inicial = [...ctx.fases.values()].find((f) => f.pipelineId === ctx.projetosId && f.chave === FASE_INICIAL_PROJETOS)?.id ?? null;
  const n = await sincronizarTransicoes(ctx, proj.id, cadeia(passos, inicial));
  return mudou || n > 0;
}

async function empresaViva(tx: Tx, id: string | null): Promise<boolean> {
  return !!id && (await tx.empresa.count({ where: { id, deletadoEm: null, mergedIntoId: null } })) > 0;
}

function dominioDoCard(card: CardPipefy): string | null {
  for (const p of card.pontos) {
    if (p.tipo !== "EMAIL") continue;
    const d = normalizarDominio(p.valorNormalizado);
    if (d && !ehDominioPublico(d)) return d;
  }
  return null;
}

/** Empresa do card. Só CNPJ casa com empresa existente; nome cria (uma por nome neste import). */
async function resolverEmpresa(ctx: Ctx, card: CardPipefy, avisos: string[]): Promise<{ id: string | null; revisar: boolean }> {
  const { tx } = ctx;
  if (card.cnpj) {
    const m = await encontrarEmpresa(card.cnpj, tx);
    if (m?.via === "cnpj") return { id: m.empresa.id, revisar: false };
    if (await tx.empresa.findUnique({ where: { cnpj: card.cnpj }, select: { id: true } })) {
      avisos.push(`CNPJ ${formatarCnpj(card.cnpj)} é de uma empresa excluída/mesclada: card ficou sem empresa.`);
      return { id: null, revisar: true };
    }
    const e = await tx.empresa.create({ data: { nome: card.empresa ?? formatarCnpj(card.cnpj), cnpj: card.cnpj, dominioEmail: dominioDoCard(card) }, select: { id: true } });
    return { id: e.id, revisar: false };
  }
  if (!card.empresa) return { id: null, revisar: false };
  const chave = normalizarTexto(card.empresa);
  const ja = ctx.empresasPorNome.get(chave);
  if (ja) return { id: ja, revisar: false };
  const e = await tx.empresa.create({ data: { nome: card.empresa, dominioEmail: dominioDoCard(card) }, select: { id: true } });
  ctx.empresasPorNome.set(chave, e.id);
  return { id: e.id, revisar: false };
}

type MatchContatos = { achados: { id: string; empresaId: string | null }[]; livres: CardPipefy["pontos"] } | { bloqueado: string };

/** Só leitura: quem já tem os telefones/emails do card. Roda antes de qualquer escrita do card. */
async function procurarContatos(tx: Tx, card: CardPipefy): Promise<MatchContatos> {
  const achados: { id: string; empresaId: string | null }[] = [];
  const livres: CardPipefy["pontos"] = [];
  for (const p of card.pontos) {
    const m = await encontrarContatoPorIdentificador(p.valorNormalizado, tx);
    if (m.tipo === "BLOQUEADO_EXCLUIDO") return { bloqueado: p.valorOriginal };
    if (m.tipo === "ENCONTRADO") {
      if (!achados.some((a) => a.id === m.contato.id)) achados.push({ id: m.contato.id, empresaId: m.contato.empresaId });
    } else livres.push(p);
  }
  return { achados, livres };
}

async function resolverContato(ctx: Ctx, card: CardPipefy, match: Exclude<MatchContatos, { bloqueado: string }>, empresaId: string | null, avisos: string[]): Promise<{ id: string | null; revisar: boolean }> {
  const { tx } = ctx;
  const livres = [...match.livres].sort((a, b) => (a.tipo + a.valorNormalizado < b.tipo + b.valorNormalizado ? -1 : 1));
  if (match.achados.length > 0) {
    const c = match.achados[0];
    for (const p of livres) await tx.contatoPonto.create({ data: { contatoId: c.id, tipo: p.tipo, valorNormalizado: p.valorNormalizado, valorOriginal: p.valorOriginal } });
    if (match.achados.length > 1) {
      avisos.push("Telefone/email do card são de contatos diferentes no CRM: vinculado ao primeiro, confira.");
      return { id: c.id, revisar: true };
    }
    return { id: c.id, revisar: false };
  }
  if (!card.contatoNome && livres.length === 0) return { id: null, revisar: false };
  const c = await tx.contato.create({
    data: {
      nome: card.contatoNome ?? livres[0].valorOriginal,
      empresaId,
      cargo: card.cargo,
      pontos: { create: livres.map((p) => ({ tipo: p.tipo, valorNormalizado: p.valorNormalizado, valorOriginal: p.valorOriginal })) },
    },
    select: { id: true },
  });
  return { id: c.id, revisar: false };
}

async function aplicarCard(ctx: Ctx, card: CardPipefy): Promise<Desfecho> {
  const { tx } = ctx;
  const nomeFase = ctx.nomesFase.get(card.faseAtual) ?? card.faseAtual;
  const destino = faseDoMapa(ctx, card.faseAtual);
  if (!destino) return pulado(`Fase "${nomeFase}" sem correspondência no CRM (mapeie na prévia).`);
  if (destino.arquivadaEm) return pulado(`A fase do CRM para "${nomeFase}" está arquivada.`);
  const emProjetos = destino.pipelineId === ctx.projetosId;
  const faseVenda = emProjetos ? faseGanhoVendas(ctx) : destino;
  if (!faseVenda) return pulado("Vendas não tem fase de ganho ativa para a venda deste projeto.");

  const passos: Passo[] = card.historico
    .map((h) => ({ h, fase: faseDoMapa(ctx, h.chave) }))
    .filter((p): p is Passo => !!p.fase && !p.fase.arquivadaEm);
  const passosVenda = passos.filter((p) => p.fase.pipelineId === ctx.vendasId);
  const passosProj = passos.filter((p) => p.fase.pipelineId === ctx.projetosId);
  const primeiraProj = cadeia(passosProj, null)[0]?.em ?? null;
  const desdeHist = entradaDe(passosVenda, faseVenda.id) ?? (emProjetos ? primeiraProj : null);
  const desdeVenda = desdeHist ?? ctx.agora;

  const existente = await tx.oportunidade.findUnique({ where: { pipefyId: card.pipefyId } });
  if (existente?.deletadoEm) return pulado("Card excluído no CRM (está na lixeira): não é reimportado.");
  if (existente && existente.pipelineId !== ctx.vendasId) return pulado("Este ID do Pipefy pertence a um card fora de Vendas.");

  // Leituras que podem pular o card vêm ANTES de qualquer escrita dele.
  const precisaContato = !existente?.contatoId && card.pontos.length + (card.contatoNome ? 1 : 0) > 0;
  const match = precisaContato ? await procurarContatos(tx, card) : { achados: [], livres: [] };
  if ("bloqueado" in match) return pulado(`Contato excluído na lixeira (${match.bloqueado}). Restaure ou mescle o contato e importe de novo.`);

  const avisos: string[] = [];
  const responsavel = resolverResponsavel(card.responsavel, ctx.usuarios);
  let revisar = false;
  let empresaId = existente?.empresaId ?? null;
  if (!empresaId) {
    const e = await resolverEmpresa(ctx, card, avisos);
    empresaId = e.id;
    revisar ||= e.revisar;
  }
  let contatoId = existente?.contatoId ?? null;
  if (!contatoId && precisaContato) {
    const c = await resolverContato(ctx, card, match, empresaId, avisos);
    contatoId = c.id;
    revisar ||= c.revisar;
    // Card sem empresa no CSV herda a empresa (viva) do contato achado.
    const doContato = match.achados[0]?.empresaId ?? null;
    if (!empresaId && doContato && (await empresaViva(tx, doContato))) empresaId = doContato;
  }

  const contarProjetos = async (id: string) => tx.oportunidade.count({ where: { origemOportunidadeId: id } });

  if (!existente) {
    if (!responsavel) avisos.push(card.responsavel ? `Responsável "${card.responsavel}" sem usuário no CRM: ficou com quem importou.` : "Sem responsável no Pipefy: ficou com quem importou.");
    const criadoEm = card.criadoEm ?? cadeia(passos, null)[0]?.em ?? ctx.agora;
    const op = await tx.oportunidade.create({
      data: {
        pipelineId: ctx.vendasId,
        faseId: faseVenda.id,
        titulo: card.titulo,
        empresaId,
        contatoId,
        responsavelId: responsavel?.id ?? ctx.admin.id,
        revisar: revisar || !responsavel,
        origem: card.origem,
        dor: card.dor,
        orcamentoPrevisto: card.orcamento,
        propostaUrl: card.propostaUrl,
        cidade: card.cidade,
        estado: card.estado,
        faseDesde: desdeVenda,
        criadoVia: "IMPORT",
        pipefyId: card.pipefyId,
        criadoEm,
      },
      select: { id: true },
    });
    await tx.timeline.create({
      data: {
        oportunidadeId: op.id,
        tipo: "IMPORT",
        payload: { acao: "criado", pipefyId: card.pipefyId, linha: card.linha, faseId: faseVenda.id, fasePipefy: nomeFase, responsavelPipefy: card.responsavel, avisos },
        usuarioId: ctx.admin.id,
        em: criadoEm,
      },
    });
    await sincronizarTransicoes(ctx, op.id, cadeia(passosVenda, null));
    let projetoCriado = false;
    if (faseVenda.isTerminal) {
      const antes = await contarProjetos(op.id);
      const anterior = cadeia(passosVenda, null).filter((t) => t.para !== faseVenda.id).at(-1)?.para ?? faseVenda.id;
      await entrarTerminal(ctx, op.id, PIPELINE_VENDAS, anterior, faseVenda, desdeVenda, card);
      projetoCriado = (await contarProjetos(op.id)) > antes;
    }
    if (emProjetos) await posicionarProjeto(ctx, op.id, destino, passosProj, card, avisos);
    return { tipo: "criado", projetoCriado, avisos };
  }

  // ---------------------------------------------------------------- atualização
  type Mudanca = { campo: string; antes: string | null; depois: string | null };
  const mudancas: Mudanca[] = [];
  const data: Prisma.OportunidadeUncheckedUpdateInput = {};
  const comparar = (campo: keyof typeof data & string, atual: string | null, novo: string | null) => {
    if (novo === null || novo === atual) return;
    mudancas.push({ campo, antes: atual, depois: novo });
    (data as Record<string, unknown>)[campo] = novo;
  };
  comparar("titulo", existente.titulo, card.titulo);
  comparar("origem", existente.origem, card.origem as Origem | null);
  comparar("dor", existente.dor, card.dor);
  comparar("orcamentoPrevisto", existente.orcamentoPrevisto?.toFixed(2) ?? null, card.orcamento);
  comparar("propostaUrl", existente.propostaUrl, card.propostaUrl);
  comparar("cidade", existente.cidade, card.cidade);
  comparar("estado", existente.estado, card.estado);
  if (responsavel) comparar("responsavelId", existente.responsavelId, responsavel.id);
  comparar("empresaId", existente.empresaId, empresaId);
  comparar("contatoId", existente.contatoId, contatoId);
  if (revisar && !existente.revisar) data.revisar = true;
  if (Object.keys(data).length > 0) await tx.oportunidade.update({ where: { id: existente.id }, data });

  let projetoCriado = false;
  if (faseVenda.id !== existente.faseId) {
    const antes = await contarProjetos(existente.id);
    await moverImportado(ctx, existente.id, PIPELINE_VENDAS, existente.faseId, faseVenda, desdeVenda, passosVenda, card);
    projetoCriado = (await contarProjetos(existente.id)) > antes;
    mudancas.push({ campo: "fase", antes: existente.faseId, depois: faseVenda.id });
  } else if (desdeHist && existente.faseDesde.getTime() !== desdeHist.getTime()) {
    await tx.oportunidade.update({ where: { id: existente.id }, data: { faseDesde: desdeHist } });
    mudancas.push({ campo: "faseDesde", antes: existente.faseDesde.toISOString(), depois: desdeHist.toISOString() });
  }
  const novas = await sincronizarTransicoes(ctx, existente.id, cadeia(passosVenda, null));
  if (novas > 0) mudancas.push({ campo: "historico", antes: null, depois: `${novas} transições` });
  if (emProjetos && (await posicionarProjeto(ctx, existente.id, destino, passosProj, card, avisos))) {
    mudancas.push({ campo: "projeto", antes: null, depois: destino.id });
  }
  if (mudancas.length === 0) return { tipo: "semMudanca", projetoCriado: false, avisos };
  await tx.timeline.create({
    data: { oportunidadeId: existente.id, tipo: "IMPORT", payload: { acao: "atualizado", pipefyId: card.pipefyId, linha: card.linha, mudancas }, usuarioId: ctx.admin.id, em: ctx.agora },
  });
  return { tipo: "atualizado", projetoCriado, avisos };
}

const MENSAGEM_REGRA: Partial<Record<string, string>> = {
  FASE_INICIAL_PROJETOS_INDISPONIVEL: `Projetos não tem a fase "${FASE_INICIAL_PROJETOS}" ativa: o projeto da venda ganha não pôde ser criado.`,
  MOTIVO_PERDA_INVALIDO: "Motivo da perda inválido.",
  VALOR_FECHADO_INVALIDO: "Valor fechado inválido.",
};

function mensagemDeFalha(e: unknown): string {
  if (e instanceof ErroDeRegra) return MENSAGEM_REGRA[e.erro] ?? `Regra do CRM recusou o card (${e.erro}).`;
  return `Erro inesperado ao gravar o card (ref: ${registrarErro("import.pipefy.card", e)}).`;
}

export class ErroImport extends Error {}

/**
 * Aplica os cards. `cards` já vem deduplicado (`interpretarCsv`). Não lança
 * por card: falhas vão para `erros`. Lança `ErroImport` só se faltar quadro.
 */
export async function aplicarCards(
  cards: CardPipefy[],
  opts: { mapeamento: Mapeamento; nomesFase: Map<string, string>; admin: { id: string }; agora?: Date; tamanhoLote?: number },
): Promise<Omit<Relatorio, "duplicadas" | "total"> & { total: number }> {
  const agora = opts.agora ?? new Date();
  const pipelines = await db.pipeline.findMany({ where: { chave: { in: [PIPELINE_VENDAS, PIPELINE_PROJETOS] } }, select: { id: true, chave: true } });
  const vendasId = pipelines.find((p) => p.chave === PIPELINE_VENDAS)?.id;
  const projetosId = pipelines.find((p) => p.chave === PIPELINE_PROJETOS)?.id;
  if (!vendasId || !projetosId) throw new ErroImport("Quadros Vendas/Projetos não encontrados. Rode o seed.");
  const usuarios = await db.usuario.findMany({ where: { ativo: true }, select: { id: true, nome: true, email: true } });
  const empresasPorNome = new Map<string, string>();

  const rel = { total: cards.length, criados: 0, atualizados: 0, semMudanca: 0, pulados: 0, projetosCriados: 0, erros: [] as Ocorrencia[], avisos: [] as Ocorrencia[] };

  async function executarLote(lote: CardPipefy[]): Promise<Desfecho[]> {
    const local = new Map(empresasPorNome);
    const r = await db.$transaction(async (tx) => {
      await travarPipelines(tx, [vendasId!, projetosId!]);
      const fases = await tx.fase.findMany({ where: { pipelineId: { in: [vendasId!, projetosId!] } } });
      const ctx: Ctx = {
        tx,
        admin: opts.admin,
        agora,
        vendasId: vendasId!,
        projetosId: projetosId!,
        fases: new Map(fases.map((f) => [f.id, f])),
        mapeamento: opts.mapeamento,
        nomesFase: opts.nomesFase,
        usuarios,
        empresasPorNome: local,
      };
      const out: Desfecho[] = [];
      for (const c of lote) out.push(await aplicarCard(ctx, c));
      return out;
    }, OPCOES_TX);
    // Só depois do commit: empresa criada num lote desfeito não existe.
    for (const [k, v] of local) empresasPorNome.set(k, v);
    return r;
  }

  /** P2002 no projeto da venda (outro escritor sem o lock): refaz uma vez, o gancho vê "já existe". */
  async function comRetentativa(lote: CardPipefy[]): Promise<Desfecho[]> {
    try {
      return await executarLote(lote);
    } catch (e) {
      if (!ehConflitoDeProjetoDaVenda(e)) throw e;
      return executarLote(lote);
    }
  }

  const contar = (card: CardPipefy, d: Desfecho) => {
    if (d.tipo === "pulado") {
      rel.pulados++;
      rel.erros.push({ linha: card.linha, pipefyId: card.pipefyId, mensagem: d.motivo });
      return;
    }
    if (d.tipo === "criado") rel.criados++;
    else rel.atualizados++;
    if (d.tipo === "semMudanca") rel.semMudanca++;
    if (d.projetoCriado) rel.projetosCriados++;
    for (const a of d.avisos) rel.avisos.push({ linha: card.linha, pipefyId: card.pipefyId, mensagem: a });
  };

  const tamanho = opts.tamanhoLote ?? TAMANHO_LOTE;
  for (let i = 0; i < cards.length; i += tamanho) {
    const lote = cards.slice(i, i + tamanho);
    try {
      const ds = await comRetentativa(lote);
      lote.forEach((c, j) => contar(c, ds[j]));
    } catch {
      // O lote voltou inteiro: refaz card a card para isolar quem falha.
      for (const c of lote) {
        try {
          contar(c, (await comRetentativa([c]))[0]);
        } catch (e) {
          contar(c, pulado(mensagemDeFalha(e)));
        }
      }
    }
  }
  return rel;
}

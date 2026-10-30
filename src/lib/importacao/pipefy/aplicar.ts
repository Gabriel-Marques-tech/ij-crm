/**
 * Grava os cards do Pipefy no banco (GAB-37). Idempotente por `pipefy_id`:
 * rodar de novo o mesmo arquivo não cria nada nem duplica TransicaoFase/Timeline.
 *
 * Lotes: `TAMANHO_LOTE` cards por transação. Cada transação primeiro
 * PRÉ-CARREGA o que o lote precisa (cards existentes, donos dos
 * telefones/emails, empresas por CNPJ, edições do CRM) em poucas consultas e
 * só então toma `travarPipelines([vendas, projetos])` (ordem por id; nenhum
 * outro lock de pipeline) e relê as fases: o lock fica pouco tempo. Lote que
 * falha é refeito card a card; só o card que de fato falha vai para o
 * relatório. Falha inesperada fora disso interrompe o import e devolve o
 * relatório parcial (`interrompido`, com a ref do log).
 *
 * Card novo: pelo núcleo do `criarCard` (`inserirCard`): Projeto em
 * Vendas com `criado_via=IMPORT`, TransicaoFase de entrada (`de_fase_id`
 * null, `em` = criação, origem IMPORT) e Timeline `IMPORT`. Histórico no CSV
 * → transições retroativas (uma por fase, na ordem de entrada); sem
 * histórico, só a entrada e `fase_desde`. Movimentos e fases terminais pelo
 * núcleo do `moverCard` (`registrarMovimento` → ganchos do GAB-32): ganho em
 * Vendas leva o MESMO card para o Handoff de Projetos, como no Kanban (ciclo
 * único, GAB-81). Card do Pipefy numa fase de Projetos = ganho em Vendas e o
 * card segue de Handoff até a fase de lá (histórico do Pipefy, se houver).
 *
 * PERDIDO sem motivo: nunca inventa. O card é pulado ("PERDIDO sem motivo no
 * export."), salvo se o gestor escolheu na prévia um motivo padrão.
 *
 * Card existente (mesmo `pipefy_id`): o Pipefy é a fonte até o go-live —
 * campos com valor no CSV sobrescrevem, campo vazio mantém o do CRM —
 * MAS: se o card foi mexido no CRM (Timeline/TransicaoFase que não são do
 * import) depois do último import e depois do "Atualizado em" do CSV, ele não
 * é tocado e vai para o relatório; card em fase terminal nunca sai dela; card
 * que já seguiu para Projetos no CRM nunca volta para Vendas.
 * Transições IMPORT que divergem do histórico do arquivo são trocadas; as de
 * outra origem nunca. Card na lixeira não volta.
 *
 * Contato/empresa: só match exato. Telefone/email de contato na lixeira →
 * card pulado. Contato achado traz a empresa dele (cadeia de identidade
 * exata); nome de empresa diferente no CSV → `revisar` + aviso. Empresa por
 * CNPJ casa; sem CNPJ, uma empresa NOVA por nome neste import (nunca casa por
 * nome com empresa existente — mas se houver homônima viva, `revisar` + aviso
 * com a sugestão). P2002 de outro escritor (ponto/CNPJ gravado entre a
 * pré-carga e o INSERT) → o card volta ao SAVEPOINT, refaz o match e vincula
 * ao registro que já existe.
 */
import type { Fase, Projeto, Origem, Prisma } from "@prisma/client";
import { QUEM_ATUA } from "@/lib/auth/papeis";
import { db } from "@/lib/db";
import { travarPipelines } from "@/lib/fases/fases";
import { resolverContatos, resolverEmpresas } from "@/lib/contatos/match";
import { ehDominioPublico, formatarCnpj, normalizarDominio } from "@/lib/normalizacao";
import { registrarErro } from "@/lib/erros/registrar";
import { mudancaDescricao } from "@/lib/projetos/descricao";
import { ErroDeRegra } from "@/lib/projetos/erros";
import { inserirCard, registrarMovimento } from "@/lib/projetos/projetos";
import { aoEntrarEmTerminal } from "@/lib/projetos/terminal";
import {
  DETALHE_PERDA_MAX,
  PIPELINE_PROJETOS,
  PIPELINE_VENDAS,
  motivoDeTexto,
  valorParaCampo,
  type DadosTerminal,
} from "@/lib/projetos/terminal-regras";
import type { CardPipefy, HistoricoFase, Ocorrencia } from "./interpretar";
import { emLotes } from "./lotes";
import { resolverResponsavel, type Mapeamento, type UsuarioCrm } from "./mapeamento";
import { detalhePerdaPadrao, type OpcoesImport } from "./opcoes";
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
  /** Cards que seguiram para o quadro Projetos neste import (ganho → Handoff). Nome da v1 mantido. */
  projetosCriados: number;
  erros: Ocorrencia[];
  avisos: Ocorrencia[];
  /** Falha inesperada no meio: o que está acima foi gravado; `naoProcessados` cards nem foram tentados. */
  interrompido?: { ref: string; naoProcessados: number };
};

/** Pontos de injeção para os testes de concorrência/falha. Não usar fora de teste. */
export type GanchosTeste = {
  /** Roda (em outra conexão) entre a pré-carga do lote e as escritas. */
  depoisDaPreCarga?: () => Promise<void>;
  antesDoLote?: (indice: number) => Promise<void>;
};

type Desfecho =
  | { tipo: "criado" | "atualizado" | "semMudanca"; projetoCriado: boolean; avisos: string[] }
  | { tipo: "pulado"; motivo: string };

type EmpresaRef = { id: string; nome: string };
type Dono = { contatoId: string; deletado: boolean; empresa: EmpresaRef | null };

/** O que o lote lê antes do lock (e mantém atualizado com o que ele mesmo grava). */
type PreCarga = {
  existentes: Map<string, Projeto>;
  /** `TIPO:valor` → dono resolvido (merge seguido). Ausente = livre. */
  donos: Map<string, Dono>;
  /** CNPJ → empresa resolvida (viva ou não). */
  cnpjs: Map<string, EmpresaRef & { viva: boolean }>;
  /** Projeto → instante da última mudança feita fora do import, se for depois do último import. */
  editadoEm: Map<string, Date>;
};

type Ctx = {
  tx: Tx;
  admin: { id: string; nome: string };
  agora: Date;
  vendasId: string;
  projetosId: string;
  fases: Map<string, Fase>;
  mapeamento: Mapeamento;
  nomesFase: Map<string, string>;
  usuarios: UsuarioCrm[];
  opcoes: OpcoesImport;
  pre: PreCarga;
  /** Empresas criadas por nome NESTE import (nome normalizado → empresa + aviso de homônima). */
  empresasPorNome: Map<string, { empresa: EmpresaRef; aviso: string | null }>;
  /** Empresas vivas que já existiam, por nome normalizado (só para sugerir; nunca vincula). */
  homonimas: Map<string, EmpresaRef[]>;
};

type Passo = { h: HistoricoFase; fase: Fase };
type Transicao = { de: string | null; para: string; em: Date };

const chavePonto = (tipo: string, valor: string) => `${tipo}:${valor}`;

/**
 * GAB-81: `pipefy_id` que ficou na casca de um card de projetos unido pela migração
 * do ciclo único (a venda já tinha outro `pipefy_id`). Não reimporta, e não confunde
 * com lixeira: o histórico desse card está no Projeto que o absorveu.
 */
export function mensagemCardAbsorvido(absorvidoPorId: string): string {
  return `Este ID do Pipefy é de um card de projetos unido ao Projeto ${absorvidoPorId} no ciclo único: não é reimportado (o histórico está nesse Projeto).`;
}

function pulado(motivo: string): Desfecho {
  return { tipo: "pulado", motivo };
}

function faseDoMapa(ctx: Ctx, chave: string): Fase | null {
  const id = ctx.mapeamento[chave];
  return id ? (ctx.fases.get(id) ?? null) : null;
}

/** Ganho de Vendas por onde passa um card que o Pipefy já pôs em Projetos: o marco Ganho. */
function faseGanhoVendas(ctx: Ctx): Fase | null {
  const ganhos = [...ctx.fases.values()]
    .filter((f) => f.pipelineId === ctx.vendasId && f.tipoTerminal === "GANHO" && !f.arquivadaEm)
    .sort((a, b) => a.ordem - b.ordem);
  return ganhos.find((f) => f.marco === "GANHO") ?? ganhos.find((f) => f.chave === "contrato_assinado") ?? ganhos[0] ?? null;
}

const entradaDe = (passos: Passo[], faseId: string): Date | null => {
  const p = passos.find((x) => x.fase.id === faseId);
  return p ? (p.h.ultimaEntrada ?? p.h.entrada) : null;
};

/**
 * Cadeia de transições retroativas: uma por fase com data de entrada, na
 * ordem. `inicial` = fase de onde a cadeia parte (entrada no funil, ou o
 * Handoff, por onde o card entra em Projetos); a própria inicial não gera transição.
 */
function cadeia(passos: Passo[], inicial: string | null): Transicao[] {
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

/**
 * Deixa as TransicaoFase de origem IMPORT do card iguais ao arquivo:
 * apaga as IMPORT que divergem (mesma fase destino com outro instante, ou
 * outra entrada no funil) e grava as que faltam. Transições de outra origem
 * (Kanban, WhatsApp, sistema) nunca são tocadas. Devolve quantas mudaram.
 */
async function sincronizarTransicoes(ctx: Ctx, projetoId: string, esperadas: Transicao[]): Promise<number> {
  if (esperadas.length === 0) return 0;
  const chave = (para: string, em: Date) => `${para}@${em.getTime()}`;
  const alvo = new Set(esperadas.map((t) => chave(t.para, t.em)));
  const paras = new Set(esperadas.map((t) => t.para));
  const temEntrada = esperadas.some((t) => t.de === null);
  const existentes = await ctx.tx.transicaoFase.findMany({ where: { projetoId, origem: "IMPORT" }, select: { id: true, deFaseId: true, paraFaseId: true, em: true } });
  const divergentes = existentes.filter((e) => !alvo.has(chave(e.paraFaseId, e.em)) && (paras.has(e.paraFaseId) || (temEntrada && e.deFaseId === null)));
  if (divergentes.length > 0) await ctx.tx.transicaoFase.deleteMany({ where: { id: { in: divergentes.map((d) => d.id) } } });
  const ja = new Set(existentes.filter((e) => !divergentes.includes(e)).map((e) => chave(e.paraFaseId, e.em)));
  const novas = esperadas.filter((t) => !ja.has(chave(t.para, t.em)));
  if (novas.length > 0) {
    await ctx.tx.transicaoFase.createMany({
      data: novas.map((t) => ({ projetoId, deFaseId: t.de, paraFaseId: t.para, usuarioId: ctx.admin.id, origem: "IMPORT" as const, em: t.em })),
    });
  }
  return novas.length + divergentes.length;
}

const semMotivo = (f: Fase, card: CardPipefy) => f.tipoTerminal === "PERDIDO" && !card.motivoPerda?.trim();

function dadosTerminal(ctx: Ctx, destino: Fase, card: CardPipefy): DadosTerminal {
  if (destino.tipoTerminal === "PERDIDO") {
    const texto = card.motivoPerda?.trim();
    if (!texto) {
      // `aplicarCard` já pulou o card se não houver padrão; aqui é só defesa.
      if (!ctx.opcoes.motivoPerdaPadrao) throw new ErroDeRegra("MOTIVO_PERDA_OBRIGATORIO");
      return { motivo: ctx.opcoes.motivoPerdaPadrao, detalhe: detalhePerdaPadrao(ctx.admin.nome).slice(0, DETALHE_PERDA_MAX) };
    }
    const m = motivoDeTexto(texto);
    const detalhe = (m.motivo === "outro" ? m.detalhe || texto : m.detalhe).slice(0, DETALHE_PERDA_MAX);
    return { motivo: m.motivo || "outro", detalhe };
  }
  return card.valorFechado ? { valorFechado: valorParaCampo(card.valorFechado) } : {};
}

/** Card novo que já nasce em fase terminal (o Pipefy fechou antes do go-live): só o gancho, sem MOVIMENTACAO. */
async function entrarTerminal(ctx: Ctx, projetoId: string, pipelineChave: string, deFaseId: string, destino: Fase, em: Date, card: CardPipefy) {
  let passo = 0;
  await aoEntrarEmTerminal({
    tx: ctx.tx,
    projetoId,
    pipelineChave,
    deFaseId,
    destino,
    porUsuarioId: ctx.admin.id,
    em,
    instante: () => new Date(em.getTime() + ++passo),
    dados: dadosTerminal(ctx, destino, card),
  });
}

/** Movimento feito pelo import: núcleo do `moverCard` com a data do Pipefy e origem IMPORT. */
async function moverImportado(ctx: Ctx, projetoId: string, pipelineChave: string, deFaseId: string, destino: Fase, em: Date, passos: Passo[], card: CardPipefy) {
  const origem = ctx.fases.get(deFaseId) ?? (await ctx.tx.fase.findUniqueOrThrow({ where: { id: deFaseId } }));
  await registrarMovimento(ctx.tx, {
    projetoId,
    pipelineChave,
    origem,
    destino,
    porId: ctx.admin.id,
    em,
    origemTransicao: "IMPORT",
    // Com histórico da fase destino, a transição vem da cadeia (`sincronizarTransicoes`).
    transicao: !passos.some((p) => p.fase.id === destino.id && (p.h.entrada ?? p.h.ultimaEntrada)),
    via: "IMPORT",
    dadosTerminal: destino.isTerminal ? dadosTerminal(ctx, destino, card) : undefined,
  });
}

/** Leva o card (que já seguiu para Projetos pelo ganho) até a fase de Projetos em que o Pipefy está. true = mudou algo. */
async function posicionarEmProjetos(ctx: Ctx, projetoId: string, destino: Fase, passos: Passo[], card: CardPipefy, avisos: string[]): Promise<boolean> {
  const proj = await ctx.tx.projeto.findUniqueOrThrow({ where: { id: projetoId }, select: { id: true, pipelineId: true, faseId: true, faseDesde: true } });
  if (proj.pipelineId !== ctx.projetosId) {
    avisos.push(`O card não está em Projetos no CRM: não foi movido para "${destino.nome}".`);
    return false;
  }
  let mudou = false;
  const desdeHist = entradaDe(passos, destino.id);
  if (proj.faseId !== destino.id) {
    if (ctx.fases.get(proj.faseId)?.isTerminal) {
      avisos.push(`Projeto fechado no CRM (fase terminal): não foi movido para "${destino.nome}".`);
    } else {
      await moverImportado(ctx, proj.id, PIPELINE_PROJETOS, proj.faseId, destino, desdeHist ?? ctx.agora, passos, card);
      mudou = true;
    }
  } else if (desdeHist && proj.faseDesde.getTime() !== desdeHist.getTime()) {
    await ctx.tx.projeto.update({ where: { id: proj.id }, data: { faseDesde: desdeHist } });
    mudou = true;
  }
  const inicial = [...ctx.fases.values()].find((f) => f.marco === "HANDOFF")?.id ?? null;
  const n = await sincronizarTransicoes(ctx, proj.id, cadeia(passos, inicial));
  return mudou || n > 0;
}

function dominioDoCard(card: CardPipefy): string | null {
  for (const p of card.pontos) {
    if (p.tipo !== "EMAIL") continue;
    const d = normalizarDominio(p.valorNormalizado);
    if (d && !ehDominioPublico(d)) return d;
  }
  return null;
}

type Resolvida = { empresa: EmpresaRef | null; revisar: boolean };

/** Empresa por CNPJ: casa com a existente (viva); excluída/mesclada → sem empresa + revisar; nova → cria. */
async function empresaPorCnpj(ctx: Ctx, card: CardPipefy, cnpj: string, avisos: string[]): Promise<Resolvida> {
  const pre = ctx.pre.cnpjs.get(cnpj);
  if (pre?.viva) return { empresa: { id: pre.id, nome: pre.nome }, revisar: false };
  if (pre) {
    avisos.push(`CNPJ ${formatarCnpj(cnpj)} é de uma empresa excluída/mesclada: card ficou sem empresa.`);
    return { empresa: null, revisar: true };
  }
  const nome = card.empresa ?? formatarCnpj(cnpj);
  // P2002 aqui (outro escritor gravou o CNPJ depois da pré-carga) → SAVEPOINT do card e refaz.
  const e = await ctx.tx.empresa.create({ data: { nome, cnpj, dominioEmail: dominioDoCard(card) }, select: { id: true } });
  ctx.pre.cnpjs.set(cnpj, { id: e.id, nome, viva: true });
  return { empresa: { id: e.id, nome }, revisar: false };
}

/** Empresa sem CNPJ: uma nova por nome neste import. Homônima viva já existente → revisar + sugestão (nunca vincula). */
async function empresaPorNome(ctx: Ctx, card: CardPipefy, nome: string, avisos: string[]): Promise<Resolvida> {
  const chave = normalizarTexto(nome);
  let criada = ctx.empresasPorNome.get(chave);
  if (!criada) {
    const e = await ctx.tx.empresa.create({ data: { nome, dominioEmail: dominioDoCard(card) }, select: { id: true } });
    const h = ctx.homonimas.get(chave)?.[0];
    const aviso = h ? `Já existe a empresa "${h.nome}" no CRM com o mesmo nome (id ${h.id}): criada outra. Se for a mesma, mescle.` : null;
    criada = { empresa: { id: e.id, nome }, aviso };
    ctx.empresasPorNome.set(chave, criada);
  }
  if (criada.aviso) avisos.push(criada.aviso);
  return { empresa: criada.empresa, revisar: criada.aviso !== null };
}

type Achado = { id: string; empresa: EmpresaRef | null };
type MatchContatos = { achados: Achado[]; livres: CardPipefy["pontos"] } | { bloqueado: string };

/** Só leitura (pré-carga): quem já tem os telefones/emails do card. */
function procurarContatos(ctx: Ctx, card: CardPipefy): MatchContatos {
  const achados: Achado[] = [];
  const livres: CardPipefy["pontos"] = [];
  for (const p of card.pontos) {
    const d = ctx.pre.donos.get(chavePonto(p.tipo, p.valorNormalizado));
    if (!d) livres.push(p);
    else if (d.deletado) return { bloqueado: p.valorOriginal };
    else if (!achados.some((a) => a.id === d.contatoId)) achados.push({ id: d.contatoId, empresa: d.empresa });
  }
  return { achados, livres };
}

async function resolverContato(
  ctx: Ctx,
  card: CardPipefy,
  match: Exclude<MatchContatos, { bloqueado: string }>,
  empresa: EmpresaRef | null,
  avisos: string[],
): Promise<{ id: string | null; revisar: boolean }> {
  const { tx } = ctx;
  const livres = [...match.livres].sort((a, b) => (a.tipo + a.valorNormalizado < b.tipo + b.valorNormalizado ? -1 : 1));
  const registrar = (contatoId: string, emp: EmpresaRef | null) => {
    for (const p of livres) ctx.pre.donos.set(chavePonto(p.tipo, p.valorNormalizado), { contatoId, deletado: false, empresa: emp });
  };
  if (match.achados.length > 0) {
    const c = match.achados[0];
    // P2002 aqui (ponto gravado por outro escritor depois da pré-carga) → SAVEPOINT do card e refaz.
    if (livres.length > 0) {
      await tx.contatoPonto.createMany({ data: livres.map((p) => ({ contatoId: c.id, tipo: p.tipo, valorNormalizado: p.valorNormalizado, valorOriginal: p.valorOriginal })) });
    }
    registrar(c.id, c.empresa);
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
      empresaId: empresa?.id ?? null,
      cargo: card.cargo,
      pontos: { create: livres.map((p) => ({ tipo: p.tipo, valorNormalizado: p.valorNormalizado, valorOriginal: p.valorOriginal })) },
    },
    select: { id: true },
  });
  registrar(c.id, empresa);
  return { id: c.id, revisar: false };
}

/** Último instante gravado no card (Timeline/TransicaoFase): marco do import para detectar edição posterior no CRM. */
async function marcoDoImport(ctx: Ctx, projetoId: string): Promise<Date> {
  const t = await ctx.tx.timeline.aggregate({ where: { projetoId }, _max: { em: true } });
  const f = await ctx.tx.transicaoFase.aggregate({ where: { projetoId }, _max: { em: true } });
  return new Date(Math.max(ctx.agora.getTime(), t._max.em?.getTime() ?? 0, f._max.em?.getTime() ?? 0));
}

const fmt = (d: Date) => d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

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
  const cadeiaVenda = cadeia(passosVenda, null);
  const primeira = cadeiaVenda[0]?.para ?? null;

  const existente = ctx.pre.existentes.get(card.pipefyId) ?? null;
  if (existente?.absorvidoPorId) return pulado(mensagemCardAbsorvido(existente.absorvidoPorId));
  if (existente?.deletadoEm) return pulado("Card excluído no CRM (está na lixeira): não é reimportado.");
  if (existente && existente.pipelineId !== ctx.vendasId && existente.pipelineId !== ctx.projetosId) {
    return pulado("Este ID do Pipefy pertence a um card fora de Vendas/Projetos.");
  }
  // Ciclo único: o card já seguiu para Projetos (ganho) e não volta para Vendas pelo import.
  const jaEmProjetos = existente?.pipelineId === ctx.projetosId;
  if (existente) {
    const editado = ctx.pre.editadoEm.get(existente.id);
    if (editado && !(card.atualizadoEm && card.atualizadoEm > editado)) {
      return pulado(`Card editado no CRM depois do export (${fmt(editado)}): não foi atualizado. Exporte de novo do Pipefy se o Pipefy é que vale.`);
    }
  }
  const faseCrm = existente ? ctx.fases.get(existente.faseId) : undefined;
  const fechadoNoCrm = !!existente && !jaEmProjetos && !!faseCrm?.isTerminal && faseVenda.id !== existente.faseId;
  const entraNaVenda = !existente || (!fechadoNoCrm && !jaEmProjetos && faseVenda.id !== existente.faseId);
  if (((entraNaVenda && semMotivo(faseVenda, card)) || (emProjetos && semMotivo(destino, card))) && !ctx.opcoes.motivoPerdaPadrao) {
    return pulado("PERDIDO sem motivo no export.");
  }

  // Leituras que podem pular o card vêm ANTES de qualquer escrita dele.
  const precisaContato = !existente?.contatoId && card.pontos.length + (card.contatoNome ? 1 : 0) > 0;
  const match = precisaContato ? procurarContatos(ctx, card) : { achados: [], livres: [] };
  if ("bloqueado" in match) return pulado(`Contato excluído na lixeira (${match.bloqueado}). Restaure ou mescle o contato e importe de novo.`);

  const avisos: string[] = [];
  const responsavel = resolverResponsavel(card.responsavel, ctx.usuarios);
  let revisar = false;
  // Reimport: a empresa do card fica (não cria outra a cada import).
  let empresa: EmpresaRef | null = existente?.empresaId ? { id: existente.empresaId, nome: "" } : null;
  if (!empresa) {
    const doContato = match.achados[0]?.empresa ?? null;
    let r: Resolvida = { empresa: null, revisar: false };
    if (card.cnpj) r = await empresaPorCnpj(ctx, card, card.cnpj, avisos);
    else if (doContato) {
      // Cadeia de identidade exata (telefone/email → contato → empresa), mesma regra do GAB-34.
      r = { empresa: doContato, revisar: false };
      if (card.empresa && normalizarTexto(card.empresa) !== normalizarTexto(doContato.nome)) {
        avisos.push(`O contato achado pelo telefone/email é da empresa "${doContato.nome}", mas o CSV diz "${card.empresa}": confira.`);
        r.revisar = true;
      }
    } else if (card.empresa) r = await empresaPorNome(ctx, card, card.empresa, avisos);
    empresa = r.empresa;
    revisar ||= r.revisar;
  }
  let contatoId = existente?.contatoId ?? null;
  if (!contatoId && precisaContato) {
    const c = await resolverContato(ctx, card, match, empresa, avisos);
    contatoId = c.id;
    revisar ||= c.revisar;
  }
  const empresaId = empresa?.id ?? null;

  const emProjetosAgora = async (id: string) => (await tx.projeto.findUniqueOrThrow({ where: { id }, select: { pipelineId: true } })).pipelineId === ctx.projetosId;

  if (!existente) {
    if (!responsavel) avisos.push(card.responsavel ? `Responsável "${card.responsavel}" sem usuário no CRM: ficou com quem importou.` : "Sem responsável no Pipefy: ficou com quem importou.");
    const criadoEm = card.criadoEm ?? cadeiaVenda[0]?.em ?? ctx.agora;
    const entrada = primeira ?? faseVenda.id;
    const id = await inserirCard(tx, {
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
        descricao: card.descricao,
        orcamentoPrevisto: card.orcamento,
        propostaUrl: card.propostaUrl,
        cidade: card.cidade,
        estado: card.estado,
        faseDesde: desdeVenda,
        criadoVia: "IMPORT",
        pipefyId: card.pipefyId,
        criadoEm,
      },
      entrada: { faseId: entrada, em: criadoEm },
      porId: ctx.admin.id,
      origem: "IMPORT",
      timeline: {
        tipo: "IMPORT",
        payload: { acao: "criado", pipefyId: card.pipefyId, linha: card.linha, faseId: faseVenda.id, fasePipefy: nomeFase, responsavelPipefy: card.responsavel, avisos },
        em: criadoEm,
      },
    });
    const retro = cadeia(passosVenda, entrada);
    await sincronizarTransicoes(ctx, id, [{ de: null, para: entrada, em: criadoEm }, ...retro]);
    if (faseVenda.isTerminal) {
      const anterior = retro.filter((t) => t.para !== faseVenda.id).at(-1)?.para ?? entrada;
      await entrarTerminal(ctx, id, PIPELINE_VENDAS, anterior, faseVenda, desdeVenda, card);
    }
    const projetoCriado = await emProjetosAgora(id);
    if (emProjetos) await posicionarEmProjetos(ctx, id, destino, passosProj, card, avisos);
    // Marco: tudo o que este import gravou no card vem antes dele (edição no CRM vem depois).
    const tl = await tx.timeline.findFirstOrThrow({ where: { projetoId: id, tipo: "IMPORT" }, select: { id: true, payload: true } });
    await tx.timeline.update({ where: { id: tl.id }, data: { payload: { ...(tl.payload as object), marco: (await marcoDoImport(ctx, id)).toISOString() } } });
    return { tipo: "criado", projetoCriado, avisos };
  }

  // ---------------------------------------------------------------- atualização
  type Mudanca = { campo: string; antes: string | null; depois: string | null; truncado?: true };
  const mudancas: Mudanca[] = [];
  const data: Prisma.ProjetoUncheckedUpdateInput = {};
  const comparar = (campo: keyof typeof data & string, atual: string | null, novo: string | null) => {
    if (novo === null || novo === atual) return;
    // Descrição (até 5000): o histórico do import guarda só a prévia.
    mudancas.push(campo === "descricao" ? mudancaDescricao(campo, atual, novo) : { campo, antes: atual, depois: novo });
    (data as Record<string, unknown>)[campo] = novo;
  };
  comparar("titulo", existente.titulo, card.titulo);
  comparar("origem", existente.origem, card.origem as Origem | null);
  comparar("dor", existente.dor, card.dor);
  comparar("descricao", existente.descricao, card.descricao);
  comparar("orcamentoPrevisto", existente.orcamentoPrevisto?.toFixed(2) ?? null, card.orcamento);
  comparar("propostaUrl", existente.propostaUrl, card.propostaUrl);
  comparar("cidade", existente.cidade, card.cidade);
  comparar("estado", existente.estado, card.estado);
  if (responsavel) comparar("responsavelId", existente.responsavelId, responsavel.id);
  comparar("empresaId", existente.empresaId, empresaId);
  comparar("contatoId", existente.contatoId, contatoId);
  if (revisar && !existente.revisar) data.revisar = true;
  if (Object.keys(data).length > 0) await tx.projeto.update({ where: { id: existente.id }, data });

  let projetoCriado = false;
  if (jaEmProjetos) {
    // Ganho no Pipefy = coerente com o card em Projetos; outra fase de Vendas não o traz de volta.
    if (faseVenda.tipoTerminal !== "GANHO") avisos.push(`Card já seguiu para Projetos no CRM: não voltou para "${faseVenda.nome}".`);
  } else if (fechadoNoCrm) {
    avisos.push(`Card fechado no CRM (fase terminal): não foi movido para "${faseVenda.nome}".`);
  } else if (faseVenda.id !== existente.faseId) {
    await moverImportado(ctx, existente.id, PIPELINE_VENDAS, existente.faseId, faseVenda, desdeVenda, passosVenda, card);
    projetoCriado = await emProjetosAgora(existente.id);
    mudancas.push({ campo: "fase", antes: existente.faseId, depois: faseVenda.id });
  } else if (desdeHist && existente.faseDesde.getTime() !== desdeHist.getTime()) {
    await tx.projeto.update({ where: { id: existente.id }, data: { faseDesde: desdeHist } });
    mudancas.push({ campo: "faseDesde", antes: existente.faseDesde.toISOString(), depois: desdeHist.toISOString() });
  }
  // Com histórico, a entrada no funil é a 1ª fase dele, na criação do card.
  const esperadas = primeira ? [{ de: null, para: primeira, em: existente.criadoEm }, ...cadeia(passosVenda, primeira)] : [];
  const n = await sincronizarTransicoes(ctx, existente.id, esperadas);
  if (n > 0) mudancas.push({ campo: "historico", antes: null, depois: `${n} transições` });
  if (emProjetos && !fechadoNoCrm && (await posicionarEmProjetos(ctx, existente.id, destino, passosProj, card, avisos))) {
    mudancas.push({ campo: "projeto", antes: null, depois: destino.id });
  }
  if (mudancas.length === 0) return { tipo: "semMudanca", projetoCriado: false, avisos };
  const marco = await marcoDoImport(ctx, existente.id);
  await tx.timeline.create({
    data: {
      projetoId: existente.id,
      tipo: "IMPORT",
      payload: { acao: "atualizado", pipefyId: card.pipefyId, linha: card.linha, mudancas, marco: marco.toISOString() },
      usuarioId: ctx.admin.id,
      em: ctx.agora,
    },
  });
  return { tipo: "atualizado", projetoCriado, avisos };
}

// ---------------------------------------------------------------- pré-carga do lote

async function preCarregar(tx: Tx, cards: CardPipefy[]): Promise<PreCarga> {
  const ids = cards.map((c) => c.pipefyId);
  const existentes = new Map(
    (await emLotes(ids, (l) => tx.projeto.findMany({ where: { pipefyId: { in: l } } }))).map((o) => [o.pipefyId!, o] as const),
  );

  const valores = [...new Set(cards.flatMap((c) => c.pontos.map((p) => p.valorNormalizado)))];
  const pontos = await emLotes(valores, (l) => tx.contatoPonto.findMany({ where: { valorNormalizado: { in: l } }, select: { tipo: true, valorNormalizado: true, contatoId: true } }));
  const contatosRes = new Map(await emLotes([...new Set(pontos.map((p) => p.contatoId))], async (l) => [...(await resolverContatos(l, tx)).entries()]));
  const vivos = [...new Set([...contatosRes.values()].filter((r) => !r.deletado).map((r) => r.id))];
  const empresaDe = new Map((await emLotes(vivos, (l) => tx.contato.findMany({ where: { id: { in: l } }, select: { id: true, empresaId: true } }))).map((c) => [c.id, c.empresaId] as const));

  const cnpjs = [...new Set(cards.map((c) => c.cnpj).filter((x): x is string => !!x))];
  const porCnpj = await emLotes(cnpjs, (l) => tx.empresa.findMany({ where: { cnpj: { in: l } }, select: { id: true, cnpj: true } }));
  const idsEmpresa = [...new Set([...empresaDe.values()].filter((x): x is string => !!x).concat(porCnpj.map((e) => e.id)))];
  const empresasRes = new Map(await emLotes(idsEmpresa, async (l) => [...(await resolverEmpresas(l, tx)).entries()]));
  const empresaViva = (id: string | null | undefined): EmpresaRef | null => {
    const r = id ? empresasRes.get(id) : undefined;
    return r && !r.deletado ? { id: r.id, nome: r.nome } : null;
  };

  const donos = new Map<string, Dono>();
  for (const p of pontos) {
    const r = contatosRes.get(p.contatoId);
    // Fora do mapa = cadeia quebrada/ciclo: trata como excluído (bloqueia, como `encontrarContatoPorIdentificador`).
    donos.set(chavePonto(p.tipo, p.valorNormalizado), r && !r.deletado ? { contatoId: r.id, deletado: false, empresa: empresaViva(empresaDe.get(r.id)) } : { contatoId: r?.id ?? p.contatoId, deletado: true, empresa: null });
  }
  const cnpjsMap = new Map<string, EmpresaRef & { viva: boolean }>();
  for (const e of porCnpj) {
    const r = empresasRes.get(e.id);
    cnpjsMap.set(e.cnpj!, r ? { id: r.id, nome: r.nome, viva: !r.deletado } : { id: e.id, nome: "", viva: false });
  }

  // Edição no CRM depois do último import: Timeline/TransicaoFase que não são do import, depois do marco.
  const opIds = [...existentes.values()].map((o) => o.id);
  const editadoEm = new Map<string, Date>();
  if (opIds.length > 0) {
    const imports = await emLotes(opIds, (l) => tx.timeline.findMany({ where: { projetoId: { in: l }, tipo: "IMPORT" }, select: { projetoId: true, em: true, payload: true } }));
    const marco = new Map<string, number>();
    for (const t of imports) {
      const m = (t.payload as { marco?: unknown } | null)?.marco;
      const v = typeof m === "string" ? Date.parse(m) : t.em.getTime();
      marco.set(t.projetoId, Math.max(marco.get(t.projetoId) ?? 0, Number.isNaN(v) ? t.em.getTime() : v));
    }
    const tl = await emLotes(opIds, (l) => tx.timeline.groupBy({ by: ["projetoId"], where: { projetoId: { in: l }, tipo: { not: "IMPORT" } }, _max: { em: true } }));
    const tr = await emLotes(opIds, (l) => tx.transicaoFase.groupBy({ by: ["projetoId"], where: { projetoId: { in: l }, origem: { not: "IMPORT" } }, _max: { em: true } }));
    for (const g of [...tl, ...tr]) {
      const em = g._max.em;
      if (!em || em.getTime() <= (marco.get(g.projetoId) ?? 0)) continue;
      const atual = editadoEm.get(g.projetoId);
      if (!atual || em > atual) editadoEm.set(g.projetoId, em);
    }
  }
  return { existentes, donos, cnpjs: cnpjsMap, editadoEm };
}

/** P2002 em ponto de contato ou CNPJ: outro escritor gravou entre a pré-carga e o INSERT. */
function ehConflitoDeIdentidade(e: unknown): boolean {
  const err = e as { code?: string; meta?: { target?: unknown; modelName?: unknown } };
  if (err?.code !== "P2002") return false;
  const alvo = JSON.stringify(err.meta?.target ?? "");
  return /valor_?normalizado|valorNormalizado|cnpj/i.test(alvo) || err.meta?.modelName === "ContatoPonto";
}

/**
 * Um card num SAVEPOINT: conflito de identidade volta só o card, recarrega o
 * que ele precisa e tenta de novo uma vez (agora o match acha o registro do
 * outro escritor e vincula a ele).
 */
async function aplicarCardIsolado(ctx: Ctx, card: CardPipefy): Promise<Desfecho> {
  const { tx } = ctx;
  const copia = { donos: new Map(ctx.pre.donos), cnpjs: new Map(ctx.pre.cnpjs), empresas: new Map(ctx.empresasPorNome) };
  await tx.$executeRawUnsafe("SAVEPOINT import_card");
  try {
    const d = await aplicarCard(ctx, card);
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT import_card");
    return d;
  } catch (e) {
    if (!ehConflitoDeIdentidade(e)) throw e;
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT import_card");
    ctx.pre.donos = copia.donos;
    ctx.pre.cnpjs = copia.cnpjs;
    ctx.empresasPorNome = copia.empresas;
    const fresca = await preCarregar(tx, [card]);
    for (const [k, v] of fresca.donos) ctx.pre.donos.set(k, v);
    for (const [k, v] of fresca.cnpjs) ctx.pre.cnpjs.set(k, v);
    for (const [k, v] of fresca.existentes) ctx.pre.existentes.set(k, v);
    return aplicarCard(ctx, card);
  }
}

// ---------------------------------------------------------------- lotes

const MENSAGEM_REGRA: Partial<Record<string, string>> = {
  FASE_HANDOFF_INDISPONIVEL: "Projetos não tem o marco Handoff ativo: o card ganho não pôde seguir para lá.",
  MOTIVO_PERDA_OBRIGATORIO: "PERDIDO sem motivo no export.",
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
  opts: {
    mapeamento: Mapeamento;
    nomesFase: Map<string, string>;
    admin: { id: string };
    agora?: Date;
    tamanhoLote?: number;
    opcoes?: OpcoesImport;
    ganchosTeste?: GanchosTeste;
  },
): Promise<Omit<Relatorio, "duplicadas" | "total"> & { total: number }> {
  const agora = opts.agora ?? new Date();
  const pipelines = await db.pipeline.findMany({ where: { chave: { in: [PIPELINE_VENDAS, PIPELINE_PROJETOS] } }, select: { id: true, chave: true } });
  const vendasId = pipelines.find((p) => p.chave === PIPELINE_VENDAS)?.id;
  const projetosId = pipelines.find((p) => p.chave === PIPELINE_PROJETOS)?.id;
  if (!vendasId || !projetosId) throw new ErroImport("Quadros Vendas/Projetos não encontrados. Rode o seed.");
  const usuarios = await db.usuario.findMany({ where: { ativo: true, ...QUEM_ATUA }, select: { id: true, nome: true, email: true } });
  const admin = await db.usuario.findUniqueOrThrow({ where: { id: opts.admin.id }, select: { id: true, nome: true } });
  const empresasPorNome: Ctx["empresasPorNome"] = new Map();
  const homonimas = new Map<string, EmpresaRef[]>();
  if (cards.some((c) => c.empresa && !c.cnpj)) {
    for (const e of await db.empresa.findMany({ where: { deletadoEm: null, mergedIntoId: null }, select: { id: true, nome: true }, orderBy: { criadoEm: "asc" } })) {
      const k = normalizarTexto(e.nome);
      homonimas.set(k, [...(homonimas.get(k) ?? []), e]);
    }
  }

  const rel = { total: cards.length, criados: 0, atualizados: 0, semMudanca: 0, pulados: 0, projetosCriados: 0, erros: [] as Ocorrencia[], avisos: [] as Ocorrencia[] } as Omit<Relatorio, "duplicadas">;

  async function executarLote(lote: CardPipefy[]): Promise<Desfecho[]> {
    const local = new Map(empresasPorNome);
    const r = await db.$transaction(async (tx) => {
      // Leituras pesadas ANTES do lock: o Kanban espera só pelas escritas.
      const pre = await preCarregar(tx, lote);
      await opts.ganchosTeste?.depoisDaPreCarga?.();
      await travarPipelines(tx, [vendasId!, projetosId!]);
      const fases = await tx.fase.findMany({ where: { pipelineId: { in: [vendasId!, projetosId!] } } });
      const ctx: Ctx = {
        tx,
        admin,
        agora,
        vendasId: vendasId!,
        projetosId: projetosId!,
        fases: new Map(fases.map((f) => [f.id, f])),
        mapeamento: opts.mapeamento,
        nomesFase: opts.nomesFase,
        usuarios,
        opcoes: opts.opcoes ?? {},
        pre,
        empresasPorNome: local,
        homonimas,
      };
      const out: Desfecho[] = [];
      for (const c of lote) out.push(await aplicarCardIsolado(ctx, c));
      // `aplicarCardIsolado` pode trocar o mapa (rollback): o que vale é o do ctx.
      for (const [k, v] of ctx.empresasPorNome) local.set(k, v);
      return out;
    }, OPCOES_TX);
    // Só depois do commit: empresa criada num lote desfeito não existe.
    for (const [k, v] of local) empresasPorNome.set(k, v);
    return r;
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
  let processados = 0;
  try {
    for (let i = 0, n = 0; i < cards.length; i += tamanho, n++) {
      await opts.ganchosTeste?.antesDoLote?.(n);
      const lote = cards.slice(i, i + tamanho);
      try {
        const ds = await executarLote(lote);
        lote.forEach((c, j) => contar(c, ds[j]));
      } catch {
        // O lote voltou inteiro: refaz card a card para isolar quem falha.
        for (const c of lote) {
          try {
            contar(c, (await executarLote([c]))[0]);
          } catch (e) {
            contar(c, pulado(mensagemDeFalha(e)));
          }
        }
      }
      processados += lote.length;
    }
  } catch (e) {
    // Falha fora do tratamento por card: os lotes anteriores ficaram gravados. Devolve o parcial.
    rel.interrompido = { ref: registrarErro("import.pipefy", e), naoProcessados: cards.length - processados };
  }
  return rel;
}

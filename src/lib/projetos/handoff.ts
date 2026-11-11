/**
 * Serviço do handoff (GAB-93, spec fase 2 §4.8/§4.12): a porta única da tela e
 * do MCP. Regras puras em `handoff-regras.ts`; a trava de Execução em
 * `trava-handoff.ts`, chamada por `registrarMovimento`.
 *
 * Permissões, sempre com a pessoa RELIDA do banco:
 * - Itens manuais e PDF do contrato: etapa conjunta, quem edita o card ou é de Vendas; Execução: quem
 *   edita o card. Conferido antes de chamar (GAB-98, `acesso-card.ts`), nas actions, na rota e no MCP.
 * - Resumo: lado vendas. GP do projeto: só o PM de projetos, e a pessoa é da área
 *   projetos; ela vira a responsável pelo Projeto.
 * - Proposta congelada: automática, não tem escrita aqui.
 *
 * Edição só enquanto o card está em Handoff (quadro Projetos, antes de Execução
 * e fora de terminal). Depois vira registro, e nada do que entrou na trava muda.
 * Exceção (GAB-95): trocar o GP do projeto vale também em Execução ou subfase depois dela.
 * Toda edição trava a linha do card (FOR UPDATE) e relê a fase; o movimento lê a
 * linha em FOR SHARE, então os dois nunca se cruzam.
 *
 * Isentos da trava podem preencher também, e ninguém os obriga.
 * O PDF do contrato reconfere a fase sob o lock (`contrato-anexo.ts`).
 */
import type { Papel, Prisma } from "@prisma/client";
import type { AnexoCriado } from "@/lib/anexos/anexos";
import { MENSAGEM_ERRO_ANEXO, type ErroAnexo } from "@/lib/anexos/tipos";
import { avisarGpDesignado, avisarGpTrocado } from "@/lib/avisos/handoff";
import { temCargo, type PessoaComLado } from "@/lib/auth/areas";
import { podeEscrever, QUEM_ATUA } from "@/lib/auth/papeis";
import { db } from "@/lib/db";
import { anexarPdfDoContrato, definirAnexoDoContrato } from "./contrato-anexo";
import { MENSAGEM_ERRO_PROJETO, textoDoErroProjeto } from "./erros";
import {
  avaliarHandoff,
  CAMPOS_RESUMO,
  podeDesignarGp,
  podeEscreverResumo,
  podeSerGpDoProjeto,
  RESUMO_CAMPO_MAX,
  type AvaliacaoHandoff,
  type CampoResumo,
  type ItemManual,
} from "./handoff-regras";
import { moverCard } from "./projetos";
import { PIPELINE_PROJETOS } from "./terminal-regras";
import { faseDeExecucaoAberta, faseDeHandoff, faseExecucao, SELECAO_HANDOFF } from "./trava-handoff";

type Tx = Prisma.TransactionClient;
type Ator = { id: string; papel: Papel };

export type ErroHandoff =
  | "SEM_PERMISSAO"
  | "CARD_NAO_ENCONTRADO"
  | "HANDOFF_ENCERRADO"
  | "SO_GP_DE_PROJETOS"
  | "GP_INVALIDO"
  | "SO_VENDAS_ESCREVE_RESUMO"
  | "RESUMO_LONGO"
  | "ANEXO_NAO_ENCONTRADO"
  | "CONTRATO_NAO_E_PDF"
  | ErroAnexo;

export const MENSAGEM_ERRO_HANDOFF: Record<ErroHandoff, string> = {
  ...MENSAGEM_ERRO_ANEXO,
  SEM_PERMISSAO: MENSAGEM_ERRO_PROJETO.SEM_PERMISSAO,
  CARD_NAO_ENCONTRADO: MENSAGEM_ERRO_PROJETO.CARD_NAO_ENCONTRADO,
  HANDOFF_ENCERRADO: "O handoff só é editável com o projeto na coluna Handoff (quadro Projetos, antes de Execução).",
  SO_GP_DE_PROJETOS: "Só o PM de projetos designa o GP do projeto. Se ninguém tem esse cargo, peça à gestão para dar.",
  GP_INVALIDO: "O GP do projeto precisa ser uma pessoa ativa da área de projetos.",
  SO_VENDAS_ESCREVE_RESUMO: "O resumo de handoff é escrito por vendas.",
  RESUMO_LONGO: `Cada parte do resumo pode ter até ${RESUMO_CAMPO_MAX} caracteres.`,
  ANEXO_NAO_ENCONTRADO: "Anexo não encontrado neste projeto (pode ter sido excluído).",
  CONTRATO_NAO_E_PDF: "O contrato assinado precisa ser um PDF.",
};

export type Resultado<T = object> = ({ ok: true } & T) | { ok: false; erro: ErroHandoff };

class Falha extends Error {
  constructor(readonly erro: ErroHandoff) {
    super(erro);
  }
}

async function emTransacao<T>(corpo: (tx: Tx) => Promise<T>): Promise<T | { ok: false; erro: ErroHandoff }> {
  try {
    return await db.$transaction(corpo);
  } catch (e) {
    if (e instanceof Falha) return { ok: false, erro: e.erro };
    throw e;
  }
}

/** Trava a linha do card e confere que ele está em Handoff (`tambemEmExecucao`: ou em Execução aberta). */
async function abrirParaEdicao(tx: Tx, projetoId: string, opts: { tambemEmExecucao?: boolean } = {}) {
  const linha = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM oportunidade WHERE id = ${projetoId} AND deletado_em IS NULL FOR UPDATE`;
  if (linha.length === 0) throw new Falha("CARD_NAO_ENCONTRADO");
  const card = await tx.projeto.findUniqueOrThrow({ where: { id: projetoId }, select: { responsavelId: true, fase: true, pipeline: { select: { chave: true } } } });
  const ex = await faseExecucao(tx);
  const emExecucao = !!opts.tambemEmExecucao && faseDeExecucaoAberta(card.fase, card.pipeline.chave, ex);
  if (!emExecucao && !faseDeHandoff(card.fase, card.pipeline.chave, ex)) throw new Falha("HANDOFF_ENCERRADO");
  return card;
}

const lerPessoa = (tx: Tx, id: string) => tx.usuario.findUnique({ where: { id }, select: { id: true, papel: true, area: true, cargos: true, ativo: true, nome: true } });

// ---------------------------------------------------------------- leitura

export type VisaoHandoff = AvaliacaoHandoff & { emHandoff: boolean; isento: boolean; completo: boolean };

/** Estado do handoff de um card do quadro Projetos (null = card fora dele ou inexistente). */
export async function obterHandoff(projetoId: string): Promise<VisaoHandoff | null> {
  const [card, ex] = await Promise.all([
    db.projeto.findFirst({ where: { id: projetoId, deletadoEm: null }, select: { ...SELECAO_HANDOFF, fase: true, pipeline: { select: { chave: true } } } }),
    db.fase.findUnique({ where: { marco: "EXECUCAO" } }),
  ]);
  if (!card || card.pipeline.chave !== PIPELINE_PROJETOS) return null;
  const a = avaliarHandoff(card);
  return { ...a, emHandoff: faseDeHandoff(card.fase, card.pipeline.chave, ex), isento: card.isentoTravaHandoff, completo: a.pendencias.length === 0 };
}

/** Quem pode ser designado GP do projeto: POs e PMs primeiro (só ordem; qualquer pessoa ativa de projetos vale), depois por nome. */
export async function listarCandidatosGp(): Promise<{ id: string; nome: string }[]> {
  const us = await db.usuario.findMany({ where: { ativo: true, ...QUEM_ATUA }, orderBy: { nome: "asc" }, select: { id: true, nome: true, papel: true, area: true, cargos: true, ativo: true } });
  const ordem = (u: PessoaComLado) => (temCargo(u, "PO") ? 0 : temCargo(u, "PM") ? 1 : 2);
  return us
    .filter(podeSerGpDoProjeto)
    .sort((a, b) => ordem(a) - ordem(b))
    .map((u) => ({ id: u.id, nome: u.nome }));
}

// ---------------------------------------------------------------- escrita

/** Designa o GP do projeto: a pessoa vira a responsável pelo Projeto e recebe o aviso; o GP anterior, se havia, também. */
export async function designarGpDoProjeto(projetoId: string, gpId: string, por: Ator): Promise<Resultado<{ mudou: boolean }>> {
  const r = await emTransacao(async (tx) => {
    const card = await abrirParaEdicao(tx, projetoId, { tambemEmExecucao: true });
    const ator = await lerPessoa(tx, por.id);
    if (!ator?.ativo || !podeDesignarGp(ator)) throw new Falha("SO_GP_DE_PROJETOS");
    const gp = await lerPessoa(tx, gpId);
    if (!gp || !podeSerGpDoProjeto(gp)) throw new Falha("GP_INVALIDO");
    const atual = await tx.projetoHandoff.findUnique({ where: { projetoId }, select: { gpProjetoId: true } });
    if (atual?.gpProjetoId === gpId && card.responsavelId === gpId) return { ok: true as const, mudou: false, gpNovo: false, gpAnteriorId: null, gpNome: gp.nome };
    const agora = new Date();
    await tx.projetoHandoff.upsert({ where: { projetoId }, create: { projetoId, gpProjetoId: gpId }, update: { gpProjetoId: gpId } });
    if (card.responsavelId !== gpId) {
      await tx.projeto.update({ where: { id: projetoId }, data: { responsavelId: gpId } });
      await tx.timeline.create({ data: { projetoId, tipo: "CAMPO_ALTERADO", payload: { campo: "responsavelId", antes: card.responsavelId, depois: gpId }, usuarioId: por.id, em: agora } });
    }
    await tx.timeline.create({ data: { projetoId, tipo: "HANDOFF", payload: { evento: "gp_designado", gpId, gpNome: gp.nome }, usuarioId: por.id, em: new Date(agora.getTime() + 1) } });
    const gpNovo = atual?.gpProjetoId !== gpId;
    return { ok: true as const, mudou: true, gpNovo, gpAnteriorId: gpNovo ? (atual?.gpProjetoId ?? null) : null, gpNome: gp.nome };
  });
  if (!r.ok) return r;
  // Só devolver a responsabilidade a quem já era o GP não é novidade para a pessoa.
  if (r.gpNovo) await avisarGpDesignado(projetoId, gpId, por.id);
  if (r.gpAnteriorId) await avisarGpTrocado(projetoId, r.gpAnteriorId, r.gpNome, por.id);
  return { ok: true, mudou: r.mudou };
}

const COLUNA_DO_ITEM = { contatos: "contatosEm", kickoff: "kickoffEm", acessos: "acessosEm" } as const;

/** Marca ou desmarca um item manual do checklist. */
export async function marcarItemHandoff(projetoId: string, item: ItemManual, feito: boolean, por: Ator): Promise<Resultado<{ mudou: boolean }>> {
  if (!podeEscrever(por.papel)) return { ok: false, erro: "SEM_PERMISSAO" };
  return emTransacao(async (tx) => {
    await abrirParaEdicao(tx, projetoId);
    const coluna = COLUNA_DO_ITEM[item];
    const atual = await tx.projetoHandoff.findUnique({ where: { projetoId }, select: { [coluna]: true } });
    if (!!(atual as Record<string, Date | null> | null)?.[coluna] === feito) return { ok: true as const, mudou: false };
    const agora = new Date();
    const valor = { [coluna]: feito ? agora : null };
    await tx.projetoHandoff.upsert({ where: { projetoId }, create: { projetoId, ...valor }, update: valor });
    await tx.timeline.create({ data: { projetoId, tipo: "HANDOFF", payload: { evento: feito ? "item_marcado" : "item_desmarcado", item }, usuarioId: por.id, em: agora } });
    return { ok: true as const, mudou: true };
  });
}

const COLUNA_DO_RESUMO = { contexto: "resumoContexto", combinados: "resumoCombinados", riscos: "resumoRiscos", valoriza: "resumoValoriza" } as const;

/** Grava as partes do resumo que vieram; as outras ficam. Texto vazio limpa a parte. */
export async function salvarResumoHandoff(projetoId: string, partes: Partial<Record<CampoResumo, string>>, por: Ator): Promise<Resultado<{ mudou: boolean }>> {
  const dados: Partial<Record<(typeof COLUNA_DO_RESUMO)[CampoResumo], string>> = {};
  for (const c of CAMPOS_RESUMO) {
    const v = partes[c]?.trim();
    if (v === undefined) continue;
    if (v.length > RESUMO_CAMPO_MAX) return { ok: false, erro: "RESUMO_LONGO" };
    dados[COLUNA_DO_RESUMO[c]] = v;
  }
  return emTransacao(async (tx) => {
    await abrirParaEdicao(tx, projetoId);
    const ator = await lerPessoa(tx, por.id);
    if (!ator?.ativo || !podeEscreverResumo(ator)) throw new Falha("SO_VENDAS_ESCREVE_RESUMO");
    const atual = await tx.projetoHandoff.findUnique({ where: { projetoId } });
    const mudaram = CAMPOS_RESUMO.filter((c) => {
      const coluna = COLUNA_DO_RESUMO[c];
      return dados[coluna] !== undefined && dados[coluna] !== (atual?.[coluna] ?? "");
    });
    if (mudaram.length === 0) return { ok: true as const, mudou: false };
    const agora = new Date();
    const gravar = { ...dados, resumoPorId: por.id, resumoEm: agora };
    await tx.projetoHandoff.upsert({ where: { projetoId }, create: { projetoId, ...gravar }, update: gravar });
    // Só quais partes: o texto fica no handoff, não se repete na Timeline.
    await tx.timeline.create({ data: { projetoId, tipo: "HANDOFF", payload: { evento: "resumo_salvo", partes: mudaram }, usuarioId: por.id, em: agora } });
    return { ok: true as const, mudou: true };
  });
}

/** Item do PDF: envia o arquivo assinado, para quem chegou aqui sem ele (isento, arraste sem PDF). */
export async function anexarContratoNoHandoff(projetoId: string, arquivo: { nome: string; bytes: Uint8Array }, por: Ator): Promise<Resultado<{ anexo: AnexoCriado | null }>> {
  if (!podeEscrever(por.papel)) return { ok: false, erro: "SEM_PERMISSAO" };
  // Confere antes e solta a linha: a extração de texto do PDF não roda com ela travada.
  const aberto = await emTransacao(async (tx) => {
    await abrirParaEdicao(tx, projetoId);
    return { ok: true as const };
  });
  if (!aberto.ok) return aberto;
  const r = await anexarPdfDoContrato(projetoId, arquivo, por);
  if (!r.ok) return r;
  return { ok: true, anexo: r.anexo };
}

/** Item do PDF: aponta um PDF que já está nos anexos do Projeto como o contrato assinado. */
export async function definirContratoNoHandoff(projetoId: string, anexoId: string, por: Ator): Promise<Resultado<{ mudou: boolean }>> {
  if (!podeEscrever(por.papel)) return { ok: false, erro: "SEM_PERMISSAO" };
  return emTransacao(async (tx) => {
    await abrirParaEdicao(tx, projetoId);
    const a = await tx.anexo.findFirst({ where: { id: anexoId, projetoId, deletadoEm: null }, select: { nome: true, tipo: true, contratoAssinado: true } });
    if (!a) throw new Falha("ANEXO_NAO_ENCONTRADO");
    if (a.tipo !== "PDF") throw new Falha("CONTRATO_NAO_E_PDF");
    if (a.contratoAssinado) return { ok: true as const, mudou: false };
    await definirAnexoDoContrato(tx, projetoId, anexoId);
    await tx.timeline.create({ data: { projetoId, tipo: "HANDOFF", payload: { evento: "contrato_definido", anexoId, nome: a.nome }, usuarioId: por.id } });
    return { ok: true as const, mudou: true };
  });
}

/** Leva o card ao marco Execução pelo mesmo `moverCard` do arraste: a trava é a dele. */
export async function moverParaExecucao(projetoId: string, por: Ator): Promise<{ ok: true; mudou: boolean } | { ok: false; erro: string }> {
  const ex = await db.fase.findUnique({ where: { marco: "EXECUCAO" }, select: { id: true, arquivadaEm: true } });
  if (!ex || ex.arquivadaEm) return { ok: false, erro: MENSAGEM_ERRO_PROJETO.FASE_EXECUCAO_INDISPONIVEL };
  const r = await moverCard(projetoId, ex.id, por);
  return r.ok ? { ok: true, mudou: r.mudou } : { ok: false, erro: textoDoErroProjeto(r) };
}

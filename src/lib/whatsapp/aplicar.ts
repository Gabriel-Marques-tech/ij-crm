/**
 * Aplica a extração da LLM no CRM (design doc §4.3 passo 8) — tudo numa
 * transação que o chamador abre (`processar.ts`). Só `CRIAR` é aplicado
 * nesta fatia; `ATUALIZAR`/`IGNORAR` vão para `PENDENTE_REVISAO`.
 *
 * Duas fases: PLANO (só leitura; decide e pode desistir com PENDENTE sem ter
 * gravado nada) e ESCRITA. Regras de identidade (contrato de GAB-31):
 * - Contato reaproveitado só por telefone/email EXATO citado no texto. Ponto
 *   de contato excluído (`BLOQUEADO_EXCLUIDO`) → PENDENTE, nunca cria.
 *   Pontos que a LLM atribui ao contato só valem se aparecem no texto.
 * - Empresa vinculada automaticamente SÓ por CNPJ (`encontrarEmpresa` →
 *   `via: "cnpj"`). Domínio do email é SUGESTÃO: vai para `sugestoes` e
 *   marca `revisar`, sem vincular. Nome igual a um cadastro existente também
 *   é só sugestão (nunca match por nome).
 * - ids que a LLM devolve só valem se estão entre os candidatos exatos.
 * - Fase pela chave; terminal é recusada (ganho/perdido só por movimento,
 *   como em `criarCard`) → `primeiro_contato` + revisar.
 * - Responsável = remetente; `responsavel_nome` só troca com match exato
 *   (sem acento/caixa) do nome completo de UM usuário ativo.
 */
import type { Origem, Prisma } from "@prisma/client";
import { encontrarContatoPorIdentificador, encontrarEmpresa } from "@/lib/contatos/match";
import { validarNome } from "@/lib/entidades/campos";
import { travarPipelines } from "@/lib/fases/fases";
import { resolverDataRelativa } from "@/lib/llm/datas";
import type { Extracao } from "@/lib/llm/prompts/extracao.v1";
import { lerValorInformal } from "@/lib/llm/valores";
import { ehDominioPublico, normalizarDominio, normalizarPonto, type PontoNormalizado } from "@/lib/normalizacao";
import { inicioDoDia, interpretarCampo } from "@/lib/oportunidades/campos";
import { ErroDeRegra } from "@/lib/oportunidades/erros";
import { criarCardTravado, type NovoCard } from "@/lib/oportunidades/oportunidades";
import { PIPELINE_VENDAS } from "@/lib/oportunidades/terminal-regras";
import type { MotivoPendente, ResumoCriado } from "./confirmacao";
import { extrairIdentificadores } from "./identificadores";

type Tx = Prisma.TransactionClient;

export const FASE_PADRAO_CRIAR = "primeiro_contato";

export type Sugestao =
  | { tipo: "EMPRESA_POR_DOMINIO"; empresaId: string; nome: string }
  | { tipo: "EMPRESA_MESMO_NOME"; empresaId: string; nome: string }
  | { tipo: "CONTATO_MESMO_NOME"; contatoId: string; nome: string };

export type Desfecho =
  | ({
      tipo: "CRIADO";
      oportunidadeId: string;
      contato: { id: string; criado: boolean } | null;
      empresa: { id: string; criada: boolean } | null;
      sugestoes: Sugestao[];
    } & ResumoCriado)
  | { tipo: "PENDENTE"; motivo: MotivoPendente };

export type EntradaAplicacao = {
  mensagem: { id: string; texto: string; recebidaEm: Date; remetenteUsuarioId: string };
  extracao: Extracao;
  limiar: number;
  /** Vai na Timeline MENSAGEM_WHATSAPP (JSON da LLM, versão, modelo). */
  registroLlm: Record<string, unknown>;
};

const VIVO = { deletadoEm: null, mergedIntoId: null } as const;

/** Nome comparável: sem acento, minúsculo, espaços colapsados. */
export function nomeComparavel(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function pendente(motivo: MotivoPendente): Desfecho {
  return { tipo: "PENDENTE", motivo };
}

/** Pontos que a LLM atribuiu ao contato, normalizados, e só se citados no texto. */
function pontosDoContato(ex: Extracao, citados: Set<string>): (PontoNormalizado & { valorOriginal: string })[] {
  const saida: (PontoNormalizado & { valorOriginal: string })[] = [];
  for (const [bruto, tipo] of [
    [ex.contato.telefone, "TELEFONE"],
    [ex.contato.email, "EMAIL"],
  ] as const) {
    if (!bruto) continue;
    const p = normalizarPonto(bruto, tipo);
    if (p && citados.has(p.valorNormalizado)) saida.push({ ...p, valorOriginal: bruto.trim() });
  }
  return saida;
}

export async function aplicarExtracao(tx: Tx, e: EntradaAplicacao): Promise<Desfecho> {
  const ex = e.extracao;
  if (ex.intencao === "ATUALIZAR") return pendente("ATUALIZAR");
  if (ex.intencao === "IGNORAR") return pendente("IGNORAR");

  const motivos: string[] = [];
  const sugestoes: Sugestao[] = [];

  // ---- lock primeiro (ordem global de locks: só o pipeline de vendas)
  const vendas = await tx.pipeline.findUnique({ where: { chave: PIPELINE_VENDAS }, select: { id: true } });
  if (!vendas || !(await travarPipelines(tx, [vendas.id]))) throw new ErroDeRegra("PIPELINE_NAO_ENCONTRADO");

  // ---- PLANO: contato
  const ids = extrairIdentificadores(e.mensagem.texto);
  const citados = new Set([...ids.telefones, ...ids.emails]);
  const candidatosContato = new Map<string, { id: string; nome: string; empresaId: string | null }>();
  const donoDoPonto = new Map<string, string>();
  for (const valor of citados) {
    const m = await encontrarContatoPorIdentificador(valor, tx);
    if (m.tipo === "BLOQUEADO_EXCLUIDO") return pendente("CONTATO_EXCLUIDO");
    if (m.tipo === "ENCONTRADO") {
      candidatosContato.set(m.contato.id, m.contato);
      donoDoPonto.set(valor, m.contato.id);
    }
  }
  const pontos = pontosDoContato(ex, citados);
  const donos = new Set(pontos.map((p) => donoDoPonto.get(p.valorNormalizado)).filter((v): v is string => !!v));
  if (donos.size > 1) return pendente("IDENTIFICADORES_CONFLITANTES");

  let contatoExistente: { id: string; nome: string; empresaId: string | null } | null = null;
  if (donos.size === 1) contatoExistente = candidatosContato.get([...donos][0])!;
  else if (ex.contato.id && candidatosContato.has(ex.contato.id)) contatoExistente = candidatosContato.get(ex.contato.id)!;
  else if (ex.contato.id) motivos.push("contato indicado pela leitura não confere com o CRM");

  const nomeContatoNovo = !contatoExistente && ex.contato.nome ? validarNome(ex.contato.nome) : null;

  // ---- PLANO: empresa (vínculo automático só por CNPJ)
  const porCnpj = new Map<string, { id: string; nome: string }>();
  let cnpjLivre: string | null = null;
  for (const cnpj of ids.cnpjs) {
    const m = await encontrarEmpresa(cnpj, tx);
    if (m?.via === "cnpj") porCnpj.set(m.empresa.id, m.empresa);
    else if (await tx.empresa.findUnique({ where: { cnpj }, select: { id: true } })) return pendente("EMPRESA_EXCLUIDA");
    else cnpjLivre ??= cnpj;
  }
  if (porCnpj.size > 1) return pendente("IDENTIFICADORES_CONFLITANTES");

  let empresaExistente: { id: string; nome: string } | null = porCnpj.size === 1 ? [...porCnpj.values()][0] : null;
  if (!empresaExistente && ex.empresa.id) {
    motivos.push("empresa indicada pela leitura não confere por CNPJ");
  }
  if (!empresaExistente && contatoExistente?.empresaId) {
    empresaExistente = await tx.empresa.findFirst({ where: { id: contatoExistente.empresaId, ...VIVO }, select: { id: true, nome: true } });
  }
  const nomeEmpresaNova = !empresaExistente && ex.empresa.nome ? validarNome(ex.empresa.nome) : null;

  // Domínio de email citado: sugestão, nunca vínculo.
  for (const email of ids.emails) {
    const m = await encontrarEmpresa(email, tx);
    if (m?.via === "dominio" && m.empresa.id !== empresaExistente?.id && !sugestoes.some((s) => "empresaId" in s && s.empresaId === m.empresa.id)) {
      sugestoes.push({ tipo: "EMPRESA_POR_DOMINIO", empresaId: m.empresa.id, nome: m.empresa.nome });
      motivos.push(`empresa “${m.empresa.nome}” sugerida pelo domínio do email`);
    }
  }
  if (nomeEmpresaNova) {
    const igual = await tx.empresa.findFirst({ where: { ...VIVO, nome: { equals: nomeEmpresaNova, mode: "insensitive" } }, select: { id: true, nome: true } });
    if (igual) {
      sugestoes.push({ tipo: "EMPRESA_MESMO_NOME", empresaId: igual.id, nome: igual.nome });
      motivos.push("já existe empresa com esse nome no CRM");
    }
  }
  if (nomeContatoNovo) {
    const igual = await tx.contato.findFirst({ where: { ...VIVO, nome: { equals: nomeContatoNovo, mode: "insensitive" } }, select: { id: true, nome: true } });
    if (igual) {
      sugestoes.push({ tipo: "CONTATO_MESMO_NOME", contatoId: igual.id, nome: igual.nome });
      motivos.push("já existe contato com esse nome no CRM");
    }
  }

  if (!contatoExistente && !nomeContatoNovo && !empresaExistente && !nomeEmpresaNova) return pendente("SEM_NOME");

  // ---- PLANO: fase
  const fases = await tx.fase.findMany({
    where: { pipelineId: vendas.id, arquivadaEm: null },
    orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }],
    select: { id: true, chave: true, nome: true, isTerminal: true },
  });
  let fase = ex.fase_chave ? fases.find((f) => f.chave === ex.fase_chave) : undefined;
  if (fase?.isTerminal) {
    motivos.unshift("fechamento (ganho/perdido) só pelo CRM");
    fase = undefined;
  } else if (ex.fase_chave && !fase) {
    motivos.push(`fase “${ex.fase_chave}” não reconhecida`);
  }
  fase ??= fases.find((f) => f.chave === FASE_PADRAO_CRIAR && !f.isTerminal) ?? fases.find((f) => !f.isTerminal);
  if (!fase) throw new ErroDeRegra("FASE_NAO_ENCONTRADA");

  // ---- PLANO: responsável
  const remetente = await tx.usuario.findFirst({ where: { id: e.mensagem.remetenteUsuarioId, ativo: true }, select: { id: true, nome: true } });
  if (!remetente) throw new ErroDeRegra("RESPONSAVEL_INVALIDO");
  let responsavel = remetente;
  if (ex.responsavel_nome) {
    const alvo = nomeComparavel(ex.responsavel_nome);
    const ativos = await tx.usuario.findMany({ where: { ativo: true }, select: { id: true, nome: true } });
    const iguais = ativos.filter((u) => nomeComparavel(u.nome) === alvo);
    if (iguais.length === 1) responsavel = iguais[0];
    else motivos.push(`responsável “${ex.responsavel_nome.trim()}” não encontrado`);
  }

  // ---- PLANO: campos
  const campos: NonNullable<NovoCard["campos"]> = {};
  const c = ex.campos;
  for (const [nome, campo, rotulo] of [
    [c.dor, "dor", "dor"],
    [c.cidade, "cidade", "cidade"],
    [c.estado, "estado", "estado"],
    [c.proxima_acao, "proximaAcao", "próxima ação"],
  ] as const) {
    if (!nome) continue;
    const r = interpretarCampo(campo, nome);
    if (r.ok) (campos as Record<string, unknown>)[campo] = r.valor;
    else motivos.push(`valor de ${rotulo} inválido`);
  }
  if (c.origem) campos.origem = c.origem as Origem;
  if (c.orcamento_previsto) {
    const v = lerValorInformal(c.orcamento_previsto);
    if (v) campos.orcamentoPrevisto = v;
    else motivos.push("orçamento não entendido");
  }
  let proximaAcaoEm: string | null = null;
  if (c.proxima_acao_em) {
    proximaAcaoEm = resolverDataRelativa(c.proxima_acao_em, e.mensagem.recebidaEm);
    if (proximaAcaoEm) campos.proximaAcaoEm = inicioDoDia(proximaAcaoEm);
    else motivos.push("data da próxima ação não entendida");
  }
  if (ex.confianca < e.limiar) motivos.push("confiança baixa da leitura");
  const revisar = motivos.length > 0;

  // ---- ESCRITA
  let empresa: { id: string; nome: string; criada: boolean } | null = empresaExistente ? { ...empresaExistente, criada: false } : null;
  if (!empresa && nomeEmpresaNova) {
    const dominio = ex.contato.email ? normalizarDominio(ex.contato.email) : null;
    const nova = await tx.empresa.create({
      data: { nome: nomeEmpresaNova, cnpj: cnpjLivre, dominioEmail: dominio && !ehDominioPublico(dominio) ? dominio : null },
      select: { id: true, nome: true },
    });
    empresa = { ...nova, criada: true };
  }

  let contato: { id: string; nome: string; criado: boolean } | null = null;
  if (contatoExistente) {
    contato = { id: contatoExistente.id, nome: contatoExistente.nome, criado: false };
    // Pontos acumulam: os citados que ainda não existem entram no contato reaproveitado.
    const novos = pontos.filter((p) => !donoDoPonto.has(p.valorNormalizado));
    if (novos.length) await tx.contatoPonto.createMany({ data: novos.map((p) => ({ contatoId: contatoExistente.id, ...p })) });
  } else if (nomeContatoNovo) {
    const novo = await tx.contato.create({
      data: { nome: nomeContatoNovo, empresaId: empresa?.id ?? null, pontos: { create: pontos } },
      select: { id: true, nome: true },
    });
    contato = { ...novo, criado: true };
  }

  const titulo = [contato?.nome, empresa?.nome].filter(Boolean).join(" — ");
  const agora = new Date();
  const oportunidadeId = await criarCardTravado(
    tx,
    {
      pipelineId: vendas.id,
      faseId: fase.id,
      titulo,
      responsavelId: responsavel.id,
      via: "WHATSAPP",
      campos: { ...campos, empresaId: empresa?.id ?? null, contatoId: contato?.id ?? null, revisar },
      agora,
    },
    remetente,
  );
  await tx.timeline.create({
    data: {
      oportunidadeId,
      tipo: "MENSAGEM_WHATSAPP",
      usuarioId: remetente.id,
      mensagemBrutaId: e.mensagem.id,
      em: new Date(agora.getTime() + 1),
      payload: { texto: e.mensagem.texto, ...e.registroLlm, motivosRevisar: motivos, sugestoes } as Prisma.InputJsonValue,
    },
  });

  return {
    tipo: "CRIADO",
    oportunidadeId,
    contato: contato ? { id: contato.id, criado: contato.criado } : null,
    empresa: empresa ? { id: empresa.id, criada: empresa.criada } : null,
    sugestoes,
    titulo,
    faseNome: fase.nome,
    responsavelNome: responsavel.nome,
    proximaAcao: (campos.proximaAcao as string | undefined) ?? null,
    proximaAcaoEm,
    revisar,
    motivosRevisar: motivos,
  };
}

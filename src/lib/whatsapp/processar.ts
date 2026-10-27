/**
 * Processamento de uma MensagemBruta `RECEBIDA` pela LLM (design doc §4.3
 * passos 6–10). Disparo e garantias:
 *
 * - O webhook comita a ingestão e agenda `processarMensagem(id)` em
 *   `after()` (mesmo request, depois do 200). O cron de reprocessamento
 *   (GAB-41) chama a MESMA função para linhas que ficaram para trás.
 * - Reivindicação atômica: `UPDATE … SET status = 'PROCESSANDO', tentativas =
 *   tentativas + 1 WHERE id = $1 AND status = 'RECEBIDA' RETURNING tentativas`.
 *   Só quem muda a linha segue; retry/concorrência viram no-op (`IGNORADA`) e
 *   nunca cobram a LLM duas vezes.
 * - Cerca (fencing): a reivindicação vale para a tentativa `n` devolvida. A
 *   1ª instrução da transação de aplicação (e o registro de FALHA) é um
 *   UPDATE condicionado a `status = 'PROCESSANDO' AND tentativas = n`; 0
 *   linhas = outro worker reivindicou depois → desiste sem gravar nem
 *   responder (`IGNORADA`).
 * - Contrato do GAB-41 (reprocessamento): pega RECEBIDA com mais de N min
 *   (o processo pode ter morrido antes do `after()`; o retry da Evolution cai
 *   em DUPLICADO), FALHA, e PROCESSANDO com mais de 5 min (pior caso: LLM
 *   2×30 s + transação). Ao devolver FALHA → RECEBIDA mantém `erro`: é o que
 *   faz a resposta começar com "Reprocessada:".
 * - A LLM roda FORA de qualquer transação (a tx interativa do Prisma expira
 *   em 5s); a aplicação (Empresa/Contato/Oportunidade/Timeline + status) roda
 *   numa transação só.
 * - Falha da LLM ou da aplicação → `FALHA`, `erro` = código + ref,
 *   `registrarErro` loga a causa com a mesma ref (nunca o texto), e o grupo
 *   recebe "❌ … (ref: …)". `resultado_llm` guarda o que deu para guardar.
 * - Uma resposta por tentativa que conclui: a confirmação real substitui o
 *   "recebido"; reprocessar uma ❌ manda uma 2ª ("✅ Reprocessada: …").
 * - `processarMensagem` nunca lança (roda dentro de `after()`): erro de
 *   banco ao carregar ou ao gravar a FALHA é registrado com ref e a linha
 *   fica para o GAB-41.
 * - Mensagem sem `#crm` (`semTag`, GAB-39): `regra-sem-tag.ts` decide antes
 *   de aplicar (IGNORAR confiante apaga a linha; confiança < `LLM_LIMIAR_SEM_TAG`
 *   ou CRIAR sem telefone/email/CNPJ no texto vira pendente, SEM resposta no grupo) e a confirmação de quando age começa
 *   com "↪️ entendi como atualização:".
 */
import { Prisma } from "@prisma/client";
import { modeloDoProvedorConfigurado, limiarConfianca } from "@/lib/config/env";
import { carregarConfigTecnica } from "@/lib/config/tecnica";
import { encontrarContatoPorIdentificador, encontrarEmpresa } from "@/lib/contatos/match";
import { db } from "@/lib/db";
import { registrarErro } from "@/lib/erros/registrar";
import { alertarSeSemCredito, marcarCreditoOk } from "@/lib/llm/alerta-credito";
import { ErroLlm, extrairAtualizacao, type ContextoExtracao, type ResultadoExtracao } from "@/lib/llm/extracao";
import type { ContatoCandidato, EmpresaCandidata } from "@/lib/llm/prompts/extracao.v2";
import { VERSAO_EXTRACAO } from "@/lib/llm/prompts/extracao.v2";
import { ErroDeRegra } from "@/lib/oportunidades/erros";
import { PIPELINE_VENDAS } from "@/lib/oportunidades/terminal-regras";
import { aplicarExtracao, type Desfecho } from "./aplicar";
import { alvoDaResposta, oportunidadesCandidatas, type MotivoRespostaInvalida } from "./candidatas";
import { textoAtualizado, textoAtualizadoSemTag, textoCriado, textoCriadoSemTag, textoFalha, textoPendente } from "./confirmacao";
import { contarDescartada } from "./contadores";
import { enviarWhatsApp } from "./enviar";
import { erroSeguro } from "./erro-seguro";
import { extrairIdentificadores } from "./identificadores";
import { regraSemTag } from "./regra-sem-tag";

export type ResultadoProcessamento =
  | { tipo: "IGNORADA" }
  | { tipo: "PROCESSADA"; oportunidadeId: string; confirmacao: string }
  /** `confirmacao: null` = sem resposta no grupo (mensagem sem #crm pendente, GAB-39). */
  | { tipo: "PENDENTE_REVISAO"; confirmacao: string | null }
  /** Sem #crm e a extração disse IGNORAR: linha apagada, só o contador (GAB-39). */
  | { tipo: "DESCARTADA" }
  | { tipo: "FALHA"; ref: string; codigo: string; confirmacao: string }
  /** Erro inesperado fora do fluxo normal (ex.: banco fora); registrado com ref. */
  | { tipo: "ERRO"; ref: string };

/** Outro worker reivindicou a linha depois de nós: desistir sem gravar nada. */
class CercaPerdida extends Error {
  constructor() {
    super("reivindicação perdida");
    this.name = "CercaPerdida";
  }
}

type Bruta = NonNullable<Awaited<ReturnType<typeof carregar>>>;

function carregar(id: string) {
  return db.mensagemBruta.findUnique({
    where: { id },
    select: {
      id: true,
      eventoId: true,
      grupoJid: true,
      texto: true,
      recebidaEm: true,
      respondendoEventoId: true,
      remetenteTelefone: true,
      remetenteLid: true,
      remetenteUsuarioId: true,
      remetenteUsuario: { select: { nome: true } },
      erro: true,
      semTag: true,
    },
  });
}

/**
 * Contexto do passo 6: remetente, msg respondida, fases de vendas, candidatos
 * por identificador exato e oportunidades candidatas (GAB-38).
 */
export async function montarContexto(
  m: Pick<Bruta, "texto" | "recebidaEm" | "respondendoEventoId" | "remetenteUsuario" | "remetenteUsuarioId"> & { semTag?: boolean },
): Promise<ContextoExtracao & { respostaInvalida: MotivoRespostaInvalida | null }> {
  let respondendoA: string | null = null;
  if (m.respondendoEventoId) {
    const anterior =
      (await db.mensagemBruta.findUnique({ where: { eventoId: m.respondendoEventoId }, select: { texto: true } })) ??
      (await db.mensagemEnviada.findUnique({ where: { eventoId: m.respondendoEventoId }, select: { texto: true } }));
    respondendoA = anterior?.texto ?? null;
  }
  const fases = await db.fase.findMany({
    where: { pipeline: { chave: PIPELINE_VENDAS }, arquivadaEm: null },
    orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }],
    select: { chave: true, nome: true, isTerminal: true },
  });

  const ids = extrairIdentificadores(m.texto);
  const contatos: ContatoCandidato[] = [];
  for (const [valor, via] of [...ids.telefones.map((v) => [v, "telefone"] as const), ...ids.emails.map((v) => [v, "email"] as const)]) {
    const r = await encontrarContatoPorIdentificador(valor);
    if (r.tipo !== "ENCONTRADO" || contatos.some((c) => c.id === r.contato.id)) continue;
    const empresa = r.contato.empresaId ? await db.empresa.findUnique({ where: { id: r.contato.empresaId }, select: { nome: true } }) : null;
    contatos.push({ id: r.contato.id, nome: r.contato.nome, empresa: empresa?.nome ?? null, via });
  }
  const empresas: EmpresaCandidata[] = [];
  for (const valor of [...ids.cnpjs, ...ids.emails]) {
    const r = await encontrarEmpresa(valor);
    if (r && !empresas.some((e) => e.id === r.empresa.id)) empresas.push({ id: r.empresa.id, nome: r.empresa.nome, via: r.via });
  }

  const resposta = await alvoDaResposta(m.respondendoEventoId, m.recebidaEm);
  const alvoResposta = resposta?.tipo === "CARD" ? resposta.id : null;
  const oportunidades = await oportunidadesCandidatas({
    remetenteUsuarioId: m.remetenteUsuarioId,
    recebidaEm: m.recebidaEm,
    contatoIds: contatos.map((c) => c.id),
    empresas,
    alvoResposta,
  });

  return {
    remetente: m.remetenteUsuario?.nome ?? "vendedor",
    recebidaEm: m.recebidaEm,
    respondendoA,
    fases: fases.map((f) => ({ chave: f.chave, nome: f.nome, terminal: f.isTerminal })),
    contatos,
    empresas,
    oportunidades,
    alvoResposta,
    respostaInvalida: resposta?.tipo === "INVALIDA" ? resposta.motivo : null,
    semTag: m.semTag ?? false,
  };
}

/** Código curto e seguro (sem texto) para a coluna `erro` e a resposta. */
function codigoDe(e: unknown): string {
  if (e instanceof ErroLlm) return `LLM_${e.codigo}`;
  if (e instanceof ErroDeRegra) return `REGRA_${e.erro}`;
  if (e instanceof Prisma.PrismaClientKnownRequestError) return `PRISMA_${e.code}`;
  return "INESPERADO";
}

function registroLlm(r: ResultadoExtracao | null, bruto?: unknown, uso?: ResultadoExtracao["uso"]) {
  const u = r?.uso ?? uso;
  return {
    versao: VERSAO_EXTRACAO,
    provedor: u?.provedor ?? null,
    modelo: u?.modelo ?? modeloDoProvedorConfigurado(),
    uso: u ? { tokensEntrada: u.tokensEntrada, tokensSaida: u.tokensSaida, ms: u.ms } : null,
    saida: (r?.bruto ?? bruto ?? null) as Prisma.InputJsonValue | null,
  };
}

function resumoDesfecho(d: Desfecho) {
  if (d.tipo === "PENDENTE") return { tipo: d.tipo, motivo: d.motivo };
  if (d.tipo === "ATUALIZADO") {
    return { tipo: d.tipo, oportunidadeId: d.oportunidadeId, alterados: d.alterados, moveu: d.deFaseNome !== null, revisar: d.revisar, motivosRevisar: d.motivosRevisar, sugestoes: d.sugestoes };
  }
  return {
    tipo: d.tipo,
    oportunidadeId: d.oportunidadeId,
    contato: d.contato,
    empresa: d.empresa,
    revisar: d.revisar,
    motivosRevisar: d.motivosRevisar,
    sugestoes: d.sugestoes,
    ...(d.reabertaDeId ? { reabertaDeId: d.reabertaDeId } : {}),
  };
}

/** JID do remetente para a citação: o do webhook quando houver, senão reconstruído do que foi gravado. */
function participantDe(m: Bruta, participantJid?: string | null): string | undefined {
  if (participantJid) return participantJid;
  if (m.remetenteLid) return m.remetenteLid;
  if (m.remetenteTelefone) return `${m.remetenteTelefone.replace(/\D/g, "")}@s.whatsapp.net`;
  return undefined;
}

async function responder(m: Bruta, texto: string, oportunidadeId: string | null, participantJid?: string | null) {
  try {
    await enviarWhatsApp({
      para: m.grupoJid,
      texto,
      citar: { eventoId: m.eventoId, participant: participantDe(m, participantJid), texto: m.texto },
      oportunidadeId,
    });
  } catch (e) {
    console.error(`[processar] confirmação da mensagem ${m.id} não enviada: ${e instanceof Error ? e.name : typeof e}`);
  }
}

async function falhar(
  m: Bruta,
  tentativa: number,
  e: unknown,
  llm: ReturnType<typeof registroLlm>,
  participantJid?: string | null,
): Promise<ResultadoProcessamento> {
  const ref = registrarErro("processar", erroSeguro(e));
  const codigo = codigoDe(e);
  const motivo = e instanceof ErroLlm ? e.message : codigo;
  const { count } = await db.mensagemBruta.updateMany({
    where: { id: m.id, status: "PROCESSANDO", tentativas: tentativa },
    data: { status: "FALHA", erro: `${motivo} ref=${ref}`, resultadoLlm: { ...llm, aplicacao: { tipo: "FALHA", codigo, ref } } as Prisma.InputJsonValue },
  });
  if (count === 0) return { tipo: "IGNORADA" };
  const confirmacao = textoFalha(ref);
  // GAB-41: já tinha levado ❌ (reprocessamento que falhou de novo) → não repete no grupo.
  if (m.erro === null) await responder(m, confirmacao, null, participantJid);
  await alertarSeSemCredito(e, ref); // GAB-46: avisa ops se for SEM_CREDITO; nunca lança
  return { tipo: "FALHA", ref, codigo, confirmacao };
}

/**
 * Idempotente e seguro para chamar de qualquer lugar (after() do webhook,
 * cron): só processa se conseguir reivindicar a linha. Nunca lança por erro
 * de LLM/aplicação — vira `FALHA`.
 */
export async function processarMensagem(id: string, opts: { participantJid?: string | null } = {}): Promise<ResultadoProcessamento> {
  try {
    // GAB-42: config do Admin > env. Banco fora → não reivindica: fica RECEBIDA para o cron.
    const carga = await carregarConfigTecnica();
    if (!carga.ok) return { tipo: "ERRO", ref: carga.ref };
    return await processar(id, opts);
  } catch (e) {
    const ref = registrarErro("processar", erroSeguro(e));
    return { tipo: "ERRO", ref };
  }
}

async function processar(id: string, opts: { participantJid?: string | null }): Promise<ResultadoProcessamento> {
  const reivindicadas = await db.$queryRaw<{ tentativas: number }[]>`
    UPDATE mensagem_bruta
       SET status = 'PROCESSANDO', tentativas = tentativas + 1, atualizado_em = now()
     WHERE id = ${id} AND status = 'RECEBIDA'
 RETURNING tentativas`;
  if (reivindicadas.length !== 1) return { tipo: "IGNORADA" };
  const tentativa = reivindicadas[0].tentativas;
  const m = (await carregar(id))!;
  // Já tinha terminado em FALHA (❌ enviado) e o GAB-41 devolveu: avisa na resposta.
  const reprocessada = m.erro !== null;

  if (!m.remetenteUsuarioId) return falhar(m, tentativa, new ErroDeRegra("RESPONSAVEL_INVALIDO"), registroLlm(null), opts.participantJid);

  let r: ResultadoExtracao;
  let ctx: Awaited<ReturnType<typeof montarContexto>>;
  try {
    ctx = await montarContexto(m);
    r = await extrairAtualizacao(m.texto, ctx, { ref: m.id });
  } catch (e) {
    return falhar(m, tentativa, e, registroLlm(null, e instanceof ErroLlm ? e.bruto : undefined, e instanceof ErroLlm ? e.uso : undefined), opts.participantJid);
  }
  const llm = registroLlm(r);
  await marcarCreditoOk(); // GAB-46: LLM respondeu → some o banner de sem crédito; nunca lança
  const semTag = regraSemTag(m.semTag, r.extracao, m.texto, undefined, ctx.alvoResposta !== null);

  let desfecho: Desfecho | null;
  try {
    desfecho = await db.$transaction(
      async (tx) => {
        // Cerca: 1ª instrução. Trava a linha até o commit e confirma que a
        // reivindicação ainda é nossa.
        const minha = await tx.$executeRaw`
          UPDATE mensagem_bruta SET atualizado_em = now()
           WHERE id = ${m.id} AND status = 'PROCESSANDO' AND tentativas = ${tentativa}`;
        if (minha !== 1) throw new CercaPerdida();
        if (semTag === "DESCARTAR") {
          await tx.mensagemBruta.delete({ where: { id: m.id } });
          await contarDescartada(tx, m.recebidaEm);
          return null;
        }
        const d: Desfecho =
          semTag === "INCERTO" || semTag === "SEM_IDENTIFICADOR"
            ? { tipo: "PENDENTE", motivo: semTag === "INCERTO" ? "SEM_TAG_INCERTO" : "SEM_TAG_SEM_IDENTIFICADOR" }
            : await aplicarExtracao(tx, {
                mensagem: { id: m.id, texto: m.texto, recebidaEm: m.recebidaEm, remetenteUsuarioId: m.remetenteUsuarioId! },
                extracao: r.extracao,
                limiar: limiarConfianca(),
                registroLlm: llm,
                candidatas: ctx.oportunidades,
                alvoResposta: ctx.alvoResposta,
                respostaInvalida: ctx.respostaInvalida,
              });
        await tx.mensagemBruta.update({
          where: { id: m.id },
          data: {
            status: d.tipo === "PENDENTE" ? "PENDENTE_REVISAO" : "PROCESSADA",
            erro: null,
            resultadoLlm: { ...llm, aplicacao: resumoDesfecho(d) } as Prisma.InputJsonValue,
          },
        });
        return d;
      },
      { timeout: 15_000 },
    );
  } catch (e) {
    if (e instanceof CercaPerdida) return { tipo: "IGNORADA" };
    return falhar(m, tentativa, e, llm, opts.participantJid);
  }

  if (desfecho === null) return { tipo: "DESCARTADA" };
  if (desfecho.tipo === "PENDENTE") {
    // Sem #crm e pendente (incerto, sem identificador, IGNORAR incerto, …):
    // silêncio no grupo — só a fila de revisão (decisão do usuário, GAB-39).
    if (m.semTag) return { tipo: "PENDENTE_REVISAO", confirmacao: null };
    const confirmacao = textoPendente(desfecho.motivo, { reprocessada });
    await responder(m, confirmacao, null, opts.participantJid);
    return { tipo: "PENDENTE_REVISAO", confirmacao };
  }
  const confirmacao =
    desfecho.tipo === "ATUALIZADO"
      ? (m.semTag ? textoAtualizadoSemTag : textoAtualizado)(desfecho, { reprocessada })
      : (m.semTag ? textoCriadoSemTag : textoCriado)(desfecho, { reprocessada });
  await responder(m, confirmacao, desfecho.oportunidadeId, opts.participantJid);
  return { tipo: "PROCESSADA", oportunidadeId: desfecho.oportunidadeId, confirmacao };
}

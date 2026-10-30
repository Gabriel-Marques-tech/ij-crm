/**
 * Peças comuns de `aplicar.ts` (CRIAR, GAB-34) e `atualizar.ts` (ATUALIZAR,
 * GAB-38): tipos do desfecho, pontos citados, campos interpretados e
 * responsável. Tudo determinístico; nada aqui confia em id vindo da LLM.
 */
import type { Origem, Prisma } from "@prisma/client";
import { QUEM_ATUA } from "@/lib/auth/papeis";
import { resolverDataRelativa } from "@/lib/llm/datas";
import type { Extracao } from "@/lib/llm/prompts/extracao.v2";
import { lerValorInformal } from "@/lib/llm/valores";
import { valoresNoTexto } from "./fechamento";
import { normalizarPonto, type PontoNormalizado } from "@/lib/normalizacao";
import { inicioDoDia, interpretarCampo } from "@/lib/projetos/campos";
import { ErroDeRegra } from "@/lib/projetos/erros";
import type { NovoCard } from "@/lib/projetos/projetos";
import type { Candidata } from "./alvo";
import type { MotivoRespostaInvalida } from "./candidatas";
import type { MotivoPendente, ResumoAtualizado, ResumoCriado } from "./confirmacao";

export type Tx = Prisma.TransactionClient;

export type Sugestao =
  | { tipo: "EMPRESA_POR_DOMINIO"; empresaId: string; nome: string }
  | { tipo: "EMPRESA_MESMO_NOME"; empresaId: string; nome: string }
  /** CNPJ citado é de outra empresa do CRM que não a do card (GAB-38: não troca sozinho). */
  | { tipo: "EMPRESA_POR_CNPJ"; empresaId: string; nome: string }
  /** Nome de empresa lido difere do vínculo atual (GAB-38: só sugestão). */
  | { tipo: "EMPRESA_NOME_LIDO"; nome: string }
  | { tipo: "CONTATO_MESMO_NOME"; contatoId: string; nome: string };

export type Desfecho =
  | ({
      tipo: "CRIADO";
      projetoId: string;
      contato: { id: string; criado: boolean } | null;
      empresa: { id: string; criada: boolean } | null;
      sugestoes: Sugestao[];
      /** Card fechado que este reabre (ATUALIZAR de um card ganho/perdido). */
      reabertaDeId?: string;
    } & ResumoCriado)
  | ({
      tipo: "ATUALIZADO";
      projetoId: string;
      /** Campos/vínculos que mudaram, na ordem em que foram gravados. */
      alterados: string[];
      sugestoes: Sugestao[];
    } & ResumoAtualizado)
  | { tipo: "PENDENTE"; motivo: MotivoPendente };

export type EntradaAplicacao = {
  mensagem: { id: string; texto: string; recebidaEm: Date; remetenteUsuarioId: string };
  extracao: Extracao;
  limiar: number;
  /** Vai na Timeline MENSAGEM_WHATSAPP (JSON da LLM, versão, modelo). */
  registroLlm: Record<string, unknown>;
  /**
   * Projetos candidatos que foram no contexto da LLM. `oportunidade_id`
   * só vale se estiver aqui (GAB-38). Ausente = nenhuma.
   */
  candidatas?: Pick<Candidata, "id" | "tocadaEm" | "via">[];
  /** Card da confirmação do bot que a mensagem responde: fixa o alvo. */
  alvoResposta?: string | null;
  /** Reply a confirmação de card que não vale mais (antiga/removido): vai para revisão, nunca CRIAR. */
  respostaInvalida?: MotivoRespostaInvalida | null;
};

export const FASE_PADRAO_CRIAR = "primeiro_contato";

export const VIVO = { deletadoEm: null, mergedIntoId: null } as const;

/** Nome comparável: sem acento, minúsculo, espaços colapsados. */
export function nomeComparavel(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function pendente(motivo: MotivoPendente): Desfecho {
  return { tipo: "PENDENTE", motivo };
}

export type PontoNovo = PontoNormalizado & { valorOriginal: string };

/**
 * Pontos a gravar: os identificadores citados no texto. O valor original é o
 * que a LLM devolveu quando ele normaliza para o mesmo valor; senão o próprio
 * valor normalizado.
 */
export function pontosCitados(ex: Extracao, ids: { telefones: string[]; emails: string[] }): PontoNovo[] {
  const original = new Map<string, string>();
  for (const [bruto, tipo] of [
    [ex.contato.telefone, "TELEFONE"],
    [ex.contato.email, "EMAIL"],
  ] as const) {
    const p = bruto ? normalizarPonto(bruto, tipo) : null;
    if (p) original.set(p.valorNormalizado, bruto!.trim());
  }
  return [
    ...ids.telefones.map((v) => ({ tipo: "TELEFONE" as const, valorNormalizado: v, valorOriginal: original.get(v) ?? v })),
    ...ids.emails.map((v) => ({ tipo: "EMAIL" as const, valorNormalizado: v, valorOriginal: original.get(v) ?? v })),
  ];
}

export type CamposInterpretados = {
  campos: NonNullable<NovoCard["campos"]>;
  /** `YYYY-MM-DD` resolvido de `proxima_acao_em`. */
  proximaAcaoEm: string | null;
};

export const MOTIVO_ORCAMENTO_FORA_DO_TEXTO = "orçamento não está escrito nesta mensagem (não copiei do histórico)";
export const MOTIVO_DATA_FORA_DO_TEXTO = "data da próxima ação não está escrita nesta mensagem (não copiei do histórico)";

const semAcento = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Campos de texto/dinheiro/data da LLM → valores gravíveis. Só entra o que
 * veio (null nunca vira "apagar"). Valor que não dá para entender vira motivo
 * de revisão, nunca chute.
 *
 * GAB-49: com o histórico de 12 h no prompt, a LLM poderia copiar valor/data
 * de mensagens anteriores. Dinheiro e data só entram se estiverem ANCORADOS
 * no texto da mensagem atual — dinheiro pelo mesmo parser do ganho
 * (`valoresNoTexto`), data pela expressão escrita (a LLM copia o trecho como
 * está); senão o campo cai e vira motivo de revisão. Texto livre (próxima
 * ação, dor…) não é ancorado.
 */
export function interpretarCamposExtracao(ex: Extracao, recebidaEm: Date, motivos: string[], textoMensagem: string): CamposInterpretados {
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
    if (r.ok) {
      if (r.valor !== null) (campos as Record<string, unknown>)[campo] = r.valor;
    } else motivos.push(`valor de ${rotulo} inválido`);
  }
  if (c.origem) campos.origem = c.origem as Origem;
  if (c.orcamento_previsto) {
    const v = lerValorInformal(c.orcamento_previsto);
    if (!v) motivos.push("orçamento não entendido");
    else if (!valoresNoTexto(textoMensagem).has(v)) motivos.push(MOTIVO_ORCAMENTO_FORA_DO_TEXTO);
    else campos.orcamentoPrevisto = v;
  }
  let proximaAcaoEm: string | null = null;
  if (c.proxima_acao_em && !semAcento(textoMensagem).includes(semAcento(c.proxima_acao_em))) {
    motivos.push(MOTIVO_DATA_FORA_DO_TEXTO);
  } else if (c.proxima_acao_em) {
    proximaAcaoEm = resolverDataRelativa(c.proxima_acao_em, recebidaEm);
    if (proximaAcaoEm) campos.proximaAcaoEm = inicioDoDia(proximaAcaoEm);
    else motivos.push("data da próxima ação não entendida");
  }
  return { campos, proximaAcaoEm };
}

/**
 * Remetente (ativo) e responsável: `responsavel_nome` só troca com match
 * exato (sem acento/caixa) do nome completo de UM usuário ativo. VISUALIZADOR
 * não é remetente nem responsável (`QUEM_ATUA`).
 */
export async function remetenteEResponsavel(
  tx: Tx,
  ex: Extracao,
  remetenteUsuarioId: string,
  motivos: string[],
): Promise<{ remetente: { id: string; nome: string }; responsavel: { id: string; nome: string } | null }> {
  const remetente = await tx.usuario.findFirst({ where: { id: remetenteUsuarioId, ativo: true, ...QUEM_ATUA }, select: { id: true, nome: true } });
  if (!remetente) throw new ErroDeRegra("RESPONSAVEL_INVALIDO");
  if (!ex.responsavel_nome) return { remetente, responsavel: null };
  const alvo = nomeComparavel(ex.responsavel_nome);
  const ativos = await tx.usuario.findMany({ where: { ativo: true, ...QUEM_ATUA }, select: { id: true, nome: true } });
  const iguais = ativos.filter((u) => nomeComparavel(u.nome) === alvo);
  if (iguais.length === 1) return { remetente, responsavel: iguais[0] };
  motivos.push("responsável indicado não encontrado");
  return { remetente, responsavel: null };
}

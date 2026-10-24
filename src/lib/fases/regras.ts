/**
 * Regras puras de pipelines/fases (design doc §4.2, GAB-27). Sem banco: o
 * serviço (`fases.ts`) carrega os dados e delega as decisões para cá.
 * Regras do sistema referenciam `chave`, nunca posição.
 */
import type { TipoTerminal } from "@prisma/client";

export type ErroFase =
  | "PIPELINE_NAO_ENCONTRADO"
  | "FASE_NAO_ENCONTRADA"
  | "FASE_ARQUIVADA"
  | "NOME_INVALIDO"
  | "COR_INVALIDA"
  | "LIMITE_INVALIDO"
  | "ORDEM_INVALIDA"
  | "TERMINAL_GANHO_OBRIGATORIO"
  | "TERMINAL_PERDIDO_OBRIGATORIO"
  | "DESTINO_OBRIGATORIO"
  | "DESTINO_INVALIDO"
  | "FASE_EM_USO";

/** Pipeline cuja regra de negócio exige também uma fase PERDIDO (§4.2). */
export const PIPELINE_VENDAS = "vendas";

/**
 * Paleta muted de fases (§4.5.1): as cores do seed do Pipefy, oferecidas como
 * atalhos no seletor. É dado de domínio (cor da fase), não token de UI.
 */
export const PALETA_FASES = [
  "#8a5cf6",
  "#4cc9f0",
  "#f042b6",
  "#ff8655",
  "#ffc857",
  "#ff4d3a",
  "#b447eb",
  "#1e9b6b",
  "#6b7280",
] as const;

/** Nome → chave snake_case ASCII. Imutável depois de criada. */
export function chaveDeNome(nome: string): string {
  const base = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || "fase";
}

/** Garante unicidade por pipeline (contando arquivadas: a unique é no banco). */
export function chaveUnica(chave: string, existentes: Iterable<string>): string {
  const usadas = new Set(existentes);
  if (!usadas.has(chave)) return chave;
  for (let n = 2; ; n++) {
    const candidata = `${chave}_${n}`;
    if (!usadas.has(candidata)) return candidata;
  }
}

/** Só `#rrggbb`; devolve normalizada em minúsculas ou null. */
export function validarCor(cor: string): string | null {
  return /^#[0-9a-fA-F]{6}$/.test(cor) ? cor.toLowerCase() : null;
}

/**
 * Terminais obrigatórios entre as fases ATIVAS de um pipeline: `vendas` precisa
 * de ≥1 GANHO e ≥1 PERDIDO; os demais, ≥1 GANHO.
 */
export function validarTerminais(
  pipelineChave: string,
  fasesAtivas: readonly { tipoTerminal: TipoTerminal | null }[],
): ErroFase | null {
  const tem = (t: TipoTerminal) => fasesAtivas.some((f) => f.tipoTerminal === t);
  if (!tem("GANHO")) return "TERMINAL_GANHO_OBRIGATORIO";
  if (pipelineChave === PIPELINE_VENDAS && !tem("PERDIDO")) return "TERMINAL_PERDIDO_OBRIGATORIO";
  return null;
}

/** A nova ordem precisa ser uma permutação exata das fases ativas atuais. */
export function validarReordenacao(idsAtuais: readonly string[], idsNovos: readonly string[]): boolean {
  if (idsAtuais.length !== idsNovos.length) return false;
  const atuais = new Set(idsAtuais);
  const vistos = new Set<string>();
  for (const id of idsNovos) {
    if (!atuais.has(id) || vistos.has(id)) return false;
    vistos.add(id);
  }
  return true;
}

export type AcaoRemocao = "EXCLUIR" | "ARQUIVAR";

/**
 * Decide o que acontece ao "remover" uma fase:
 * - com cards → exige destino (mesmo pipeline, ativo, diferente); os cards
 *   migram e a fase é ARQUIVADA (a migração gera histórico com `de_fase_id`);
 * - sem cards mas com qualquer transição → ARQUIVAR (`de_fase_id` é RESTRICT);
 * - sem cards e sem transições → EXCLUIR de verdade.
 */
export function validarRemocao(input: {
  fase: { id: string; pipelineId: string };
  qtdCards: number;
  qtdTransicoes: number;
  destino: { id: string; pipelineId: string; arquivadaEm: Date | null } | null;
}): { ok: true; acao: AcaoRemocao } | { ok: false; erro: ErroFase } {
  const { fase, qtdCards, qtdTransicoes, destino } = input;
  if (qtdCards > 0) {
    if (!destino) return { ok: false, erro: "DESTINO_OBRIGATORIO" };
    if (destino.id === fase.id || destino.pipelineId !== fase.pipelineId || destino.arquivadaEm !== null) {
      return { ok: false, erro: "DESTINO_INVALIDO" };
    }
  }
  return { ok: true, acao: qtdCards > 0 || qtdTransicoes > 0 ? "ARQUIVAR" : "EXCLUIR" };
}

/**
 * Descrição livre do card. Módulo puro (só zod) para poder ir ao cliente.
 */
import { z } from "zod";
import { cortarTexto } from "@/lib/texto";

export const DESCRICAO_MAX = 5000;

/**
 * Descrição livre do card: aparada nas pontas (quebras de linha internas
 * ficam), vazia → null, até `DESCRICAO_MAX`. Texto puro: a tela não
 * interpreta HTML nem markdown.
 */
export const descricaoSchema = z
  .string()
  .nullish()
  .transform((v) => v?.trim() ?? "")
  .pipe(z.string().max(DESCRICAO_MAX, `Descrição: no máximo ${DESCRICAO_MAX} caracteres.`))
  .transform((v) => (v === "" ? null : v));

/** Tamanho da prévia que vai ao quadro e à Timeline (o texto inteiro só no detalhe do card). */
export const PREVIA_DESCRICAO = 300;

/** Prévia (≤ `PREVIA_DESCRICAO`, sem partir emoji). */
export function previaDescricao(v: string): { texto: string; truncado: boolean } {
  return cortarTexto(v, PREVIA_DESCRICAO);
}

/**
 * Payload de Timeline de uma mudança na descrição: antes/depois viram prévia;
 * `truncado: true` se algum dos dois foi cortado (o histórico não guarda 2×5000).
 */
export function mudancaDescricao<C extends string>(
  campo: C,
  antes: string | null,
  depois: string | null,
): { campo: C; antes: string | null; depois: string | null; truncado?: true } {
  const a = antes === null ? null : previaDescricao(antes);
  const d = depois === null ? null : previaDescricao(depois);
  return { campo, antes: a?.texto ?? null, depois: d?.texto ?? null, ...(a?.truncado || d?.truncado ? { truncado: true as const } : {}) };
}

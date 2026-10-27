/**
 * Descrição livre do card. Módulo puro (só zod) para poder ir ao cliente.
 */
import { z } from "zod";

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

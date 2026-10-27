/**
 * Configuração chave → JSON (tabela `configuracao`, GAB-44), parte pura.
 * Cada chave declara schema zod + padrão; o banco guarda só o JSON. Linha
 * ausente ou que não passa no schema (versão antiga, edição manual) = padrão,
 * nunca erro na leitura — a linha inválida é logada com ref (`servico.ts`). Reaproveitável pela config técnica (GAB-42): basta
 * declarar outra chave com `definirConfiguracao`.
 */
import type { z } from "zod";

export type DefinicaoConfiguracao<T> = {
  chave: string;
  schema: z.ZodType<T>;
  padrao: T;
};

export function definirConfiguracao<T>(chave: string, schema: z.ZodType<T>, padrao: T): DefinicaoConfiguracao<T> {
  if (!/^[a-z][a-z0-9_.]*$/.test(chave)) throw new Error(`chave de configuração inválida: ${chave}`);
  return { chave, schema, padrao };
}


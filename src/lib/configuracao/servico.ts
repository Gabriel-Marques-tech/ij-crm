/**
 * Leitura/gravação da tabela `configuracao` (GAB-44). Permissão é de quem
 * chama (cada chave tem a sua: ranking = GESTOR+, técnica = ADMIN no GAB-42);
 * aqui só validação e persistência.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { lerValor, type DefinicaoConfiguracao } from "./definicao";

export type ConfiguracaoLida<T> = { valor: T; atualizadoEm: Date | null; atualizadoPor: string | null; padrao: boolean };

export async function obterConfiguracao<T>(def: DefinicaoConfiguracao<T>): Promise<ConfiguracaoLida<T>> {
  const linha = await db.configuracao.findUnique({ where: { chave: def.chave } });
  if (!linha) return { valor: def.padrao, atualizadoEm: null, atualizadoPor: null, padrao: true };
  return { valor: lerValor(def, linha.valor), atualizadoEm: linha.atualizadoEm, atualizadoPor: linha.atualizadoPor, padrao: false };
}

export type ResultadoSalvar<T> = { ok: true; valor: T } | { ok: false; erro: "DADOS_INVALIDOS"; campo: string | null; mensagem: string };

/** Valida com o schema da chave e grava (upsert). Nada é gravado se inválido. */
export async function salvarConfiguracao<T>(def: DefinicaoConfiguracao<T>, entrada: unknown, porId: string): Promise<ResultadoSalvar<T>> {
  const r = def.schema.safeParse(entrada);
  if (!r.success) {
    const issue = r.error.issues[0];
    return { ok: false, erro: "DADOS_INVALIDOS", campo: issue?.path.join(".") || null, mensagem: issue?.message ?? "Dados inválidos." };
  }
  const valor = r.data as Prisma.InputJsonValue;
  await db.configuracao.upsert({
    where: { chave: def.chave },
    create: { chave: def.chave, valor, atualizadoPor: porId },
    update: { valor, atualizadoPor: porId, atualizadoEm: new Date() },
  });
  return { ok: true, valor: r.data };
}

/** Volta ao padrão do código apagando a linha. */
export async function restaurarConfiguracao<T>(def: DefinicaoConfiguracao<T>): Promise<void> {
  await db.configuracao.deleteMany({ where: { chave: def.chave } });
}

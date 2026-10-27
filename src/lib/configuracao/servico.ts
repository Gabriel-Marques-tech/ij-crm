/**
 * Leitura/gravação da tabela `configuracao` (GAB-44). Permissão é de quem
 * chama (cada chave tem a sua: ranking = GESTOR+, técnica = ADMIN no GAB-42);
 * aqui só validação, persistência e concorrência otimista.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { registrarErro } from "@/lib/erros/registrar";
import type { DefinicaoConfiguracao } from "./definicao";

export type ConfiguracaoLida<T> = {
  valor: T;
  /** Versão para a concorrência otimista (a da linha, mesmo inválida). */
  atualizadoEm: Date | null;
  atualizadoPor: string | null;
  /** true = o valor em uso é o padrão do código (sem linha ou linha inválida). */
  padrao: boolean;
  /** Há linha, mas ela não passa no schema: está sendo ignorada. */
  invalido: boolean;
};

export async function obterConfiguracao<T>(def: DefinicaoConfiguracao<T>): Promise<ConfiguracaoLida<T>> {
  const linha = await db.configuracao.findUnique({ where: { chave: def.chave } });
  if (!linha) return { valor: def.padrao, atualizadoEm: null, atualizadoPor: null, padrao: true, invalido: false };
  const r = def.schema.safeParse(linha.valor);
  if (!r.success) {
    // Só a chave e os caminhos com problema: nunca o valor gravado.
    const caminhos = [...new Set(r.error.issues.map((i) => i.path.join(".") || "(raiz)"))].join(",");
    registrarErro(`configuracao.${def.chave}`, new Error(`valor salvo não passa no schema (campos: ${caminhos}); usando o padrão`));
    return { valor: def.padrao, atualizadoEm: linha.atualizadoEm, atualizadoPor: linha.atualizadoPor, padrao: true, invalido: true };
  }
  return { valor: r.data, atualizadoEm: linha.atualizadoEm, atualizadoPor: linha.atualizadoPor, padrao: false, invalido: false };
}

export type ResultadoSalvar<T> =
  | { ok: true; valor: T }
  | { ok: false; erro: "DADOS_INVALIDOS"; campo: string | null; mensagem: string }
  | { ok: false; erro: "CONFLITO" };

/** Texto do conflito, para as telas que salvam configuração. */
export const MENSAGEM_CONFLITO_CONFIGURACAO = "Outra pessoa alterou esta configuração. Recarregue para ver os valores atuais.";

/**
 * Valida com o schema da chave e grava. `versao` = o `atualizado_em` que quem
 * edita carregou (null = não havia linha). Gravação condicional: se a linha
 * mudou (ou passou a existir) desde então, devolve `CONFLITO` e não grava.
 */
export async function salvarConfiguracao<T>(def: DefinicaoConfiguracao<T>, entrada: unknown, porId: string, versao: Date | null): Promise<ResultadoSalvar<T>> {
  const r = def.schema.safeParse(entrada);
  if (!r.success) {
    const issue = r.error.issues[0];
    return { ok: false, erro: "DADOS_INVALIDOS", campo: issue?.path.join(".") || null, mensagem: issue?.message ?? "Dados inválidos." };
  }
  const valor = r.data as Prisma.InputJsonValue;
  if (versao === null) {
    try {
      await db.configuracao.create({ data: { chave: def.chave, valor, atualizadoPor: porId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { ok: false, erro: "CONFLITO" };
      throw e;
    }
    return { ok: true, valor: r.data };
  }
  const { count } = await db.configuracao.updateMany({
    where: { chave: def.chave, atualizadoEm: versao },
    data: { valor, atualizadoPor: porId, atualizadoEm: new Date() },
  });
  return count === 1 ? { ok: true, valor: r.data } : { ok: false, erro: "CONFLITO" };
}

/**
 * Volta ao padrão do código apagando a linha. Com `versao` (o `atualizado_em`
 * carregado; null = não havia linha) só apaga se a linha não mudou desde
 * então — `false` = conflito. Sem `versao`, apaga incondicionalmente.
 */
export async function restaurarConfiguracao<T>(def: DefinicaoConfiguracao<T>, versao?: Date | null): Promise<boolean> {
  if (versao === undefined) {
    await db.configuracao.deleteMany({ where: { chave: def.chave } });
    return true;
  }
  if (versao === null) return (await db.configuracao.count({ where: { chave: def.chave } })) === 0;
  const { count } = await db.configuracao.deleteMany({ where: { chave: def.chave, atualizadoEm: versao } });
  return count === 1;
}

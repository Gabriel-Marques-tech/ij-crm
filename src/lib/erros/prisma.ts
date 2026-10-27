/**
 * Descrição segura de erro do Prisma: a `message` de qualquer classe ecoa
 * argumentos da query (emails, hashes, textos de card), então só sai a classe,
 * `code`, `meta.target`/`meta.modelName` e os NOMES das outras chaves de `meta`.
 *
 * Sem imports do Next: `src/lib/db.ts` (usado também por scripts) depende daqui.
 */
import { Prisma } from "@prisma/client";

/** Descrição segura se `e` é erro do Prisma; senão `null`. */
export function descreverErroPrisma(e: unknown): string | null {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = (e.meta ?? {}) as { target?: unknown; modelName?: unknown };
    const partes = [`Prisma ${e.code}`];
    if (meta.modelName !== undefined) partes.push(`model=${String(meta.modelName)}`);
    if (meta.target !== undefined) partes.push(`target=${Array.isArray(meta.target) ? meta.target.join(",") : String(meta.target)}`);
    const outras = Object.keys(meta).filter((k) => k !== "target" && k !== "modelName");
    if (outras.length > 0) partes.push(`meta=${outras.join(",")}`);
    return partes.join(" ");
  }
  if (e instanceof Prisma.PrismaClientInitializationError) return [e.name, e.errorCode].filter(Boolean).join(" ");
  if (
    e instanceof Prisma.PrismaClientValidationError ||
    e instanceof Prisma.PrismaClientUnknownRequestError ||
    e instanceof Prisma.PrismaClientRustPanicError
  ) {
    return e.name;
  }
  return null;
}

/**
 * Troca, no PRÓPRIO erro, `message` e a 1ª linha do `stack` pela descrição
 * segura. Mantém classe, `code`, `meta`, `clientVersion` (instanceof e o
 * tratamento de P2002 por `meta.target` seguem funcionando). Assim nem o log
 * padrão do Next (que imprime o erro original) vaza os argumentos.
 */
export function sanitizarErroPrisma(e: unknown): void {
  const descricao = descreverErroPrisma(e);
  if (descricao === null) return;
  const err = e as Error;
  const frames = (err.stack ?? "").split("\n").filter((l) => /^\s+at\s/.test(l));
  err.message = descricao;
  err.stack = [`${err.name}: ${descricao}`, ...frames].join("\n");
}

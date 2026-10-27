/**
 * Descrição segura de erro do Prisma: a `message` de qualquer classe ecoa
 * argumentos da query (emails, hashes, textos de card), então só sai a classe,
 * `code`, `meta.target`/`meta.modelName` e os NOMES das outras chaves de `meta`.
 *
 * Sem imports do Next nem alias `@/`: `src/lib/db.ts` depende daqui, e o `db`
 * também roda fora do Next (seed, `scripts/*.ts` via tsx).
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

/** Chaves de `meta` que só têm nomes de estrutura (tabela/campo/restrição). */
const META_ESTRUTURAL = new Set(["target", "modelName", "field_name", "table", "column", "constraint"]);
/** Chaves que só ficam se o valor for um código (`23505`, `P2025`), nunca texto. */
const META_CODIGO = new Set(["code", "cause"]);
const CODIGO = /^[\w.-]{1,40}$/;

/**
 * `meta` sem texto livre: o Postgres põe o valor em `meta.message` (ex.:
 * `Key (email)=(ana@...) already exists` num SQL cru). `target` intacto — o
 * tratamento de P2002 no app depende dele.
 */
function metaSegura(meta: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(meta).filter(([k, v]) => META_ESTRUTURAL.has(k) || (META_CODIGO.has(k) && typeof v === "string" && CODIGO.test(v))),
  );
}

/**
 * Troca, no PRÓPRIO erro, `message` e a 1ª linha do `stack` pela descrição
 * segura e limpa `meta`. Mantém classe, `code`, `meta.target`, `clientVersion` (instanceof e o
 * tratamento de P2002 por `meta.target` seguem funcionando). Assim nem o log
 * padrão do Next (que imprime o erro original) vaza os argumentos.
 */
export function sanitizarErroPrisma(e: unknown): void {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.meta) e.meta = metaSegura(e.meta);
  const descricao = descreverErroPrisma(e);
  if (descricao === null) return;
  const err = e as Error;
  const frames = (err.stack ?? "").split("\n").filter((l) => /^\s+at\s/.test(l));
  err.message = descricao;
  err.stack = [`${err.name}: ${descricao}`, ...frames].join("\n");
}

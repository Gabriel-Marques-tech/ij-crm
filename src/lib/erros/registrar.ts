/**
 * Erro inesperado do servidor → linha de log rastreável + `ref` curta que o
 * usuário vê na tela e repassa. Para achar: `grep 'ref=<ref>'` nos logs.
 *
 * Nunca loga `e.message` de erro do Prisma (qualquer classe): ele ecoa
 * argumentos da query (emails, hashes, textos de card). Só a classe, `code`,
 * `meta.target`/`meta.modelName` e os NOMES das outras chaves de `meta`.
 */
import { Prisma } from "@prisma/client";
import { unstable_rethrow } from "next/navigation";

const FRAMES = 3;

export function descreverErro(e: unknown): string {
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
  if (e instanceof Error) {
    const frames = (e.stack ?? "")
      .split("\n")
      .filter((l) => /^\s+at\s/.test(l))
      .slice(0, FRAMES)
      .map((l) => l.trim());
    return [`${e.name}: ${e.message}`, ...frames].join(" | ");
  }
  return `lançado valor não-Error (${typeof e})`;
}

/** Loga `[contexto] ref=<ref> <descrição>` e devolve a ref (8 hex). */
export function registrarErro(contexto: string, e: unknown): string {
  const ref = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  console.error(`[${contexto}] ref=${ref} ${descreverErro(e)}`);
  return ref;
}

export type Inesperado = { ok: false; erro: "INESPERADO"; ref: string };

/** Resultado de `comTratamento` que falhou (para páginas que envolvem leituras e mostram a ref). */
export function ehInesperado(r: unknown): r is Inesperado {
  return typeof r === "object" && r !== null && (r as { erro?: unknown }).erro === "INESPERADO" && typeof (r as { ref?: unknown }).ref === "string";
}

/**
 * Envolve o corpo de uma server action: exceção inesperada vira
 * `{ ok: false, erro: "INESPERADO", ref }` (e log). `redirect`/`notFound`
 * do Next (e afins) são relançados intactos. Erros de regra continuam sendo
 * retornados pelo próprio corpo, como antes.
 */
export async function comTratamento<T>(contexto: string, corpo: () => Promise<T>): Promise<T | Inesperado> {
  try {
    return await corpo();
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, erro: "INESPERADO", ref: registrarErro(contexto, e) };
  }
}

/** Para actions de formulário que só exibem `erro` como texto (Gestão, perfil, login). */
export function mensagemInesperada(ref: string): string {
  return `Erro no servidor (ref: ${ref}). Tente de novo; se persistir, informe a ref.`;
}

/** Variante de `comTratamento` para estados `{ erro?: string }`: a ref vai no texto. */
export async function comTratamentoForm<T extends { erro?: string } | undefined | void>(
  contexto: string,
  corpo: () => Promise<T>,
): Promise<T | { erro: string; ref: string }> {
  const r = await comTratamento(contexto, corpo);
  if (r && typeof r === "object" && "erro" in r && r.erro === "INESPERADO" && "ref" in r) {
    return { erro: mensagemInesperada(r.ref as string), ref: r.ref as string };
  }
  return r as T;
}

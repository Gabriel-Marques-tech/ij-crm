/**
 * Erro inesperado do servidor → linha de log rastreável + `ref` curta que o
 * usuário vê na tela e repassa. Para achar: `grep 'ref=<ref>'` nos logs.
 *
 * Nunca loga `e.message` de erro do Prisma (ver `./prisma.ts`); a de `Error`
 * genérico vai redigida (`redigirPii`: emails, telefones, CPF/CNPJ, tokens).
 */
import { unstable_rethrow } from "next/navigation";
import { descreverErroPrisma } from "./prisma";
import { redigirPii } from "./redigir";

const FRAMES = 3;

/**
 * `nome: mensagem` sem PII, sem stack — para log e para saída de CLI/scripts.
 * Erro do Prisma: só a descrição estrutural (a mensagem ecoa a query).
 */
export function mensagemSegura(e: unknown): string {
  const prisma = descreverErroPrisma(e);
  if (prisma !== null) return prisma;
  if (e instanceof Error) return e.message ? `${e.name}: ${redigirPii(e.message)}` : e.name;
  return `lançado valor não-Error (${typeof e})`;
}

export function descreverErro(e: unknown): string {
  const prisma = descreverErroPrisma(e);
  if (prisma !== null) return prisma;
  if (e instanceof Error) {
    const frames = (e.stack ?? "")
      .split("\n")
      .filter((l) => /^\s+at\s/.test(l))
      .slice(0, FRAMES)
      .map((l) => l.trim());
    const causa = descreverErroPrisma(e.cause);
    return [mensagemSegura(e), ...(causa ? [`cause=${causa}`] : []), ...frames].join(" | ");
  }
  return `lançado valor não-Error (${typeof e})`;
}

/**
 * Loga `[contexto] ref=<ref> <descrição>` e devolve a ref (8 hex, ou a recebida:
 * o `digest` do Next, que é o que o error boundary mostra ao usuário).
 */
export function registrarErro(contexto: string, e: unknown, refDada?: string): string {
  const ref = refDada ?? crypto.randomUUID().replace(/-/g, "").slice(0, 8);
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

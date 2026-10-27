/**
 * Erro inesperado do servidor → linha de log rastreável + `ref` curta que o
 * usuário vê na tela e repassa. Para achar: `grep 'ref=<ref>'` nos logs.
 *
 * Nunca loga `e.message` de erro do Prisma (ver `./prisma.ts`) nem de `Error`
 * genérico; só das classes em `MENSAGEM_SEGURA`.
 */
import { unstable_rethrow } from "next/navigation";
import { descreverErroPrisma } from "./prisma";

const FRAMES = 3;

/**
 * Classes do projeto cuja `message` é montada só com códigos/nomes de variável
 * (nunca dado pessoal): a mensagem delas vai ao log. Qualquer outro `Error`
 * loga só o nome + frames — a mensagem pode trazer email/telefone/texto.
 */
export const MENSAGEM_SEGURA = new Set(["ConfigAusente", "ConfigInvalida", "ConfigFraca", "ErroLlm"]);

export function descreverErro(e: unknown): string {
  const prisma = descreverErroPrisma(e);
  if (prisma !== null) return prisma;
  if (e instanceof Error) {
    const frames = (e.stack ?? "")
      .split("\n")
      .filter((l) => /^\s+at\s/.test(l))
      .slice(0, FRAMES)
      .map((l) => l.trim());
    const cabeca = MENSAGEM_SEGURA.has(e.name) ? `${e.name}: ${e.message}` : e.name;
    const causa = descreverErroPrisma(e.cause);
    return [cabeca, ...(causa ? [`cause=${causa}`] : []), ...frames].join(" | ");
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

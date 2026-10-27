/**
 * Erro que pode ir para `registrarErro` sem vazar texto de mensagem do
 * WhatsApp: ErroLlm/ErroDeRegra têm mensagem só de código; Prisma conhecido
 * é descrito por código. Qualquer outro (ex.: PrismaClientValidationError,
 * que ecoa os argumentos, ou um erro inesperado com o texto na mensagem)
 * perde a mensagem e mantém nome + frames. Comum a `processar.ts` e
 * `sem-tag.ts`.
 */
import { Prisma } from "@prisma/client";
import { ErroLlm } from "@/lib/llm/tipos";
import { ErroDeRegra } from "@/lib/oportunidades/erros";

export function erroSeguro(e: unknown): unknown {
  if (e instanceof ErroLlm || e instanceof ErroDeRegra || e instanceof Prisma.PrismaClientKnownRequestError) return e;
  const s = new Error("(mensagem omitida)");
  s.name = e instanceof Error ? e.name : typeof e;
  if (e instanceof Error && e.stack) s.stack = e.stack;
  return s;
}

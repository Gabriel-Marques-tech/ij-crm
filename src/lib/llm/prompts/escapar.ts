/**
 * Neutraliza os delimitadores dos prompts (`<mensagem>`, `<respondendo_a>`,
 * e os do contexto de 12 h do GAB-49: `<historico>`, `<resumo_anterior>`)
 * dentro do texto do usuário, inclusive variantes com espaço, quebra de
 * linha ou atributos (`</mensagem >`, `</ mensagem>`, `<mensagem\n>`): os
 * `<`/`>` da tag viram `‹`/`›`. Comum à extração e ao classificador.
 */
const DELIMITADOR = /<\s*\/?\s*(mensagem|respondendo_a|historico|resumo_anterior)\b[^>]*>/gi;

export function escaparDelimitadores(s: string): string {
  return s.replace(DELIMITADOR, (t) => `‹${t.slice(1, -1)}›`);
}

/**
 * Ordenação do autocomplete por nome (Empresa/Contato). Busca por nome é só
 * para EXIBIR opções: vínculo é sempre escolha explícita do usuário e nunca
 * entra em match automático (anti-objetivo §2, "ELO" × "TORRES DE MELO").
 */

/** Quem começa com a busca vem antes; estável no resto (já vem por nome). */
export function ordenarPorPrefixo<T extends { nome: string }>(itens: T[], busca: string): T[] {
  const q = busca.trim().toLocaleLowerCase("pt-BR");
  const prefixo = (n: string) => (n.toLocaleLowerCase("pt-BR").startsWith(q) ? 0 : 1);
  return [...itens].sort((a, b) => prefixo(a.nome) - prefixo(b.nome));
}

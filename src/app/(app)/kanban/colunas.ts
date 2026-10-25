/**
 * Quais colunas do Kanban aparecem abertas (as demais viram faixa estreita).
 *
 * - Recolhível: fase terminal ou coluna sem card visível (depois dos filtros).
 * - Recolhível abre se o usuário abriu à mão OU se é o alvo do arrasto em curso.
 * - Durante o arrasto as outras faixas continuam faixas, mas seguem sendo
 *   alvos de drop; só a que está sob o card abre.
 */
export type FaseColuna = { id: string; isTerminal: boolean };

export function colunasAbertas({
  fases,
  contagem,
  abertasManual,
  alvoArrasto,
}: {
  fases: FaseColuna[];
  /** faseId → cards visíveis; ausente = 0. */
  contagem: ReadonlyMap<string, number>;
  abertasManual: ReadonlySet<string>;
  /** Coluna sob o card arrastado (já estabilizada por `proximoAlvo`); null fora de arrasto. */
  alvoArrasto: string | null;
}): Set<string> {
  const abertas = new Set<string>();
  for (const f of fases) {
    const recolhivel = f.isTerminal || (contagem.get(f.id) ?? 0) === 0;
    if (!recolhivel || abertasManual.has(f.id) || f.id === alvoArrasto) abertas.add(f.id);
  }
  return abertas;
}

/**
 * Anti-flicker: quando a faixa abre sob o card, o layout desloca e por um
 * instante o card pode não estar sobre coluna nenhuma. A última coluna-alvo só
 * é trocada quando outra coluna fica sob o card; o fim do arrasto zera.
 */
export function proximoAlvo(atual: string | null, sobCard: string | null): string | null {
  return sobCard ?? atual;
}

import { closestCorners, pointerWithin, type CollisionDetection } from "@dnd-kit/core";

/**
 * Alvo do arrasto no Kanban.
 *
 * Só `closestCorners` falhava na coluna vizinha: as colunas são altas (cantos
 * de baixo longe) e o próprio card arrastado continua registrado como alvo na
 * coluna de origem, a ~1 coluna de distância — ele vencia e o drop "voltava"
 * para a origem. Agora: o card arrastado nunca é alvo de si mesmo, e vale o
 * que está sob o ponteiro; sem ponteiro (teclado) ou fora de tudo, cantos.
 */
export const colisaoQuadro: CollisionDetection = (args) => {
  const semAtivo = { ...args, droppableContainers: args.droppableContainers.filter((c) => c.id !== args.active.id) };
  const sobPonteiro = pointerWithin(semAtivo);
  return sobPonteiro.length > 0 ? sobPonteiro : closestCorners(semAtivo);
};

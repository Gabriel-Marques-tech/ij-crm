import { closestCorners, pointerWithin, type CollisionDetection } from "@dnd-kit/core";

/**
 * Alvo do arrasto no Kanban.
 *
 * Só `closestCorners` falhava na coluna vizinha: as colunas são altas (cantos
 * de baixo longe) e o próprio card arrastado continua registrado como alvo na
 * coluna de origem, a ~1 coluna de distância — ele vencia e o drop "voltava"
 * para a origem. Agora o card arrastado nunca é alvo de si mesmo e vale o que
 * está sob o ponteiro. Ponteiro no vão entre colunas = sem alvo (soltar ali não
 * move nada; antes os cantos podiam escolher uma coluna que não estava sob ele).
 *
 * Teclado não tem ponteiro: `sortableKeyboardCoordinates` põe o card no canto
 * superior esquerdo do destino, então esse canto faz papel de ponteiro (cantos
 * escolheriam a coluna aberta vizinha no lugar de uma faixa recolhida estreita).
 */
export const colisaoQuadro: CollisionDetection = (args) => {
  const semAtivo = { ...args, droppableContainers: args.droppableContainers.filter((c) => c.id !== args.active.id) };
  if (args.pointerCoordinates) return pointerWithin(semAtivo);
  const canto = { x: args.collisionRect.left + 1, y: args.collisionRect.top + 1 };
  const sobCanto = pointerWithin({ ...semAtivo, pointerCoordinates: canto });
  return sobCanto.length > 0 ? sobCanto : closestCorners(semAtivo);
};

import { describe, expect, it } from "vitest";
import { closestCorners, type ClientRect, type CollisionDetection } from "@dnd-kit/core";
import { colisaoQuadro } from "./colisao";

type Args = Parameters<CollisionDetection>[0];

const rect = (left: number, top: number, width: number, height: number): ClientRect => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

// Duas colunas altas lado a lado; o card "c1" mora na coluna A.
const rects = new Map<string, ClientRect>([
  ["fase:a", rect(0, 0, 240, 800)],
  ["fase:b", rect(250, 0, 240, 800)],
  ["c1", rect(8, 80, 224, 100)],
]);

function args(collisionRect: ClientRect, pointer: { x: number; y: number } | null): Args {
  return {
    active: { id: "c1" },
    collisionRect,
    droppableRects: rects,
    droppableContainers: [...rects.keys()].map((id) => ({ id })),
    pointerCoordinates: pointer,
  } as unknown as Args;
}

// Card arrastado para o topo da coluna vizinha B.
const naVizinha = rect(258, 80, 224, 100);

describe("colisaoQuadro", () => {
  it("closestCorners puro escolhia o próprio card na origem (o bug)", () => {
    expect(closestCorners(args(naVizinha, { x: 300, y: 120 }))[0]?.id).toBe("c1");
  });

  it("coluna vizinha: vale a coluna sob o ponteiro", () => {
    expect(colisaoQuadro(args(naVizinha, { x: 300, y: 120 }))[0]?.id).toBe("fase:b");
  });

  it("sem ponteiro (teclado): cantos, mas nunca o próprio card", () => {
    const ids = colisaoQuadro(args(naVizinha, null)).map((c) => c.id);
    expect(ids).not.toContain("c1");
    expect(ids[0]).toBe("fase:b");
  });
});

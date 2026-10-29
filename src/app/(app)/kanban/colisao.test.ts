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

// Geometria real do quadro: colunas `w-72` (288px) com `gap-3` (12px), card
// ~272px; "c" é uma faixa recolhida (`w-12`, 48px). O card "c1" mora na coluna A.
const rects = new Map<string, ClientRect>([
  ["fase:a", rect(0, 0, 288, 800)],
  ["fase:b", rect(300, 0, 288, 800)],
  ["fase:c", rect(600, 0, 48, 800)],
  ["fase:d", rect(660, 0, 288, 800)],
  ["c1", rect(8, 80, 272, 100)],
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

const ids = (a: Args) => colisaoQuadro(a).map((c) => c.id);

// Card arrastado para o topo da coluna vizinha B.
const naVizinha = rect(308, 80, 272, 100);

describe("colisaoQuadro", () => {
  it("closestCorners puro escolhia o próprio card na origem (o bug)", () => {
    expect(closestCorners(args(naVizinha, { x: 350, y: 120 }))[0]?.id).toBe("c1");
  });

  it("coluna vizinha: vale a coluna sob o ponteiro", () => {
    expect(ids(args(naVizinha, { x: 350, y: 120 }))[0]).toBe("fase:b");
  });

  it("faixa recolhida sob o ponteiro", () => {
    expect(ids(args(rect(590, 80, 272, 100), { x: 620, y: 120 }))[0]).toBe("fase:c");
  });

  it("ponteiro no vão entre colunas: sem alvo", () => {
    expect(ids(args(rect(250, 80, 272, 100), { x: 294, y: 120 }))).toEqual([]);
  });

  it("teclado (sem ponteiro): o canto do card no destino decide, nunca o próprio card", () => {
    expect(ids(args(rect(300, 0, 272, 100), null))[0]).toBe("fase:b");
    // Faixa recolhida estreita: cantos escolheriam a coluna aberta ao lado.
    expect(closestCorners(args(rect(600, 0, 272, 100), null))[0]?.id).not.toBe("fase:c");
    expect(ids(args(rect(600, 0, 272, 100), null))[0]).toBe("fase:c");
  });
});

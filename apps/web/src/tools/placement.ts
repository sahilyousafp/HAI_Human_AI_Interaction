import type { Element, Point2, Point3Mm, PointMm, SceneDocument } from "@aex/protocol";
import { elementBounds } from "@aex/scene";
import { snap } from "./grid.ts";
import type { ToolContext } from "./types.ts";

/**
 * The point of an element that lands on a snap when it is moved or copied: a column's centre, a wall's start, the
 * origin corner of a massing, the first corner of a slab, the minimum corner of imported geometry.
 */
export function referencePoint(element: Element, doc: SceneDocument): PointMm {
  switch (element.type) {
    case "column":
      return element.position;
    case "wall":
      return element.start;
    case "slab":
      return element.outline[0] ?? [0, 0];
    case "massing":
      return [element.origin[0], element.origin[1]];
    case "imported": {
      const { min } = elementBounds(element, doc.levels);
      return [min[0], min[1]];
    }
  }
}

/** The height of an element's reference point, millimetres: its base (a massing's own corner, a model's bottom). */
export function referenceHeight(element: Element, doc: SceneDocument): number {
  return elementBounds(element, doc.levels).min[2];
}

/**
 * How far to move (or copy) an element when the pointer has gone from `start` to `pointer` on the ground, in whole
 * millimetres. With only Grid on the distance snaps to 100 mm as it always did, so the element keeps its own
 * alignment; otherwise the element's reference point goes to the snap the aids found for it (at any height; the move
 * itself stays in plan), or stays free when Grid is off and nothing is near.
 */
export function movedOffset(
  ctx: ToolContext,
  element: Element,
  start: Point3Mm,
  pointer: Point3Mm,
  at: Point2,
): [number, number] {
  const doc = ctx.doc();
  const dx = pointer[0] - start[0];
  const dy = pointer[1] - start[1];
  const gridOffset = (): [number, number] =>
    ctx.aids().grid ? [snap(dx), snap(dy)] : [Math.round(dx), Math.round(dy)];
  if (!doc) return gridOffset();
  const ref = referencePoint(element, doc);
  const z = referenceHeight(element, doc);
  const result = ctx.resolve(at, {
    anchor: [ref[0], ref[1], z],
    exclude: [element.id],
    probe: [ref[0] + dx, ref[1] + dy, z],
  });
  if (!result) return gridOffset();
  const holdsToGrid = result.kind === null || (result.kind === "grid" && !result.ortho);
  if (holdsToGrid) return gridOffset();
  return [Math.round(result.point[0] - ref[0]), Math.round(result.point[1] - ref[1])];
}

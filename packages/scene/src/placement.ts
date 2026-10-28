import type { Element, Point3Mm, PointMm } from "@hai/protocol";

type ImportedElement = Extract<Element, { type: "imported" }>;

const RAD = Math.PI / 180;

/** A point turned by `deg` about the origin. */
export function turn([x, y]: PointMm, deg: number): PointMm {
  const c = Math.cos(deg * RAD);
  const s = Math.sin(deg * RAD);
  return [x * c - y * s, x * s + y * c];
}

/** The corners of a w by d rectangle centred on (cx, cy) and turned by `deg` about that centre, counter-clockwise. */
export function turnedRect(cx: number, cy: number, w: number, d: number, deg: number): PointMm[] {
  return (
    [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ] as PointMm[]
  ).map((corner) => {
    const [x, y] = turn(corner, deg);
    return [cx + x, cy + y];
  });
}

/** The footprint of a massing or a column as it stands, turned by its rotation. */
export function footprintOf(element: Element): PointMm[] | null {
  switch (element.type) {
    case "massing": {
      const [w, d] = element.size;
      return turnedRect(element.origin[0] + w / 2, element.origin[1] + d / 2, w, d, element.rotationDeg ?? 0);
    }
    case "column": {
      const [w, d] = element.section;
      return turnedRect(element.position[0], element.position[1], w, d, element.rotationDeg ?? 0);
    }
    default:
      return null;
  }
}

/**
 * Where an imported model's own coordinates land: `world = offset + scale * turn(p)` (the turn is in plan only). The
 * model turns and scales about the centre of its box in plan and the foot of it, then sits at its translation.
 */
export function importedPlacement(element: ImportedElement): {
  offset: Point3Mm;
  scale: number;
  rotationDeg: number;
} {
  const k = element.scale ?? 1;
  const rotationDeg = element.rotationDeg ?? 0;
  const { min, max } = element.bounds;
  const cx = (min[0] + max[0]) / 2;
  const cy = (min[1] + max[1]) / 2;
  const [rx, ry] = turn([cx, cy], rotationDeg);
  const [tx, ty, tz] = element.translation;
  return { offset: [tx + cx - k * rx, ty + cy - k * ry, tz + min[2] - k * min[2]], scale: k, rotationDeg };
}

/** A point of an imported model's own coordinates, in the scene. */
export function importedWorld(element: ImportedElement, point: Point3Mm): Point3Mm {
  const { offset, scale, rotationDeg } = importedPlacement(element);
  const [x, y] = turn([point[0], point[1]], rotationDeg);
  return [offset[0] + scale * x, offset[1] + scale * y, offset[2] + scale * point[2]];
}

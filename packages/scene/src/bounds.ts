import type { Element, Level, Point3Mm } from "@hai/protocol";

export interface BoundsMm {
  min: Point3Mm;
  max: Point3Mm;
}

const levelElevation = (levels: Level[], id: string | undefined) =>
  levels.find((l) => l.id === id)?.elevation ?? 0;

/**
 * The height of an element's base, millimetres: its own `base` when it has one (walls, slabs and columns placed off any
 * level), else its level's elevation, else the ground.
 */
export function elementBase(element: Element, levels: Level[]): number {
  if (
    (element.type === "wall" || element.type === "slab" || element.type === "column") &&
    element.base !== undefined
  ) {
    return element.base;
  }
  return levelElevation(levels, element.level);
}

/**
 * Axis-aligned bounds of an element in millimetres, matching how the viewer builds its geometry: massing from its
 * origin corner, slabs extruded down from their level, walls centred on their baseline and columns on their
 * position, both rising from their level, lines through their points at their own heights, and imported geometry
 * from its stored box moved by its translation.
 */
export function elementBounds(element: Element, levels: Level[]): BoundsMm {
  const base = elementBase(element, levels);
  switch (element.type) {
    case "massing": {
      const [x, y, z] = element.origin;
      const [w, d, h] = element.size;
      return { min: [x, y, z], max: [x + w, y + d, z + h] };
    }
    case "slab": {
      const xs = element.outline.map((p) => p[0]);
      const ys = element.outline.map((p) => p[1]);
      return {
        min: [Math.min(...xs), Math.min(...ys), base - element.thickness],
        max: [Math.max(...xs), Math.max(...ys), base],
      };
    }
    case "wall": {
      const [x0, y0] = element.start;
      const [x1, y1] = element.end;
      const length = Math.hypot(x1 - x0, y1 - y0) || 1;
      // Half the thickness, perpendicular to the baseline, on each side.
      const ox = (Math.abs(y1 - y0) / length) * (element.thickness / 2);
      const oy = (Math.abs(x1 - x0) / length) * (element.thickness / 2);
      return {
        min: [Math.min(x0, x1) - ox, Math.min(y0, y1) - oy, base],
        max: [Math.max(x0, x1) + ox, Math.max(y0, y1) + oy, base + element.height],
      };
    }
    case "column": {
      const [x, y] = element.position;
      const [w, d] = element.section;
      return { min: [x - w / 2, y - d / 2, base], max: [x + w / 2, y + d / 2, base + element.height] };
    }
    case "line": {
      const xs = element.points.map((p) => p[0]);
      const ys = element.points.map((p) => p[1]);
      const zs = element.points.map((p) => p[2]);
      return {
        min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)],
        max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)],
      };
    }
    case "imported": {
      const [tx, ty, tz] = element.translation;
      const { min, max } = element.bounds;
      return { min: [min[0] + tx, min[1] + ty, min[2] + tz], max: [max[0] + tx, max[1] + ty, max[2] + tz] };
    }
  }
}

/** Bounds of several elements together, or null when there are none. */
export function unionBounds(bounds: BoundsMm[]): BoundsMm | null {
  if (bounds.length === 0) return null;
  const min: Point3Mm = [Infinity, Infinity, Infinity];
  const max: Point3Mm = [-Infinity, -Infinity, -Infinity];
  for (const b of bounds) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i] as number, b.min[i] as number);
      max[i] = Math.max(max[i] as number, b.max[i] as number);
    }
  }
  return { min, max };
}

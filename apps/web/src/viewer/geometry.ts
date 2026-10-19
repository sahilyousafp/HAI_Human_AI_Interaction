import type { Element, Level } from "@aex/protocol";
import * as THREE from "three";

/** Scene units are millimetres; the viewer works in metres. */
export const MM = 0.001;

const levelElevation = (levels: Level[], id: string | undefined) =>
  levels.find((l) => l.id === id)?.elevation ?? 0;

/**
 * Builds geometry for an element in metres, Z up.
 * - massing: box from its origin corner.
 * - slab: outline extruded downward from its level (the level is the top of the floor).
 * - wall: box centred on its baseline, rising from its level.
 * - column: box centred on its position, rising from its level.
 */
export function elementGeometry(element: Element, levels: Level[]): THREE.BufferGeometry {
  const base = levelElevation(levels, element.level);
  switch (element.type) {
    case "massing": {
      const [w, d, h] = element.size;
      const g = new THREE.BoxGeometry(w * MM, d * MM, h * MM);
      g.translate(
        (element.origin[0] + w / 2) * MM,
        (element.origin[1] + d / 2) * MM,
        (element.origin[2] + h / 2) * MM,
      );
      return g;
    }
    case "slab": {
      const shape = new THREE.Shape(element.outline.map(([x, y]) => new THREE.Vector2(x * MM, y * MM)));
      const g = new THREE.ExtrudeGeometry(shape, { depth: element.thickness * MM, bevelEnabled: false });
      g.translate(0, 0, (base - element.thickness) * MM);
      return g;
    }
    case "wall": {
      const [x0, y0] = element.start;
      const [x1, y1] = element.end;
      const length = Math.hypot(x1 - x0, y1 - y0);
      const g = new THREE.BoxGeometry(length * MM, element.thickness * MM, element.height * MM);
      g.rotateZ(Math.atan2(y1 - y0, x1 - x0));
      g.translate(((x0 + x1) / 2) * MM, ((y0 + y1) / 2) * MM, (base + element.height / 2) * MM);
      return g;
    }
    case "column": {
      const [w, d] = element.section;
      const g = new THREE.BoxGeometry(w * MM, d * MM, element.height * MM);
      g.translate(element.position[0] * MM, element.position[1] * MM, (base + element.height / 2) * MM);
      return g;
    }
  }
}

/** Bounding box of all elements, metres. */
export function sceneBounds(geometries: THREE.BufferGeometry[]): {
  min: [number, number, number];
  max: [number, number, number];
} {
  const box = new THREE.Box3();
  for (const g of geometries) {
    g.computeBoundingBox();
    if (g.boundingBox) box.union(g.boundingBox);
  }
  if (box.isEmpty()) return { min: [-10, -10, 0], max: [10, 10, 10] };
  return { min: box.min.toArray(), max: box.max.toArray() };
}

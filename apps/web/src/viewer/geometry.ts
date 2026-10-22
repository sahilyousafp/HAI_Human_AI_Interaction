import type { Element, Level } from "@hai/protocol";
import { elementBase, type MeshPart } from "@hai/scene";
import * as THREE from "three";

/** Scene units are millimetres; the viewer works in metres. */
export const MM = 0.001;

/**
 * Builds geometry for an element in metres, Z up.
 * - massing: box from its origin corner.
 * - slab: outline extruded downward from its level (the level is the top of the floor).
 * - wall: box centred on its baseline, rising from its level.
 * - column: box centred on its position, rising from its level.
 * - imported: its bounding box (its triangles are drawn from the asset: see `modelGeometry`).
 */
export function elementGeometry(element: Element, levels: Level[]): THREE.BufferGeometry {
  const base = elementBase(element, levels);
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
    case "imported": {
      const [tx, ty, tz] = element.translation;
      // Without them (still loading, or the file is gone) the stored bounding box stands in.
      const { min, max } = element.bounds;
      const g = new THREE.BoxGeometry((max[0] - min[0]) * MM, (max[1] - min[1]) * MM, (max[2] - min[2]) * MM);
      g.translate(
        ((min[0] + max[0]) / 2 + tx) * MM,
        ((min[1] + max[1]) / 2 + ty) * MM,
        ((min[2] + max[2]) / 2 + tz) * MM,
      );
      return g;
    }
  }
}

/**
 * The triangles of an imported model, as the asset holds them: millimetres, sharing the asset's arrays (nothing is
 * copied, so a model of millions of triangles costs the main thread no more than the upload to the graphics card).
 * The material shades each face flat. Draw it with a scale of `MM` at the element's translation.
 */
export function modelGeometry(mesh: MeshPart): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  // Flat shading works the normal out on the graphics card, but the material still wants a normal attribute: without
  // one the surface is lit as if it faced no way, which is black. Any value will do, so every vertex points up.
  const up = new Int8Array((mesh.positions.length / 3) * 4);
  for (let i = 2; i < up.length; i += 4) up[i] = 127;
  g.setAttribute("normal", new THREE.BufferAttribute(up, 4, true));
  return g;
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

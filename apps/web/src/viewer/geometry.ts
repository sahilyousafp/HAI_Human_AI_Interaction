import type { Element, Level, Point3Mm } from "@hai/protocol";
import { elementBase, importedPlacement, type MeshPart } from "@hai/scene";
import * as THREE from "three";
import { polylineLength, tubeAlong, tubeRadiusMm } from "../import/curve-tube.ts";

/** Scene units are millimetres; the viewer works in metres. */
export const MM = 0.001;

/** Degrees to radians. */
export const radians = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Builds geometry for an element in metres, Z up.
 * - massing: box from its origin corner.
 * - slab: outline extruded downward from its level (the level is the top of the floor).
 * - wall: box centred on its baseline, rising from its level.
 * - column: box centred on its position, rising from its level.
 * - line: a thin tube along its points (a closed line returns to its first).
 * - imported: its bounding box (its triangles are drawn from the asset: see `modelGeometry`).
 */
export function elementGeometry(element: Element, levels: Level[]): THREE.BufferGeometry {
  const base = elementBase(element, levels);
  switch (element.type) {
    case "massing": {
      const [w, d, h] = element.size;
      const g = new THREE.BoxGeometry(w * MM, d * MM, h * MM);
      g.rotateZ(radians(element.rotationDeg ?? 0));
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
      g.rotateZ(radians(element.rotationDeg ?? 0));
      g.translate(element.position[0] * MM, element.position[1] * MM, (base + element.height / 2) * MM);
      return g;
    }
    case "line": {
      const points = element.closed ? [...element.points, element.points[0] as Point3Mm] : element.points;
      const { positions, indices } = tubeAlong(points, tubeRadiusMm(polylineLength(points)));
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      g.setIndex(new THREE.BufferAttribute(indices, 1));
      g.scale(MM, MM, MM);
      g.computeVertexNormals();
      return g;
    }
    case "imported": {
      // Without them (still loading, or the file is gone) the stored bounding box stands in, placed as the model is.
      const { min, max } = element.bounds;
      const { offset, scale, rotationDeg } = importedPlacement(element);
      const g = new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
      g.translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
      g.rotateZ(radians(rotationDeg));
      g.scale(scale, scale, scale);
      g.translate(offset[0], offset[1], offset[2]);
      g.scale(MM, MM, MM);
      return g;
    }
  }
}

/**
 * The triangles of an imported model, as the asset holds them: millimetres, sharing the asset's arrays (nothing is
 * copied, so a model of millions of triangles costs the main thread no more than the upload to the graphics card).
 * The material shades each face flat. Draw it at the element's placement (`importedPlacement`), scaled by `MM`.
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

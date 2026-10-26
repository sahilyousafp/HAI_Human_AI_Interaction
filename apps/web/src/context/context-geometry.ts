import type { ContextBuilding, ContextItem } from "@hai/protocol";
import * as THREE from "three";

/** Scene units are millimetres; the viewer works in metres. */
const MM = 0.001;

/** Buffers for one merged mesh of every building: walls and roofs, in metres, Z up. */
export interface BuildingMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

/** A polygon's signed area (positive when counter-clockwise). */
function area(points: ReadonlyArray<readonly [number, number]>): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i] as readonly [number, number];
    const [x1, y1] = points[(i + 1) % points.length] as readonly [number, number];
    sum += x0 * y1 - x1 * y0;
  }
  return sum / 2;
}

/**
 * Every building, merged into one mesh: for each, its footprint extruded to its height, walls with outward normals
 * and a flat roof. A footprint with fewer than three distinct points, or no area, is left out. One mesh keeps
 * thousands of buildings to one draw call.
 */
export function buildingMesh(buildings: ReadonlyArray<ContextBuilding>): BuildingMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (const building of buildings) {
    let ring = building.footprint.map(([x, y]) => [x * MM, y * MM] as [number, number]);
    // The closing point repeated at the end is not a vertex.
    const first = ring[0];
    const last = ring.at(-1);
    if (first && last && ring.length > 3 && first[0] === last[0] && first[1] === last[1])
      ring = ring.slice(0, -1);
    if (ring.length < 3 || Math.abs(area(ring)) < 1e-9) continue;
    if (area(ring) < 0) ring = ring.reverse(); // counter-clockwise: outward normals are on the right of each edge
    const z0 = building.baseMm * MM;
    const z1 = z0 + building.heightMm * MM;
    // Walls.
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay] = ring[i] as [number, number];
      const [bx, by] = ring[(i + 1) % ring.length] as [number, number];
      const length = Math.hypot(bx - ax, by - ay);
      if (length < 1e-9) continue;
      const nx = (by - ay) / length;
      const ny = -(bx - ax) / length;
      const at = positions.length / 3;
      for (const [x, y, z] of [
        [ax, ay, z0],
        [bx, by, z0],
        [bx, by, z1],
        [ax, ay, z1],
      ] as const) {
        positions.push(x, y, z);
        normals.push(nx, ny, 0);
      }
      indices.push(at, at + 1, at + 2, at, at + 2, at + 3);
    }
    // The roof.
    const contour = ring.map(([x, y]) => new THREE.Vector2(x, y));
    const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
    const at = positions.length / 3;
    for (const [x, y] of ring) {
      positions.push(x, y, z1);
      normals.push(0, 0, 1);
    }
    for (const [a, b, c] of triangles)
      indices.push(at + (a as number), at + (b as number), at + (c as number));
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}

/** Where trees stand, in metres, with each one's height (6 m when the source gives none). */
export function treePlacements(
  items: ReadonlyArray<ContextItem>,
): Array<{ x: number; y: number; height: number }> {
  return items.flatMap((item) =>
    item.kind === "tree"
      ? [{ x: item.position[0] * MM, y: item.position[1] * MM, height: (item.heightMm ?? 6000) * MM }]
      : [],
  );
}

/** How far from the origin the context reaches, in metres: what the sun's shadow map has to cover. */
export function contextExtent(items: ReadonlyArray<ContextItem>): number {
  let far = 0;
  for (const item of items) {
    if (item.kind === "building")
      for (const [x, y] of item.footprint) far = Math.max(far, Math.hypot(x, y) * MM);
    else if (item.kind === "tree") far = Math.max(far, Math.hypot(item.position[0], item.position[1]) * MM);
  }
  return far;
}

/** The legend's colour at a value: stops are linear, and a value outside them takes the nearest end. */
export function legendColor(stops: ReadonlyArray<{ value: number; color: string }>, value: number): string {
  const sorted = [...stops].sort((a, b) => a.value - b.value);
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last) return "#808080";
  if (value <= first.value) return first.color;
  if (value >= last.value) return last.color;
  for (let i = 1; i < sorted.length; i++) {
    const hi = sorted[i] as { value: number; color: string };
    const lo = sorted[i - 1] as { value: number; color: string };
    if (value <= hi.value) {
      const t = (value - lo.value) / (hi.value - lo.value || 1);
      return `#${new THREE.Color(lo.color).lerp(new THREE.Color(hi.color), t).getHexString()}`;
    }
  }
  return last.color;
}

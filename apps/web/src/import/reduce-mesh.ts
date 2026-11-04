import type { MeshPart } from "@hai/scene";

/** A part this small keeps its shape: there is nothing to gain from reducing it. */
const SMALL_PART_TRIANGLES = 12;

/**
 * A low-detail copy of a mesh: a grid is laid over it, with this many cells along its longest side, and the vertices in
 * a cell become one at their average. Triangles that collapse, or that land on one already kept, go. It keeps the
 * outline and the mass, and holds for what repeated blocks usually are: trees, shrubs, furniture. It does not keep edges
 * or thin detail, so it is only for what the report says was simplified.
 */
export function reduceMesh(mesh: MeshPart, cells: number): MeshPart {
  if (mesh.indices.length / 3 <= SMALL_PART_TRIANGLES) return mesh;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = mesh.positions[i + axis] as number;
      if (value < (min[axis] as number)) min[axis] = value;
      if (value > (max[axis] as number)) max[axis] = value;
    }
  }
  const longest = Math.max(
    (max[0] as number) - (min[0] as number),
    (max[1] as number) - (min[1] as number),
    (max[2] as number) - (min[2] as number),
  );
  if (longest === 0) return mesh;
  const size = longest / cells;
  const cellOf = (i: number, axis: number) =>
    Math.min(cells - 1, Math.floor(((mesh.positions[i + axis] as number) - (min[axis] as number)) / size));

  // Each cell in use: where its vertices add up to, and how many there are.
  const slotOfCell = new Map<number, number>();
  const sums: number[] = [];
  const counts: number[] = [];
  const slots = new Uint32Array(mesh.positions.length / 3);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const cell = cellOf(i, 0) + cellOf(i, 1) * cells + cellOf(i, 2) * cells * cells;
    let slot = slotOfCell.get(cell);
    if (slot === undefined) {
      slot = counts.length;
      slotOfCell.set(cell, slot);
      sums.push(0, 0, 0);
      counts.push(0);
    }
    slots[i / 3] = slot;
    sums[slot * 3] = (sums[slot * 3] as number) + (mesh.positions[i] as number);
    sums[slot * 3 + 1] = (sums[slot * 3 + 1] as number) + (mesh.positions[i + 1] as number);
    sums[slot * 3 + 2] = (sums[slot * 3 + 2] as number) + (mesh.positions[i + 2] as number);
    counts[slot] = (counts[slot] as number) + 1;
  }

  const positions = new Float32Array(counts.length * 3);
  for (let slot = 0; slot < counts.length; slot++) {
    for (let axis = 0; axis < 3; axis++) {
      positions[slot * 3 + axis] = (sums[slot * 3 + axis] as number) / (counts[slot] as number);
    }
  }

  const kept = new Set<string>();
  const indices: number[] = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = slots[mesh.indices[i] as number] as number;
    const b = slots[mesh.indices[i + 1] as number] as number;
    const c = slots[mesh.indices[i + 2] as number] as number;
    if (a === b || b === c || a === c) continue;
    // The same three corners in any order are one triangle, or the two sides of one.
    const key = [a, b, c].sort((x, y) => x - y).join(",");
    if (kept.has(key)) continue;
    kept.add(key);
    indices.push(a, b, c);
  }
  return { positions, indices: Uint32Array.from(indices) };
}

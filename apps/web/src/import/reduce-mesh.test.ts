import { partBounds } from "@hai/scene";
import { describe, expect, it } from "vitest";
import { reduceMesh } from "./reduce-mesh.ts";

/** A flat sheet of n by n squares, 10 units each. */
function sheet(n: number) {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) positions.push(x * 10, y * 10, 0);
  const at = (x: number, y: number) => y * (n + 1) + x;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      indices.push(at(x, y), at(x + 1, y), at(x + 1, y + 1), at(x, y), at(x + 1, y + 1), at(x, y + 1));
    }
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}

describe("reduceMesh", () => {
  it("makes a dense mesh much smaller, and fewer cells make it smaller still", () => {
    const dense = sheet(100);
    const coarse = reduceMesh(dense, 8);
    const fine = reduceMesh(dense, 32);
    expect(dense.indices.length / 3).toBe(20_000);
    expect(fine.indices.length / 3).toBeLessThan(2500);
    expect(coarse.indices.length).toBeLessThan(fine.indices.length);
    expect(coarse.indices.length).toBeGreaterThan(0);
  });

  it("stays where the mesh was, near its size", () => {
    const box = partBounds(reduceMesh(sheet(100), 8));
    expect(box.min[0]).toBeLessThan(70);
    expect(box.min[0]).toBeGreaterThanOrEqual(0);
    expect(box.max[0]).toBeGreaterThan(930);
    expect(box.max[0]).toBeLessThanOrEqual(1000);
  });

  it("every index points at a vertex it kept", () => {
    const reduced = reduceMesh(sheet(40), 6);
    const vertices = reduced.positions.length / 3;
    for (const index of reduced.indices) expect(index).toBeLessThan(vertices);
  });

  it("leaves a small part as it is", () => {
    const small = sheet(2);
    expect(reduceMesh(small, 2)).toBe(small);
  });

  it("leaves a mesh with no size as it is, rather than dividing by nothing", () => {
    const point = {
      positions: new Float32Array(3 * 20).fill(5),
      indices: Uint32Array.from({ length: 60 }, (_, i) => i % 20),
    };
    expect(reduceMesh(point, 8)).toBe(point);
  });
});

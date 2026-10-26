import type { ContextBuilding, ContextItem } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { buildingMesh, contextExtent, legendColor, treePlacements } from "./context-geometry.ts";

const box = (
  x: number,
  y: number,
  w: number,
  d: number,
  h: number,
  extra: Partial<ContextBuilding> = {},
): ContextBuilding => ({
  id: "b",
  kind: "building",
  footprint: [
    [x, y],
    [x + w, y],
    [x + w, y + d],
    [x, y + d],
  ],
  heightMm: h,
  heightSource: "measured",
  baseMm: 0,
  source: "overpass",
  ...extra,
});

/** The highest and lowest z in the buffer, in metres. */
const zRange = (mesh: ReturnType<typeof buildingMesh>) => {
  const zs = Array.from({ length: mesh.positions.length / 3 }, (_, i) => mesh.positions[i * 3 + 2] as number);
  return [Math.min(...zs), Math.max(...zs)];
};

describe("buildingMesh", () => {
  it("a 12 m building is a prism from the ground to 12 m: four walls and a roof", () => {
    const mesh = buildingMesh([box(0, 0, 10_000, 8_000, 12_000)]);
    // 4 walls x 4 vertices + 4 roof vertices; 4 walls x 2 triangles + 2 roof triangles.
    expect(mesh.positions.length / 3).toBe(20);
    expect(mesh.indices.length / 3).toBe(10);
    expect(zRange(mesh)).toEqual([0, 12]);
  });

  it("stands on its own base", () => {
    const mesh = buildingMesh([box(0, 0, 4_000, 4_000, 3_000, { baseMm: 2_000 })]);
    expect(zRange(mesh)).toEqual([2, 5]);
  });

  it("wall normals point outward whichever way the footprint was drawn", () => {
    for (const reverse of [false, true]) {
      const footprint = box(0, 0, 10_000, 8_000, 3_000).footprint;
      const mesh = buildingMesh([
        box(0, 0, 0, 0, 3_000, { footprint: reverse ? [...footprint].reverse() : footprint }),
      ]);
      const [cx, cy] = [5, 4] as const;
      for (let v = 0; v < mesh.positions.length / 3; v++) {
        const nz = mesh.normals[v * 3 + 2] as number;
        if (nz !== 0) continue;
        const outward =
          ((mesh.positions[v * 3] as number) - cx) * (mesh.normals[v * 3] as number) +
          ((mesh.positions[v * 3 + 1] as number) - cy) * (mesh.normals[v * 3 + 1] as number);
        expect(outward).toBeGreaterThan(0);
      }
    }
  });

  it("an L-shaped footprint gets a roof made of triangles that cover it (four triangles for six corners)", () => {
    const l: ContextBuilding = box(0, 0, 0, 0, 3_000, {
      footprint: [
        [0, 0],
        [10_000, 0],
        [10_000, 4_000],
        [4_000, 4_000],
        [4_000, 10_000],
        [0, 10_000],
      ],
    });
    const mesh = buildingMesh([l]);
    // 6 walls x 2 triangles + 4 roof triangles.
    expect(mesh.indices.length / 3).toBe(12 + 4);
  });

  it("leaves out a footprint with no area or fewer than three points, and drops a repeated closing point", () => {
    expect(buildingMesh([box(0, 0, 0, 0, 3_000)]).indices.length).toBe(0);
    expect(
      buildingMesh([
        box(0, 0, 1, 1, 3_000, {
          footprint: [
            [0, 0],
            [1, 1],
            [2, 2],
          ],
        }),
      ]).indices.length,
    ).toBe(0);
    const closed = box(0, 0, 10_000, 8_000, 3_000);
    closed.footprint = [...closed.footprint, closed.footprint[0] as [number, number]];
    expect(buildingMesh([closed]).positions.length / 3).toBe(20);
  });

  it("merges many buildings into one set of buffers", () => {
    const many = Array.from({ length: 2000 }, (_, i) => box(i * 20_000, 0, 10_000, 8_000, 9_000));
    const mesh = buildingMesh(many);
    expect(mesh.positions.length / 3).toBe(2000 * 20);
    expect(mesh.indices.length / 3).toBe(2000 * 10);
  });
});

describe("the other helpers", () => {
  it("places trees in metres with a default height", () => {
    const items: ContextItem[] = [
      { id: "t1", kind: "tree", position: [1_000, 2_000], source: "overpass" },
      { id: "t2", kind: "tree", position: [0, 0], heightMm: 9_000, source: "overpass" },
      box(0, 0, 1, 1, 1),
    ];
    expect(treePlacements(items)).toEqual([
      { x: 1, y: 2, height: 6 },
      { x: 0, y: 0, height: 9 },
    ]);
  });

  it("says how far the context reaches from the origin", () => {
    expect(contextExtent([])).toBe(0);
    expect(contextExtent([box(0, 0, 100_000, 0, 1_000)])).toBeCloseTo(100, 5);
  });

  it("the legend colour follows its stops and holds at the ends", () => {
    const stops = [
      { value: 0, color: "#000000" },
      { value: 10, color: "#ffffff" },
    ];
    expect(legendColor(stops, -5)).toBe("#000000");
    expect(legendColor(stops, 20)).toBe("#ffffff");
    expect(legendColor(stops, 5)).toBe("#bcbcbc");
    expect(legendColor([], 1)).toBe("#808080");
  });
});

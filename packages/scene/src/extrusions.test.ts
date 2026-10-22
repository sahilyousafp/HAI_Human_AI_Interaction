import type { Element, SceneDocument } from "@aex/protocol";
import { describe, expect, it } from "vitest";
import { exportExtrusions, prismMesh } from "./extrusions.ts";

const doc = (...elements: Element[]): SceneDocument => ({
  version: 1,
  units: "mm",
  up: "Z",
  name: "Test",
  levels: [
    { id: "L0", name: "Ground", elevation: 0 },
    { id: "L1", name: "Level 1", elevation: 4500 },
  ],
  elements: Object.fromEntries(elements.map((e) => [e.id, e])),
});

const base = { properties: {} };
const bbox = (points: Array<[number, number]>) => ({
  x: [Math.min(...points.map((p) => p[0])), Math.max(...points.map((p) => p[0]))],
  y: [Math.min(...points.map((p) => p[1])), Math.max(...points.map((p) => p[1]))],
});

describe("exportExtrusions", () => {
  it("a wall: 6000 long, 200 thick, 3000 high, on a level at 4500", () => {
    const [wall] = exportExtrusions(
      doc({
        ...base,
        id: "w",
        type: "wall",
        name: "North wall",
        level: "L1",
        start: [1000, 1000],
        end: [7000, 1000],
        height: 3000,
        thickness: 200,
      }),
    );
    expect(wall).toMatchObject({
      id: "w",
      name: "North wall",
      layer: "Walls",
      baseMm: 4500,
      heightMm: 3000,
      level: "Level 1",
    });
    expect(bbox(wall?.footprint ?? [])).toEqual({ x: [1000, 7000], y: [900, 1100] });
  });

  it("a wall at an angle has its thickness across its baseline", () => {
    const [wall] = exportExtrusions(
      doc({
        ...base,
        id: "w",
        type: "wall",
        name: "w",
        start: [0, 0],
        end: [3000, 4000],
        height: 3000,
        thickness: 200,
      }),
    );
    const [a, b, c, d] = wall?.footprint ?? [];
    expect(Math.hypot((b?.[0] ?? 0) - (a?.[0] ?? 0), (b?.[1] ?? 0) - (a?.[1] ?? 0))).toBeCloseTo(5000);
    expect(Math.hypot((c?.[0] ?? 0) - (b?.[0] ?? 0), (c?.[1] ?? 0) - (b?.[1] ?? 0))).toBeCloseTo(200);
    expect(d).toBeDefined();
  });

  it("every footprint runs counter-clockwise, whichever way the element was drawn", () => {
    const reversed = [
      [0, 0],
      [0, 2000],
      [4000, 2000],
      [4000, 0],
    ] as Array<[number, number]>;
    const extrusions = exportExtrusions(
      doc(
        { ...base, id: "s", type: "slab", name: "s", outline: reversed, thickness: 250 },
        {
          ...base,
          id: "w",
          type: "wall",
          name: "w",
          start: [5000, 0],
          end: [0, 0],
          height: 3000,
          thickness: 200,
        },
      ),
    );
    for (const e of extrusions) {
      let sum = 0;
      e.footprint.forEach((p, i) => {
        const q = e.footprint[(i + 1) % e.footprint.length] as [number, number];
        sum += p[0] * q[1] - q[0] * p[1];
      });
      expect(sum).toBeGreaterThan(0);
    }
  });

  it("a slab hangs down from its level; a column and a massing sit on theirs", () => {
    const out = exportExtrusions(
      doc(
        {
          ...base,
          id: "s",
          type: "slab",
          name: "Slab",
          level: "L1",
          outline: [
            [0, 0],
            [4000, 0],
            [4000, 2000],
            [0, 2000],
          ],
          thickness: 250,
        },
        {
          ...base,
          id: "c",
          type: "column",
          name: "C",
          level: "L1",
          position: [500, 500],
          section: [400, 600],
          height: 3000,
        },
        { ...base, id: "m", type: "massing", name: "M", origin: [1000, 2000, 300], size: [6000, 5000, 3500] },
      ),
    );
    expect(out[0]).toMatchObject({ layer: "Slabs", baseMm: 4250, heightMm: 250 });
    expect(out[1]).toMatchObject({ layer: "Columns", baseMm: 4500, heightMm: 3000 });
    expect(bbox(out[1]?.footprint ?? [])).toEqual({ x: [300, 700], y: [200, 800] });
    expect(out[2]).toMatchObject({ layer: "Massings", baseMm: 300, heightMm: 3500 });
    expect(bbox(out[2]?.footprint ?? [])).toEqual({ x: [1000, 7000], y: [2000, 7000] });
  });

  it("an element's own base wins over its level; imported elements and empty walls are left out", () => {
    const out = exportExtrusions(
      doc(
        {
          ...base,
          id: "w",
          type: "wall",
          name: "w",
          level: "L1",
          base: 31_200,
          start: [0, 0],
          end: [4000, 0],
          height: 3000,
          thickness: 200,
        },
        {
          ...base,
          id: "z",
          type: "wall",
          name: "z",
          start: [0, 0],
          end: [0, 0],
          height: 3000,
          thickness: 200,
        },
        {
          ...base,
          id: "i",
          type: "imported",
          name: "i",
          asset: "0f8fad5b-d9cb-469f-a165-70867728950e",
          part: 0,
          bounds: { min: [0, 0, 0], max: [1, 1, 1] },
          translation: [0, 0, 0],
        },
      ),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.baseMm).toBe(31_200);
  });

  it("carries the element's properties", () => {
    const [column] = exportExtrusions(
      doc({
        id: "c",
        type: "column",
        name: "C",
        properties: { material: "steel", rating: 2 },
        position: [0, 0],
        section: [400, 400],
        height: 3000,
      }),
    );
    expect(column?.properties).toEqual({ material: "steel", rating: 2 });
  });
});

describe("prismMesh", () => {
  /** The signed volume of a closed triangle mesh: positive when it faces outward. */
  const volume = (m: { positions: Float32Array; indices: Uint32Array }) => {
    let v = 0;
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, b, c] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]].map((i) => (i ?? 0) * 3) as [
        number,
        number,
        number,
      ];
      const p = m.positions;
      v +=
        ((p[a] ?? 0) * ((p[b + 1] ?? 0) * (p[c + 2] ?? 0) - (p[b + 2] ?? 0) * (p[c + 1] ?? 0)) -
          (p[a + 1] ?? 0) * ((p[b] ?? 0) * (p[c + 2] ?? 0) - (p[b + 2] ?? 0) * (p[c] ?? 0)) +
          (p[a + 2] ?? 0) * ((p[b] ?? 0) * (p[c + 1] ?? 0) - (p[b + 1] ?? 0) * (p[c] ?? 0))) /
        6;
    }
    return v;
  };

  it("a wall's prism has its exact volume and faces outward", () => {
    const [wall] = exportExtrusions(
      doc({
        ...base,
        id: "w",
        type: "wall",
        name: "w",
        start: [0, 0],
        end: [6000, 0],
        height: 3000,
        thickness: 200,
      }),
    );
    const mesh = prismMesh(wall as NonNullable<typeof wall>);
    expect(volume(mesh)).toBeCloseTo(6000 * 200 * 3000, -3);
    expect(mesh.indices.length / 3).toBe(12);
  });

  it("an L-shaped slab is filled without covering its notch", () => {
    const l: Array<[number, number]> = [
      [0, 0],
      [4000, 0],
      [4000, 2000],
      [2000, 2000],
      [2000, 4000],
      [0, 4000],
    ];
    const [slab] = exportExtrusions(
      doc({ ...base, id: "s", type: "slab", name: "s", outline: l, thickness: 200 }),
    );
    const mesh = prismMesh(slab as NonNullable<typeof slab>);
    expect(volume(mesh)).toBeCloseTo((4000 * 2000 + 2000 * 2000) * 200, -3);
  });
});

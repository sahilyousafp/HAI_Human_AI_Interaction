import type { Element, Level } from "@hai/protocol";
import type * as THREE from "three";
import { describe, expect, it } from "vitest";
import { elementGeometry } from "./geometry.ts";

const levels: Level[] = [
  { id: "L0", name: "G", elevation: 0 },
  { id: "L1", name: "1", elevation: 4500 },
];
const bounds = (e: Element) => {
  const g = elementGeometry(e, levels);
  g.computeBoundingBox();
  return g.boundingBox as THREE.Box3;
};
const props = { properties: {} };

describe("element geometry (millimetres in, metres out, Z up)", () => {
  it("a wall rises from its level, centred on its baseline", () => {
    const b = bounds({
      id: "w",
      type: "wall",
      name: "W",
      level: "L1",
      start: [0, 0],
      end: [6000, 0],
      height: 3000,
      thickness: 300,
      ...props,
    });
    expect(b.min.z).toBeCloseTo(4.5, 6);
    expect(b.max.z).toBeCloseTo(7.5, 6);
    expect(b.max.x - b.min.x).toBeCloseTo(6, 6);
    expect(b.max.y - b.min.y).toBeCloseTo(0.3, 6);
  });

  it("a slab hangs below its level (the level is the floor's top)", () => {
    const b = bounds({
      id: "s",
      type: "slab",
      name: "S",
      level: "L1",
      outline: [
        [0, 0],
        [1000, 0],
        [1000, 1000],
        [0, 1000],
      ],
      thickness: 250,
      ...props,
    });
    expect(b.max.z).toBeCloseTo(4.5, 6);
    expect(b.min.z).toBeCloseTo(4.25, 6);
  });

  it("a massing box starts at its origin corner", () => {
    const b = bounds({
      id: "m",
      type: "massing",
      name: "M",
      origin: [24000, 4000, 0],
      size: [12000, 12000, 21000],
      ...props,
    });
    expect(b.min.toArray()).toEqual([24, 4, 0].map((v) => expect.closeTo(v, 6)));
    expect(b.max.z).toBeCloseTo(21, 6);
  });

  it("a column is centred on its position", () => {
    const b = bounds({
      id: "c",
      type: "column",
      name: "C",
      level: "L0",
      position: [4000, 4000],
      section: [400, 400],
      height: 4500,
      ...props,
    });
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(4, 6);
    expect(b.max.z).toBeCloseTo(4.5, 6);
  });
});

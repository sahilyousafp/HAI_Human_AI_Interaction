import type { Element, Level } from "@aex/protocol";
import { describe, expect, it } from "vitest";
import { elementBounds, unionBounds } from "./bounds.ts";

const levels: Level[] = [
  { id: "L0", name: "Ground", elevation: 0 },
  { id: "L1", name: "Level 1", elevation: 4500 },
];
const common = { name: "e", properties: {} };

describe("elementBounds", () => {
  it("massing: from its origin corner", () => {
    const e: Element = {
      ...common,
      id: "m",
      type: "massing",
      origin: [1000, 2000, 0],
      size: [6000, 6000, 3500],
    };
    expect(elementBounds(e, levels)).toEqual({ min: [1000, 2000, 0], max: [7000, 8000, 3500] });
  });

  it("wall along X: centred on its baseline, rising from its level", () => {
    const e: Element = {
      ...common,
      id: "w",
      type: "wall",
      level: "L1",
      start: [0, 0],
      end: [6000, 0],
      height: 3500,
      thickness: 300,
    };
    expect(elementBounds(e, levels)).toEqual({ min: [0, -150, 4500], max: [6000, 150, 8000] });
  });

  it("column: centred on its position", () => {
    const e: Element = {
      ...common,
      id: "c",
      type: "column",
      position: [500, 500],
      section: [400, 400],
      height: 3000,
    };
    expect(elementBounds(e, levels)).toEqual({ min: [300, 300, 0], max: [700, 700, 3000] });
  });

  it("slab: its outline, extruded down from its level", () => {
    const e: Element = {
      ...common,
      id: "s",
      type: "slab",
      level: "L1",
      outline: [
        [0, 0],
        [4000, 0],
        [4000, 3000],
      ],
      thickness: 250,
    };
    expect(elementBounds(e, levels)).toEqual({ min: [0, 0, 4250], max: [4000, 3000, 4500] });
  });
});

describe("unionBounds", () => {
  it("covers every box, and is null for none", () => {
    expect(
      unionBounds([
        { min: [0, 0, 0], max: [1, 1, 1] },
        { min: [-1, 2, 0], max: [0, 3, 5] },
      ]),
    ).toEqual({ min: [-1, 0, 0], max: [1, 3, 5] });
    expect(unionBounds([])).toBeNull();
  });
});

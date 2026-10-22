import type { Element, Level } from "@aex/protocol";
import { describe, expect, it } from "vitest";
import { elementBase, elementBounds, unionBounds } from "./bounds.ts";

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

  it("imported: its stored box moved by its translation", () => {
    const e: Element = {
      ...common,
      id: "i",
      type: "imported",
      asset: "0f8fad5b-d9cb-469f-a165-70867728950e",
      part: 0,
      bounds: { min: [0, 0, 0], max: [2000, 1000, 3000] },
      translation: [1000, -500, 0],
    };
    expect(elementBounds(e, levels)).toEqual({ min: [1000, -500, 0], max: [3000, 500, 3000] });
  });

  it("an element's own base wins over its level, and a level still gives the base without one", () => {
    const wall: Element = {
      ...common,
      id: "w",
      type: "wall",
      level: "L1",
      start: [0, 0],
      end: [6000, 0],
      height: 3000,
      thickness: 200,
    };
    expect(elementBase(wall, levels)).toBe(4500);
    expect(elementBase({ ...wall, base: 31_200 }, levels)).toBe(31_200);
    expect(elementBounds({ ...wall, base: 31_200 }, levels).max[2]).toBe(34_200);
    expect(elementBase({ ...wall, level: undefined }, levels)).toBe(0);
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

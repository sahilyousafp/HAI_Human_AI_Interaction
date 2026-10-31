import type { Point2, SceneDocument } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { idsInsideLoop, insideLoop, loopArea } from "./lasso.ts";
import { EMPTY_OVERLAY, type ToolContext } from "./types.ts";

const SQUARE: Point2[] = [
  [0.2, 0.2],
  [0.8, 0.2],
  [0.8, 0.8],
  [0.2, 0.8],
];

describe("the loop", () => {
  it("measures its area whichever way it was drawn", () => {
    expect(loopArea(SQUARE)).toBeCloseTo(0.36);
    expect(loopArea([...SQUARE].reverse())).toBeCloseTo(0.36);
    expect(
      loopArea([
        [0, 0],
        [1, 1],
      ]),
    ).toBe(0);
  });

  it("knows inside from outside, including a loop that is not convex", () => {
    expect(insideLoop([0.5, 0.5], SQUARE)).toBe(true);
    expect(insideLoop([0.9, 0.5], SQUARE)).toBe(false);
    const arrow: Point2[] = [
      [0, 0],
      [1, 0],
      [0.5, 0.4],
      [1, 1],
      [0, 1],
    ];
    expect(insideLoop([0.9, 0.5], arrow)).toBe(false);
    expect(insideLoop([0.2, 0.5], arrow)).toBe(true);
  });
});

/** A document of three columns in a row, seen from above with 1 mm to the pixel. */
const doc = (): SceneDocument => ({
  version: 1,
  units: "mm",
  up: "Z",
  name: "test",
  levels: [{ id: "L0", name: "Ground", elevation: 0 }],
  elements: Object.fromEntries(
    [0, 1, 2].map((i) => [
      `col-${i}`,
      {
        id: `col-${i}`,
        name: `Column ${i}`,
        type: "column" as const,
        level: "L0",
        properties: {},
        position: [200 + i * 300, 500] as [number, number],
        section: [100, 100] as [number, number],
        height: 3000,
      },
    ]),
  ),
});

function context(options: { hidden?: string[]; sectionMm?: number | null } = {}): ToolContext {
  return {
    doc,
    hidden: () => new Set(options.hidden ?? []),
    overlay: () => ({ ...EMPTY_OVERLAY, sectionMm: options.sectionMm ?? null }),
    toPixels: ([x, y]: Point2) => [x * 1000, y * 1000],
    toScreen: (point: readonly number[]) => [point[0] as number, point[1] as number],
  } as unknown as ToolContext;
}

describe("what a loop selects", () => {
  // The columns are at x = 200, 500 and 800 on screen, y = 500: a loop from x 0.4 to 0.9 holds the last two.
  const loop: Point2[] = [
    [0.4, 0.4],
    [0.9, 0.4],
    [0.9, 0.6],
    [0.4, 0.6],
  ];

  it("takes the elements whose middle is inside", () => {
    expect(idsInsideLoop(context(), loop)).toEqual(["col-1", "col-2"]);
  });

  it("leaves out what the user hid", () => {
    expect(idsInsideLoop(context({ hidden: ["col-2"] }), loop)).toEqual(["col-1"]);
  });

  it("leaves out what the section has cut away, and keeps what it only cuts through", () => {
    expect(idsInsideLoop(context({ sectionMm: 0 }), loop)).toEqual([]);
    expect(idsInsideLoop(context({ sectionMm: 1500 }), loop)).toEqual(["col-1", "col-2"]);
  });

  it("selects nothing when there is no model", () => {
    const empty = { ...context(), doc: () => null } as unknown as ToolContext;
    expect(idsInsideLoop(empty, loop)).toEqual([]);
  });
});

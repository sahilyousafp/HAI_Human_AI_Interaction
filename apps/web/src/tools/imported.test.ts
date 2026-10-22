import type { Element } from "@aex/protocol";
import { elementBounds } from "@aex/scene";
import { describe, expect, it } from "vitest";
import { moveOp } from "./builtin.ts";
import { shifted } from "./create.ts";
import { referencePoint } from "./placement.ts";

const imported: Element = {
  id: "imp-1",
  type: "imported",
  name: "Panel",
  properties: {},
  asset: "0f8fad5b-d9cb-469f-a165-70867728950e",
  part: 0,
  bounds: { min: [1000, 2000, 0], max: [3000, 3000, 3000] },
  translation: [500, 0, 250],
};

describe("imported elements in the tools", () => {
  it("Move changes the translation and leaves the asset and bounds alone", () => {
    expect(moveOp(imported, 1000, -200)).toEqual({
      op: "update",
      id: "imp-1",
      patch: { translation: [1500, -200, 250] },
    });
  });

  it("Copy shifts the translation of the copy", () => {
    const copy = shifted(imported, 4000, 0);
    expect(copy).toMatchObject({ asset: imported.asset, part: 0, translation: [4500, 0, 250] });
  });

  it("its bounds and its reference point follow the translation", () => {
    const doc = { version: 1, units: "mm", up: "Z", name: "t", levels: [], elements: {} } as const;
    expect(elementBounds(imported, [])).toEqual({ min: [1500, 2000, 250], max: [3500, 3000, 3250] });
    expect(referencePoint(imported, { ...doc, levels: [] })).toEqual([1500, 2000]);
  });
});

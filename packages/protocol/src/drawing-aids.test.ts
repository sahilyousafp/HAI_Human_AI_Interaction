import { describe, expect, it } from "vitest";
import { DEFAULT_DRAWING_AIDS, DRAWING_AID_IDS, DRAWING_AIDS, resolveDrawingAids } from "./drawing-aids.ts";

describe("drawing aids", () => {
  it("only Grid is on until the user changes it", () => {
    expect(DRAWING_AID_IDS.filter((id) => DEFAULT_DRAWING_AIDS[id])).toEqual(["grid"]);
    expect(resolveDrawingAids(null)).toEqual(DEFAULT_DRAWING_AIDS);
  });

  it("stored choices apply over the defaults, and unknown names are ignored", () => {
    const aids = resolveDrawingAids({ ortho: true, grid: false, teleport: true });
    expect(aids.ortho).toBe(true);
    expect(aids.grid).toBe(false);
    expect(aids.endpoint).toBe(false);
    expect(Object.keys(aids)).toEqual(DRAWING_AID_IDS);
  });

  it("every aid has a label and a one-line description", () => {
    for (const aid of DRAWING_AIDS) {
      expect(aid.label.length).toBeGreaterThan(0);
      expect(aid.description).not.toContain("\n");
    }
  });
});

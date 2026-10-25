import type { Element, SceneDocument, TaskScope } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { partIncludes, regionWithin, scopeWithin } from "./claim-scope.ts";

const column = (id: string, x: number, tags?: Record<string, string>): Element => ({
  id,
  name: id,
  type: "column",
  properties: {},
  position: [x, 0],
  section: [400, 400],
  height: 3000,
  ...(tags ? { tags } : {}),
});

const doc: SceneDocument = {
  version: 1,
  units: "mm",
  up: "Z",
  name: "t",
  levels: [],
  elements: Object.fromEntries(
    [column("a", 0, { "hai.part": "pavilion/dome" }), column("b", 50_000, { "hai.part": "garden" })].map(
      (e) => [e.id, e],
    ),
  ),
};

describe("sub-parts", () => {
  it("a part includes itself and what is written under it, not a longer name", () => {
    expect(partIncludes("pavilion", "pavilion")).toBe(true);
    expect(partIncludes("pavilion", "pavilion/dome")).toBe(true);
    expect(partIncludes("pavilion", "pavilion/dome/ribs")).toBe(true);
    expect(partIncludes("pavilion", "pavilionette")).toBe(false);
    expect(partIncludes("pavilion/dome", "pavilion")).toBe(false);
    expect(partIncludes("pavilion", undefined)).toBe(false);
  });
});

describe("a scope inside a claim", () => {
  it("anything is inside the whole model", () => {
    expect(scopeWithin({ part: "x" }, null, doc)).toEqual({ ok: true });
  });

  it("a sub-part is inside its part; another part is outside and the reason says how to write one", () => {
    expect(scopeWithin({ part: "pavilion/minarets" }, { part: "pavilion" }, doc)).toEqual({ ok: true });
    expect(scopeWithin({ part: "harbour" }, { part: "pavilion" }, doc)).toEqual({
      ok: false,
      reason:
        'the part "harbour" is outside your claim; a part inside "pavilion" is written "pavilion/<name>"',
    });
    expect(scopeWithin({ part: "x" }, { ids: ["a"] }, doc)).toMatchObject({ ok: false });
  });

  it("ids must be elements the claim takes in", () => {
    expect(scopeWithin({ ids: ["a"] }, { part: "pavilion" }, doc)).toEqual({ ok: true });
    expect(scopeWithin({ ids: ["b"] }, { part: "pavilion" }, doc)).toMatchObject({
      ok: false,
      reason: 'the element "b" is not in your claim',
    });
    expect(scopeWithin({ ids: ["zzz"] }, { part: "pavilion" }, doc)).toMatchObject({
      ok: false,
      reason: 'there is no element "zzz"',
    });
  });

  it("a region must lie inside the claim's region", () => {
    const claim: TaskScope = { region: { min: [0, 0], max: [10_000, 10_000] } };
    expect(scopeWithin({ region: { min: [1000, 1000], max: [5000, 5000] } }, claim, doc)).toEqual({
      ok: true,
    });
    expect(scopeWithin({ region: { min: [9000, 0], max: [12_000, 5000] } }, claim, doc)).toMatchObject({
      ok: false,
    });
    expect(scopeWithin({ region: { min: [0, 0], max: [1, 1] } }, { part: "p" }, doc)).toMatchObject({
      ok: false,
    });
    expect(regionWithin({ min: [1, 1, 5], max: [2, 2, 6] }, { min: [0, 0], max: [3, 3] })).toBe(true);
  });
});

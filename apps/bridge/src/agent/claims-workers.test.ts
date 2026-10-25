import type { Element, SceneDocument, SceneOp } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { ClaimTable } from "./claims.ts";

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
    [
      column("dome-1", 0, { "hai.part": "pavilion/dome" }),
      column("minaret-1", 5000, { "hai.part": "pavilion/minarets" }),
      column("hall-1", 10_000, { "hai.part": "pavilion" }),
      column("garden-1", 30_000, { "hai.part": "garden" }),
    ].map((e) => [e.id, e]),
  ),
};

const update = (id: string): SceneOp => ({ op: "update", id, patch: { name: "x" } });
const create = (element: Element): SceneOp => ({ op: "create", element });

/** A specialist holding the part "pavilion", with workers for its dome and its minarets. */
function family() {
  const claims = new ClaimTable();
  const parent = claims.grant({
    taskId: "p",
    agent: "architect",
    title: "Pavilion",
    scope: { part: "pavilion" },
  });
  const dome = claims.grant({
    taskId: "w1",
    agent: "architect.2",
    title: "Dome",
    scope: { part: "pavilion/dome" },
    parent: "p",
  });
  const minarets = claims.grant({
    taskId: "w2",
    agent: "architect.3",
    title: "Minarets",
    scope: { part: "pavilion/minarets" },
    parent: "p",
  });
  return { claims, parent, dome, minarets };
}

describe("claims cut from a parent's (workers)", () => {
  it("a sub-part is part of its parent's part, and a different part is not", () => {
    const claims = new ClaimTable();
    expect(claims.overlap({ part: "pavilion" }, { part: "pavilion/dome" }, doc)).toBe(true);
    expect(claims.overlap({ part: "pavilion/dome" }, { part: "pavilion/minarets" }, doc)).toBe(false);
    expect(claims.overlap({ part: "pavilion" }, { part: "pavilionette" }, doc)).toBe(false);
    expect(claims.covers({ scope: { part: "pavilion" } }, doc.elements["dome-1"] as Element, doc)).toBe(true);
    expect(claims.covers({ scope: { part: "pavilion" } }, doc.elements["garden-1"] as Element, doc)).toBe(
      false,
    );
  });

  it("a worker may change its own part, which is inside its parent's, and nothing else", () => {
    const { claims, dome } = family();
    expect(claims.check(dome, [update("dome-1")], doc)).toEqual({ ok: true });
    expect(claims.check(dome, [update("garden-1")], doc)).toMatchObject({
      ok: false,
      error: expect.stringContaining("outside your claim"),
    });
    // Not its sibling's part either: the sibling holds it.
    expect(claims.check(dome, [update("minaret-1")], doc)).toMatchObject({
      ok: false,
      error: expect.stringContaining(`claimed by architect.3's task "Minarets"`),
    });
  });

  it("the parent changes the rest of its claim but not what a running worker holds", () => {
    const { claims, parent } = family();
    expect(claims.check(parent, [update("hall-1")], doc)).toEqual({ ok: true });
    expect(claims.check(parent, [update("dome-1")], doc)).toMatchObject({
      ok: false,
      error: expect.stringContaining(`claimed by architect.2's task "Dome"`),
    });
    // A new element in a worker's part is refused to the parent too.
    const made = claims.check(parent, [create(column("dome-2", 100, { "hai.part": "pavilion/dome" }))], doc);
    expect(made).toMatchObject({ ok: false, error: expect.stringContaining("architect.2") });
  });

  it("the part returns to the parent when the worker ends", () => {
    const { claims, parent } = family();
    claims.release("w1");
    expect(claims.check(parent, [update("dome-1")], doc)).toEqual({ ok: true });
    expect(claims.check(parent, [update("minaret-1")], doc)).toMatchObject({ ok: false });
  });

  it("someone else's claim is held against a worker too, named by its task", () => {
    const { claims, dome } = family();
    claims.grant({ taskId: "g", agent: "product", title: "Garden", scope: { part: "garden" } });
    expect(claims.check(dome, [update("garden-1")], doc)).toMatchObject({
      ok: false,
      error: expect.stringContaining(`product's task "Garden"`),
    });
  });

  it("knows which claims are cut from which, through any number of levels", () => {
    const { claims, parent, dome } = family();
    const ribs = claims.grant({
      taskId: "w3",
      agent: "architect.4",
      title: "Ribs",
      scope: { part: "pavilion/dome/ribs" },
      parent: "w1",
    });
    expect(claims.isBelow(dome, "p")).toBe(true);
    expect(claims.isBelow(ribs, "p")).toBe(true);
    expect(claims.isBelow(parent, "w1")).toBe(false);
    expect(
      claims
        .below("p")
        .map((c) => c.taskId)
        .sort(),
    ).toEqual(["w1", "w2", "w3"]);
  });
});

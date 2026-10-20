import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseScene, type SceneDocument, type SceneOp } from "@aex/protocol";
import { describe, expect, it } from "vitest";
import { SceneStore } from "./scene-store.ts";

const sample = (): SceneDocument => {
  const parsed = parseScene(
    JSON.parse(readFileSync(join(import.meta.dirname, "..", "samples", "mixed-use-block.aex.json"), "utf8")),
  );
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.doc;
};
const column = (id: string, x: number): SceneOp => ({
  op: "create",
  element: {
    id,
    name: id,
    type: "column",
    properties: {},
    position: [x, 0],
    section: [400, 400],
    height: 3000,
  },
});
const moveWall: SceneOp = { op: "update", id: "wall-s", patch: { start: [4000, 3000], end: [20000, 3000] } };

describe("SceneStore turn groups (one agent turn, one undo step)", () => {
  it("undo a whole turn: four columns and a moved wall come back in one step", () => {
    const store = new SceneStore(sample());
    const wallBefore = structuredClone(store.doc.elements["wall-s"]);
    store.beginGroup("Add four columns and move the wall");
    for (const [i, x] of [0, 4000, 8000, 12000].entries()) {
      const r = store.applyInGroup([column(`new-c${i}`, x)]);
      expect(r.ok).toBe(true);
    }
    store.applyInGroup([moveWall]);
    // Each change is visible at once...
    expect(Object.keys(store.doc.elements).filter((id) => id.startsWith("new-c"))).toHaveLength(4);
    const end = store.endGroup();
    expect(end?.ok && end.patch.ops).toEqual([]); // tells clients they can undo now
    expect(store.canUndo).toBe(true);
    // ...and one undo reverts the whole turn.
    const undone = store.undo();
    expect(undone.ok && undone.patch.label).toBe("Add four columns and move the wall");
    expect(Object.keys(store.doc.elements).filter((id) => id.startsWith("new-c"))).toEqual([]);
    expect(store.doc.elements["wall-s"]).toEqual(wallBefore);
    expect(store.canUndo).toBe(false);
  });

  it("each change in a turn is broadcast at once, labelled with the request", () => {
    const store = new SceneStore(sample());
    store.beginGroup("add a column");
    const r = store.applyInGroup([column("new-c", 0)]);
    expect(r.ok && r.patch).toMatchObject({
      kind: "apply",
      label: "add a column",
      ops: [column("new-c", 0)],
    });
  });

  it("a turn that changed nothing leaves no undo step", () => {
    const store = new SceneStore(sample());
    store.beginGroup("just a question");
    expect(store.endGroup()).toBeNull();
    expect(store.canUndo).toBe(false);
  });

  it("an invalid batch in a turn changes nothing and is not part of the turn", () => {
    const store = new SceneStore(sample());
    store.beginGroup("walls");
    const bad: SceneOp[] = [column("ok-c", 0), { op: "update", id: "wall-s", patch: { height: 0 } }];
    const r = store.applyInGroup(bad);
    expect(r.ok).toBe(false);
    expect(store.doc.elements["ok-c"]).toBeUndefined();
    expect(store.endGroup()).toBeNull();
  });

  it("the user's own edit during a turn stays a separate step", () => {
    const store = new SceneStore(sample());
    store.beginGroup("agent turn");
    store.applyInGroup([column("agent-c", 0)]);
    store.apply("Delete", [{ op: "delete", id: "block-c" }]);
    store.endGroup();
    store.undo(); // the agent turn, recorded last
    expect(store.doc.elements["agent-c"]).toBeUndefined();
    expect(store.doc.elements["block-c"]).toBeUndefined();
    store.undo(); // then the user's delete
    expect(store.doc.elements["block-c"]).toBeDefined();
  });

  it("undo during a turn undoes the turn so far; later changes in the turn are a new step", () => {
    const store = new SceneStore(sample());
    store.beginGroup("agent turn");
    store.applyInGroup([column("first", 0)]);
    store.undo();
    expect(store.doc.elements.first).toBeUndefined();
    store.applyInGroup([column("second", 0)]);
    store.endGroup();
    store.undo();
    expect(store.doc.elements.second).toBeUndefined();
  });
});

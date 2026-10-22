import type { Element, SceneDocument, SceneOp } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { History } from "./history.ts";
import { applyOp, applyTransaction } from "./ops.ts";

const column = (id: string, x: number): Element => ({
  id,
  type: "column",
  name: id,
  level: "L0",
  position: [x, 0],
  section: [400, 400],
  height: 3000,
  properties: {},
});

const base: SceneDocument = {
  version: 1,
  units: "mm",
  up: "Z",
  name: "Test",
  levels: [{ id: "L0", name: "Ground", elevation: 0 }],
  elements: { c1: column("c1", 0), c2: column("c2", 6000), c3: column("c3", 12000) },
};

describe("applyOp", () => {
  it("create, update and delete each return an exact inverse", () => {
    const ops: SceneOp[] = [
      { op: "create", element: column("c4", 18000) },
      { op: "update", id: "c1", patch: { position: [100, 200], name: "Corner" } },
      { op: "delete", id: "c2" },
    ];
    for (const op of ops) {
      const forward = applyOp(base, op);
      expect(forward.ok).toBe(true);
      if (!forward.ok) continue;
      const back = applyOp(forward.doc, forward.inverse);
      expect(back.ok && back.doc).toEqual(base);
    }
  });

  it("adding an optional field is undone by removing it, even after a JSON round trip", () => {
    const { level: _level, ...unlevelled } = column("c9", 0);
    const doc = { ...base, elements: { ...base.elements, c9: unlevelled as Element } };
    const forward = applyOp(doc, { op: "update", id: "c9", patch: { level: "L0" } });
    if (!forward.ok) throw new Error(forward.error);
    const inverse = JSON.parse(JSON.stringify(forward.inverse)) as SceneOp;
    const back = applyOp(forward.doc, inverse);
    expect(back.ok && back.doc).toEqual(doc);
  });

  it("an update cannot change id or type", () => {
    const result = applyOp(base, { op: "update", id: "c1", patch: { id: "x", type: "wall" } });
    expect(result.ok && result.doc.elements.c1?.type).toBe("column");
    expect(result.ok && result.doc.elements.x).toBeUndefined();
  });

  it("an invalid update is rejected with the element and field", () => {
    const result = applyOp(base, { op: "update", id: "c1", patch: { height: 0 } });
    expect(result).toEqual({ ok: false, error: 'Element "c1": height must be greater than 0' });
  });

  it("rejects duplicates, missing elements and unknown levels", () => {
    expect(applyOp(base, { op: "create", element: column("c1", 0) }).ok).toBe(false);
    expect(applyOp(base, { op: "delete", id: "nope" }).ok).toBe(false);
    expect(applyOp(base, { op: "update", id: "c1", patch: { level: "L9" } }).ok).toBe(false);
  });
});

describe("transactions and history (spec: all edits are undoable transactions)", () => {
  it("multi-element transaction undoes at once", () => {
    const history = new History();
    const ops: SceneOp[] = ["c1", "c2", "c3"].map((id) => ({
      op: "update",
      id,
      patch: { position: [(base.elements[id] as Extract<Element, { type: "column" }>).position[0], 1500] },
    }));
    const moved = applyTransaction(base, ops);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    history.record({ label: "Move columns", ops, inverse: moved.inverse });
    const undone = history.undo(moved.doc);
    expect(undone.ok && undone.doc).toEqual(base);
    expect(undone.ok && undone.label).toBe("Move columns");
    // and redo reapplies the whole transaction
    const redone = history.redo(base);
    expect(redone.ok && redone.doc).toEqual(moved.doc);
  });

  it("a failing op leaves the document unchanged (atomic)", () => {
    const result = applyTransaction(base, [
      { op: "update", id: "c1", patch: { position: [1, 1] } },
      { op: "update", id: "c2", patch: { height: -5 } },
    ]);
    expect(result.ok).toBe(false);
  });

  it("a new edit clears redo", () => {
    const history = new History();
    const first = applyTransaction(base, [{ op: "delete", id: "c3" }]);
    if (!first.ok) throw new Error(first.error);
    history.record({ label: "Delete", ops: [{ op: "delete", id: "c3" }], inverse: first.inverse });
    history.undo(first.doc);
    expect(history.canRedo).toBe(true);
    history.record({ label: "Other", ops: [], inverse: [] });
    expect(history.canRedo).toBe(false);
  });

  it("property: applying any random transaction and then its inverse returns the original", () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let round = 0; round < 200; round++) {
      let doc = base;
      const ops: SceneOp[] = [];
      for (let i = 0; i < 1 + Math.floor(rand() * 5); i++) {
        const ids = Object.keys(doc.elements);
        const pick = ids[Math.floor(rand() * ids.length)];
        const r = rand();
        let op: SceneOp;
        if (r < 0.3 || !pick) op = { op: "create", element: column(`n${round}-${i}`, rand() * 1e4) };
        else if (r < 0.7)
          op = {
            op: "update",
            id: pick,
            patch: { height: 1000 + Math.round(rand() * 5000), name: `r${round}` },
          };
        else op = { op: "delete", id: pick };
        const step = applyOp(doc, op);
        if (step.ok) {
          doc = step.doc;
          ops.push(op);
        }
      }
      const forward = applyTransaction(base, ops);
      expect(forward.ok).toBe(true);
      if (!forward.ok) return;
      const back = applyTransaction(forward.doc, forward.inverse);
      expect(back.ok && back.doc).toEqual(base);
    }
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseScene, type SceneDocument, type SceneOp } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { SceneStore } from "./scene-store.ts";

const sample = (): SceneDocument => {
  const parsed = parseScene(
    JSON.parse(readFileSync(join(import.meta.dirname, "..", "samples", "mixed-use-block.hai.json"), "utf8")),
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
const AGENT = "architect";
const moveWall: SceneOp = { op: "update", id: "wall-s", patch: { start: [4000, 3000], end: [20000, 3000] } };

describe("SceneStore turn groups (one agent turn, one undo step)", () => {
  it("undo a whole turn: four columns and a moved wall come back in one step", () => {
    const store = new SceneStore(sample());
    const wallBefore = structuredClone(store.doc.elements["wall-s"]);
    store.beginGroup(AGENT, "Add four columns and move the wall");
    for (const [i, x] of [0, 4000, 8000, 12000].entries()) {
      const r = store.applyInGroup([column(`new-c${i}`, x)], AGENT);
      expect(r.ok).toBe(true);
    }
    store.applyInGroup([moveWall], AGENT);
    // Each change is visible at once...
    expect(Object.keys(store.doc.elements).filter((id) => id.startsWith("new-c"))).toHaveLength(4);
    const end = store.endGroup(AGENT);
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
    store.beginGroup(AGENT, "add a column");
    const r = store.applyInGroup([column("new-c", 0)], AGENT);
    expect(r.ok && r.patch).toMatchObject({
      kind: "apply",
      label: "add a column",
      ops: [column("new-c", 0)],
    });
  });

  it("a turn that changed nothing leaves no undo step", () => {
    const store = new SceneStore(sample());
    store.beginGroup(AGENT, "just a question");
    expect(store.endGroup(AGENT)).toBeNull();
    expect(store.canUndo).toBe(false);
  });

  it("an invalid batch in a turn changes nothing and is not part of the turn", () => {
    const store = new SceneStore(sample());
    store.beginGroup(AGENT, "walls");
    const bad: SceneOp[] = [column("ok-c", 0), { op: "update", id: "wall-s", patch: { height: 0 } }];
    const r = store.applyInGroup(bad, AGENT);
    expect(r.ok).toBe(false);
    expect(store.doc.elements["ok-c"]).toBeUndefined();
    expect(store.endGroup(AGENT)).toBeNull();
  });

  it("the user's own edit during a turn stays a separate step", () => {
    const store = new SceneStore(sample());
    store.beginGroup(AGENT, "agent turn");
    store.applyInGroup([column("agent-c", 0)], AGENT);
    store.apply("Delete", [{ op: "delete", id: "block-c" }]);
    store.endGroup(AGENT);
    store.undo(); // the agent turn, recorded last
    expect(store.doc.elements["agent-c"]).toBeUndefined();
    expect(store.doc.elements["block-c"]).toBeUndefined();
    store.undo(); // then the user's delete
    expect(store.doc.elements["block-c"]).toBeDefined();
  });

  it("undo during a turn undoes the turn so far; later changes in the turn are a new step", () => {
    const store = new SceneStore(sample());
    store.beginGroup(AGENT, "agent turn");
    store.applyInGroup([column("first", 0)], AGENT);
    store.undo();
    expect(store.doc.elements.first).toBeUndefined();
    store.applyInGroup([column("second", 0)], AGENT);
    store.endGroup(AGENT);
    store.undo();
    expect(store.doc.elements.second).toBeUndefined();
  });
});

describe("SceneStore with several agents at once (one group each)", () => {
  const ARCH = "architect";
  const PROD = "product";

  it("two agents, two steps: each is labelled and undoing one leaves the other's elements", () => {
    const store = new SceneStore(sample());
    store.beginGroup(ARCH, "Architect: dome");
    store.beginGroup(PROD, "Product: seating");
    store.applyInGroup([column("dome-1", 0)], ARCH);
    store.applyInGroup([column("seat-1", 5000)], PROD);
    store.applyInGroup([column("dome-2", 1000)], ARCH);
    store.applyInGroup([column("seat-2", 6000)], PROD);
    store.endGroup(ARCH);
    store.endGroup(PROD);

    const first = store.undo();
    expect(first.ok && first.patch.label).toBe("Product: seating");
    expect(store.doc.elements["seat-1"]).toBeUndefined();
    expect(store.doc.elements["seat-2"]).toBeUndefined();
    expect(store.doc.elements["dome-1"]).toBeDefined();
    expect(store.doc.elements["dome-2"]).toBeDefined();

    const second = store.undo();
    expect(second.ok && second.patch.label).toBe("Architect: dome");
    expect(store.doc.elements["dome-1"]).toBeUndefined();
    expect(store.canUndo).toBe(false);
  });

  it("every change says who made it", () => {
    const store = new SceneStore(sample());
    store.beginGroup(ARCH, "Architect: dome");
    const agent = store.applyInGroup([column("dome-1", 0)], ARCH);
    expect(agent.ok && agent.patch.by).toBe(ARCH);
    const user = store.apply("Delete", [{ op: "delete", id: "block-c" }]);
    expect(user.ok && user.patch.by).toBe("user");
    const closed = store.endGroup(ARCH);
    expect(closed?.ok && closed.patch.by).toBe(ARCH);
    const undone = store.undo();
    expect(undone.ok && undone.patch.by).toBe("user");
  });

  it("an agent without a turn is an ordinary transaction under its own name", () => {
    const store = new SceneStore(sample());
    const r = store.applyInGroup([column("loose", 0)], ARCH, "Agent");
    expect(r.ok && r.patch).toMatchObject({ by: ARCH, label: "Agent" });
    expect(store.canUndo).toBe(true);
  });

  it("undo while agents work records each agent's work so far, they carry on in a new step, and the newest is undone", () => {
    const store = new SceneStore(sample());
    store.beginGroup(ARCH, "Architect: dome");
    store.beginGroup(PROD, "Product: seating");
    store.applyInGroup([column("dome-1", 0)], ARCH);
    store.applyInGroup([column("seat-1", 5000)], PROD);

    const undone = store.undo();
    expect(undone.ok && undone.patch.label).toBe("Product: seating");
    expect(store.doc.elements["seat-1"]).toBeUndefined();
    expect(store.doc.elements["dome-1"]).toBeDefined();

    // Both carry on in a fresh step with the same label.
    store.applyInGroup([column("dome-2", 1000)], ARCH);
    store.applyInGroup([column("seat-2", 6000)], PROD);
    store.endGroup(ARCH);
    store.endGroup(PROD);
    const again = store.undo();
    expect(again.ok && again.patch.label).toBe("Product: seating");
    expect(store.doc.elements["seat-2"]).toBeUndefined();
    expect(store.doc.elements["dome-2"]).toBeDefined();
    const last = store.undo();
    expect(last.ok && last.patch.label).toBe("Architect: dome");
    expect(store.doc.elements["dome-2"]).toBeUndefined();
    expect(store.doc.elements["dome-1"]).toBeDefined();
  });

  /** A tiny seeded generator so a failing interleaving can be reproduced. */
  const random = (start: number) => {
    let seed = start;
    return () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
  };

  it("any interleaving of two agents on disjoint elements, undone in either order, returns the original scene", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const next = random(seed);
      const store = new SceneStore(sample());
      const original = structuredClone(store.doc);
      store.beginGroup(ARCH, "Architect");
      store.beginGroup(PROD, "Product");
      // Architect works on its own new columns and wall-s; Product on its own new columns and block-c.
      const steps: Array<[string, SceneOp]> = [
        [ARCH, column("a1", 0)],
        [ARCH, column("a2", 1000)],
        [ARCH, moveWall],
        [PROD, column("p1", 5000)],
        [PROD, column("p2", 6000)],
        [PROD, { op: "update", id: "block-c", patch: { name: "Moved by product" } }],
      ];
      // Keep each agent's own order, interleave the two at random.
      const queues = { [ARCH]: steps.filter(([a]) => a === ARCH), [PROD]: steps.filter(([a]) => a === PROD) };
      while (queues[ARCH].length + queues[PROD].length > 0) {
        const pick =
          queues[ARCH].length === 0 ? PROD : queues[PROD].length === 0 ? ARCH : next() < 0.5 ? ARCH : PROD;
        const [agent, op] = queues[pick].shift() as [string, SceneOp];
        expect(store.applyInGroup([op], agent).ok).toBe(true);
        if (next() < 0.15) store.undo(); // a user undo in the middle must not break the rest
      }
      store.endGroup(ARCH);
      store.endGroup(PROD);
      while (store.canUndo) store.undo();
      // Undoing everything, in whatever order the steps were recorded, restores the original scene.
      expect(store.doc.elements["wall-s"], `seed ${seed}`).toEqual(original.elements["wall-s"]);
      expect(store.doc.elements["block-c"], `seed ${seed}`).toEqual(original.elements["block-c"]);
      expect(Object.keys(store.doc.elements).sort(), `seed ${seed}`).toEqual(
        Object.keys(original.elements).sort(),
      );
    }
  });
});

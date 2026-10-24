import type { Message, RhinoObject } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { RhinoMirror } from "./rhino-mirror.ts";

const ASSET = "0f8fad5b-d9cb-469f-a165-70867728950e";
const object = (id: string, extra: Partial<RhinoObject> = {}): RhinoObject => ({
  id,
  name: id,
  type: "brep",
  layer: "Default",
  color: null,
  bounds: { min: [0, 0, 0], max: [1000, 1000, 500] },
  asset: ASSET,
  triangles: 12,
  tags: {},
  ...extra,
});
const notDrawn = { curves: 0, points: 0, annotations: 0, other: 0, heavy: 0 };
const batch = (partial: Record<string, unknown> = {}) =>
  ({
    type: "rhino.objects",
    id: "b",
    payload: { changed: [], deleted: [], notDrawn, sync: null, reset: false, changedAt: 1000, ...partial },
  }) as Message;
const state = (partial: Record<string, unknown> = {}) =>
  ({
    type: "rhino.state",
    id: "s",
    payload: {
      connected: true,
      mode: "auto",
      inUse: "rhino",
      python: { state: "ready" },
      document: "tower.3dm",
      objects: [],
      notDrawn,
      sync: null,
      selection: [],
      ...partial,
    },
  }) as Message;

function setup() {
  const sent: Message[] = [];
  const mirror = new RhinoMirror((m) => {
    sent.push(m);
    return true;
  });
  return { mirror, sent };
}

describe("RhinoMirror", () => {
  it("starts disconnected, and takes the state the bridge sends", () => {
    const { mirror } = setup();
    expect(mirror.getSnapshot()).toMatchObject({ connected: false, objects: [], inUse: "python" });
    mirror.handle(state({ objects: [object("a")] }));
    expect(mirror.getSnapshot()).toMatchObject({ connected: true, inUse: "rhino", document: "tower.3dm" });
    expect(mirror.has("a")).toBe(true);
  });

  it("a new object appears, a changed one is replaced, a deleted one goes", () => {
    const { mirror } = setup();
    mirror.handle(state());
    mirror.handle(batch({ reset: true, changed: [object("a"), object("b")] }));
    expect(mirror.getSnapshot().objects.map((o) => o.id)).toEqual(["a", "b"]);
    mirror.handle(batch({ changed: [object("a", { name: "Renamed" })] }));
    expect(mirror.getSnapshot().objects.find((o) => o.id === "a")?.name).toBe("Renamed");
    mirror.handle(batch({ deleted: ["b"] }));
    expect(mirror.getSnapshot().objects.map((o) => o.id)).toEqual(["a"]);
    expect(mirror.has("b")).toBe(false);
  });

  it("a reset replaces everything held", () => {
    const { mirror } = setup();
    mirror.handle(batch({ reset: true, changed: [object("a")] }));
    mirror.handle(batch({ reset: true, changed: [object("z")] }));
    expect(mirror.getSnapshot().objects.map((o) => o.id)).toEqual(["z"]);
  });

  it("what is not drawn is counted, and the first sync reports its progress then finishes once", () => {
    const { mirror } = setup();
    mirror.handle(
      batch({
        reset: true,
        sync: { done: 1, total: 3 },
        changed: [object("a")],
        notDrawn: { ...notDrawn, curves: 12 },
      }),
    );
    expect(mirror.getSnapshot()).toMatchObject({
      sync: { done: 1, total: 3 },
      notDrawn: { curves: 12 },
      synced: 0,
    });
    mirror.handle(batch({ sync: { done: 2, total: 3 }, changed: [object("b")] }));
    expect(mirror.getSnapshot().synced).toBe(0);
    mirror.handle(batch({ sync: null, changed: [object("c")] }));
    expect(mirror.getSnapshot()).toMatchObject({ sync: null, synced: 1 });
    mirror.handle(batch({ changed: [object("d")] })); // an ordinary edit is not a new sync
    expect(mirror.getSnapshot().synced).toBe(1);
  });

  it("a small document that arrives in one batch counts as synced", () => {
    const { mirror } = setup();
    mirror.handle(batch({ reset: true, changed: [object("a")], sync: null }));
    expect(mirror.getSnapshot().synced).toBe(1);
  });

  it("its box covers every object, in millimetres", () => {
    const { mirror } = setup();
    expect(mirror.bounds()).toBeNull();
    mirror.handle(
      batch({
        reset: true,
        changed: [
          object("a", { bounds: { min: [0, 0, 0], max: [1000, 2000, 3000] } }),
          object("b", { bounds: { min: [-500, 100, 0], max: [200, 300, 4000] } }),
        ],
      }),
    );
    expect(mirror.bounds()).toEqual({ min: [-500, 0, 0], max: [1000, 2000, 4000] });
  });

  it("Rhino's selection is held, and an object that goes leaves it", () => {
    const { mirror } = setup();
    mirror.handle(batch({ reset: true, changed: [object("a"), object("b")] }));
    mirror.handle({
      type: "rhino.selection",
      id: "x",
      payload: {
        objects: [
          { id: "a", type: "Brep", layer: "L" },
          { id: "b", type: "Brep", layer: "L" },
        ],
      },
    });
    expect(mirror.getSnapshot().selection).toEqual(["a", "b"]);
    mirror.handle(batch({ deleted: ["a"] }));
    expect(mirror.getSnapshot().selection).toEqual(["b"]);
  });

  it("a pick selects in Rhino and highlights at once; an unknown object is refused", () => {
    const { mirror, sent } = setup();
    mirror.handle(batch({ reset: true, changed: [object("a")] }));
    expect(mirror.select(["a"])).toBe(true);
    expect(sent).toEqual([expect.objectContaining({ type: "rhino.select", payload: { ids: ["a"] } })]);
    expect(mirror.getSnapshot().selection).toEqual(["a"]);
    expect(mirror.select(["nope"])).toBe(false);
    expect(sent).toHaveLength(1);
    expect(mirror.select([])).toBe(true);
    expect(mirror.getSnapshot().selection).toEqual([]);
  });

  it("disconnect empties the mirror", () => {
    const { mirror } = setup();
    mirror.handle(state({ objects: [object("a")] }));
    mirror.handle(state({ connected: false, inUse: "python", python: null, document: null }));
    expect(mirror.getSnapshot()).toMatchObject({ connected: false, objects: [] });
    expect(mirror.has("a")).toBe(false);
  });

  it("ignores messages that are not about Rhino", () => {
    const { mirror } = setup();
    expect(mirror.handle({ type: "scene.undo", id: "u", payload: {} } as Message)).toBe(false);
  });
});

describe("Rhino to HAI latency", () => {
  it("is measured from the plugin's stamp to the frame that has the mesh", () => {
    const { mirror } = setup();
    mirror.handle(batch({ reset: true, changedAt: 1000, changed: [object("a")] }));
    expect(mirror.latencyP90()).toBeNull();
    // The mesh has not arrived: the frame does not count yet.
    expect(mirror.frameDrawn(() => false, 1100)).toBe(true);
    expect(mirror.latencyP90()).toBeNull();
    expect(mirror.frameDrawn(() => true, 1160)).toBe(false);
    expect(mirror.latencyP90()).toBeCloseTo(160, 0);
  });

  it("a batch that only deletes is drawn by the next frame", () => {
    const { mirror } = setup();
    mirror.handle(batch({ deleted: ["a"], changedAt: 5000 }));
    mirror.frameDrawn(() => false, 5040);
    expect(mirror.latencyP90()).toBeCloseTo(40, 0);
  });

  it("the p90 of many edits stays under the 300 ms budget when frames follow quickly", () => {
    const { mirror } = setup();
    for (let i = 0; i < 50; i++) {
      mirror.handle(batch({ changedAt: 10_000 + i * 20, changed: [object(`o${i}`)] }));
      mirror.frameDrawn(() => true, 10_000 + i * 20 + 30 + (i % 7) * 10);
    }
    expect(mirror.latencyP90()).toBeLessThan(300);
  });
});

describe("the status the chrome shows", () => {
  it("is the same object through edits and selection changes, so the app does not redraw for them", () => {
    const { mirror } = setup();
    mirror.handle(state());
    const before = mirror.getStatus();
    mirror.handle(batch({ changed: [object("a")] }));
    mirror.handle(batch({ changed: [object("a", { name: "moved" })], notDrawn: { ...notDrawn } }));
    mirror.handle({
      type: "rhino.selection",
      id: "x",
      payload: { objects: [{ id: "a", type: "brep", layer: "Default" }] },
    } as Message);
    expect(mirror.getStatus()).toBe(before);
  });

  it("changes when what it shows changes", () => {
    const { mirror } = setup();
    mirror.handle(state());
    const connected = mirror.getStatus();
    mirror.handle(batch({ sync: { done: 5, total: 50 } }));
    expect(mirror.getStatus()).not.toBe(connected);
    expect(mirror.getStatus().sync).toEqual({ done: 5, total: 50 });
    const syncing = mirror.getStatus();
    mirror.handle(batch({ notDrawn: { ...notDrawn, curves: 3 }, sync: { done: 5, total: 50 } }));
    expect(mirror.getStatus()).not.toBe(syncing);
    mirror.handle(state({ connected: false }));
    expect(mirror.getStatus().connected).toBe(false);
  });
});

import type { HostId, HostObject, Message } from "@hai/protocol";
import { describe, expect, it, vi } from "vitest";
import { EDIT_TIMEOUT_MS, HostMirror, HostMirrors } from "./host-mirror.ts";

const ASSET = "0f8fad5b-d9cb-469f-a165-70867728950e";
const object = (id: string, extra: Partial<HostObject> = {}): HostObject => ({
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
const notDrawn = { curves: 0, points: 0, annotations: 0, other: 0, heavy: 0, simplified: 0 };
const batch = (partial: Record<string, unknown> = {}, host: HostId = "rhino") =>
  ({
    type: "host.objects",
    id: "b",
    payload: {
      host,
      changed: [],
      deleted: [],
      notDrawn,
      sync: null,
      reset: false,
      changedAt: 1000,
      ...partial,
    },
  }) as Message;
const state = (partial: Record<string, unknown> = {}, host: HostId = "rhino") =>
  ({
    type: "host.state",
    id: "s",
    payload: {
      host,
      switchedOn: true,
      connected: true,
      app: { name: "Rhino 8", version: "8.36.0" },
      run: { state: "ready" },
      capabilities: null,
      document: "tower.3dm",
      objects: [],
      notDrawn,
      sync: null,
      selection: [],
      components: [],
      ...partial,
    },
  }) as Message;
const selection = (ids: string[], host: HostId = "rhino", components?: unknown[]) =>
  ({
    type: "host.selection",
    id: "x",
    payload: {
      host,
      objects: ids.map((id) => ({ id, type: "Brep", layer: "L" })),
      ...(components ? { components } : {}),
    },
  }) as Message;

function setup() {
  const sent: Message[] = [];
  const mirror = new HostMirror("rhino", (m) => {
    sent.push(m);
    return true;
  });
  return { mirror, sent };
}

describe("HostMirror", () => {
  it("starts disconnected, and takes the state the bridge sends", () => {
    const { mirror } = setup();
    expect(mirror.getSnapshot()).toMatchObject({ connected: false, objects: [], app: null });
    mirror.handle(state({ objects: [object("a")] }));
    expect(mirror.getSnapshot()).toMatchObject({ connected: true, switchedOn: true, document: "tower.3dm" });
    expect(mirror.has("a")).toBe(true);
  });

  it("takes only its own host's messages", () => {
    const { mirror } = setup();
    expect(mirror.handle(state({ objects: [object("b")] }, "blender"))).toBe(false);
    expect(mirror.handle(batch({ reset: true, changed: [object("b")] }, "blender"))).toBe(false);
    expect(mirror.has("b")).toBe(false);
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

  it("frames what the model is about: not its planting, nor a backdrop such as a sky dome", () => {
    const { mirror } = setup();
    const box = (x: number, size: number) => ({
      min: [x, 0, 0] as [number, number, number],
      max: [x + size, size, size] as [number, number, number],
    });
    const building = [0, 1, 2, 3, 4].map((i) => object(`part-${i}`, { bounds: box(i * 5000, 5000) }));
    const trees = Array.from({ length: 8 }, (_, i) =>
      object(`tree-${i}`, {
        asset: "tree-mesh",
        transform: [1, 0, 0, 900_000 + i, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        bounds: box(900_000 + i, 5000),
      }),
    );
    const minaret = object("minaret", {
      asset: "minaret-mesh",
      transform: [1, 0, 0, 10_000, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      bounds: box(10_000, 5000),
    });
    const sky = object("sky", { bounds: box(-1_000_000, 2_000_000) });
    mirror.handle(batch({ reset: true, changed: [...building, ...trees, minaret, sky] }));
    expect(mirror.framingBounds()).toEqual({ min: [0, 0, 0], max: [25_000, 5000, 5000] });
    expect(mirror.bounds()?.max[0]).toBeGreaterThan(900_000);
  });

  it("frames all of it when all of it is planting", () => {
    const { mirror } = setup();
    const trees = Array.from({ length: 8 }, (_, i) =>
      object(`tree-${i}`, {
        asset: "tree-mesh",
        transform: [1, 0, 0, i * 1000, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        bounds: { min: [i * 1000, 0, 0], max: [i * 1000 + 500, 500, 500] },
      }),
    );
    mirror.handle(batch({ reset: true, changed: trees }));
    expect(mirror.framingBounds()?.max[0]).toBe(7500);
  });

  it("the host's selection is held with its description, and an object that goes leaves both", () => {
    const { mirror } = setup();
    mirror.handle(batch({ reset: true, changed: [object("a"), object("b")] }));
    mirror.handle(selection(["a", "b"]));
    expect(mirror.getSnapshot().selection).toEqual(["a", "b"]);
    mirror.handle(batch({ deleted: ["a"] }));
    expect(mirror.getSnapshot().selection).toEqual(["b"]);
  });

  it("the selection's description arrives with it", () => {
    const { mirror } = setup();
    mirror.handle(batch({ reset: true, changed: [object("a"), object("b")] }));
    const described = {
      id: "a",
      name: "a",
      type: "Closed Brep",
      layer: "L",
      bounds: null,
      quantities: {},
      quantitiesSkipped: false,
      material: "Timber",
      properties: {},
    };
    mirror.handle(selection(["a"], "rhino", [described]));
    expect(mirror.getSnapshot().components.map((c) => c.material)).toEqual(["Timber"]);
    mirror.handle(batch({ deleted: ["a"] }));
    expect(mirror.getSnapshot().components).toEqual([]);
  });

  it("a pick selects in its host and highlights at once; an unknown object is refused", () => {
    const { mirror, sent } = setup();
    mirror.handle(batch({ reset: true, changed: [object("a")] }));
    expect(mirror.select(["a"])).toBe(true);
    expect(sent).toEqual([
      expect.objectContaining({ type: "host.select", payload: { host: "rhino", ids: ["a"] } }),
    ]);
    expect(mirror.getSnapshot().selection).toEqual(["a"]);
    expect(mirror.select(["nope"])).toBe(false);
    expect(sent).toHaveLength(1);
    expect(mirror.select([])).toBe(true);
    expect(mirror.getSnapshot().selection).toEqual([]);
  });

  it("disconnect empties the mirror", () => {
    const { mirror } = setup();
    mirror.handle(state({ objects: [object("a")] }));
    mirror.handle(state({ connected: false, app: null, run: null, document: null }));
    expect(mirror.getSnapshot()).toMatchObject({ connected: false, objects: [] });
    expect(mirror.has("a")).toBe(false);
  });

  it("ignores messages that are not about a host", () => {
    const { mirror } = setup();
    expect(mirror.handle({ type: "scene.undo", id: "u", payload: {} } as Message)).toBe(false);
  });
});

describe("host to HAI latency", () => {
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
    mirror.handle(selection(["a"]));
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

describe("HostMirrors", () => {
  function many() {
    const sent: Message[] = [];
    const mirrors = new HostMirrors((m) => {
      sent.push(m);
      return true;
    });
    mirrors.handle(batch({ reset: true, changed: [object("r1")] }, "rhino"));
    mirrors.handle(batch({ reset: true, changed: [object("b1", { type: "object" })] }, "blender"));
    return { mirrors, sent };
  }

  it("two hosts at once: each message goes to its host, and an object is found in the host that has it", () => {
    const { mirrors } = many();
    expect(mirrors.owner("r1")?.host).toBe("rhino");
    expect(mirrors.owner("b1")?.host).toBe("blender");
    expect(mirrors.object("b1")?.host).toBe("blender");
    expect(mirrors.owner("nope")).toBeUndefined();
  });

  it("a pick selects in the owning host and clears the others", () => {
    const { mirrors, sent } = many();
    mirrors.handle(selection(["b1"], "blender"));
    expect(mirrors.select(["r1"])).toBe(true);
    expect(sent.at(-1)).toMatchObject({ type: "host.select", payload: { host: "rhino", ids: ["r1"] } });
    expect(mirrors.byHost.blender.getSnapshot().selection).toEqual([]);
    expect(mirrors.selection).toEqual(["r1"]);
  });

  it("a pick across two hosts, or of something no host has, is not theirs", () => {
    const { mirrors } = many();
    expect(mirrors.select(["r1", "b1"])).toBe(false);
    expect(mirrors.select(["wall-1"])).toBe(false);
  });

  it("a tap on empty space clears every host that has a selection", () => {
    const { mirrors, sent } = many();
    mirrors.handle(selection(["r1"], "rhino"));
    mirrors.handle(selection(["b1"], "blender"));
    mirrors.clear();
    expect(
      sent
        .filter((m) => m.type === "host.select")
        .map((m) => (m.payload as { host: string }).host)
        .sort(),
    ).toEqual(["blender", "rhino"]);
    expect(mirrors.selection).toEqual([]);
  });

  it("frames every host's model together, and counts each arrival", () => {
    const { mirrors } = many();
    expect(mirrors.synced).toBe(2);
    expect(mirrors.framingBounds()).toEqual({ min: [0, 0, 0], max: [1000, 1000, 500] });
  });
});

describe("the user's edits of host objects", () => {
  const MOVE = [1, 0, 0, 2000, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const editable = () => {
    const { mirror, sent } = setup();
    mirror.handle(
      state({
        objects: [object("a1"), object("a2")],
        capabilities: {
          languages: ["python"],
          capture: true,
          placeImage: true,
          apiLookup: true,
          describe: true,
          edit: true,
        },
      }),
    );
    return { mirror, sent };
  };
  const edited = (id: string, ok: boolean, error?: string) =>
    ({
      type: "host.edited",
      id: "e",
      payload: { host: "rhino", id, ok, ...(error ? { error } : {}) },
    }) as Message;
  const editOf = (sent: Message[]) => {
    const m = sent.find((x) => x.type === "host.edit");
    if (m?.type !== "host.edit") throw new Error("no edit sent");
    return m.payload;
  };

  it("a drag is drawn as a preview, and letting go of nothing clears it", () => {
    const { mirror } = editable();
    mirror.preview(["a1"], MOVE);
    expect(mirror.getSnapshot().preview).toEqual({ ids: ["a1"], matrix: MOVE });
    mirror.preview(["a1"], null);
    expect(mirror.getSnapshot().preview).toBeNull();
  });

  it("no jump back: the preview holds after the host says yes, until the batch with the object arrives", async () => {
    const { mirror, sent } = editable();
    const outcome = mirror.edit("Move", { op: "transform", ids: ["a1"], matrix: MOVE });
    const edit = editOf(sent);
    expect(edit).toMatchObject({ host: "rhino", label: "Move", op: { op: "transform", ids: ["a1"] } });
    mirror.handle(edited(edit.id, true));
    expect(await outcome).toEqual({ ok: true });
    expect(mirror.getSnapshot().preview).toEqual({ ids: ["a1"], matrix: MOVE });
    mirror.handle(batch({ changed: [object("a2")] }));
    expect(mirror.getSnapshot().preview).not.toBeNull();
    mirror.handle(
      batch({ changed: [object("a1", { bounds: { min: [2000, 0, 0], max: [3000, 1000, 500] } })] }),
    );
    expect(mirror.getSnapshot().preview).toBeNull();
  });

  it("the batch may come before the answer: the preview goes with it", async () => {
    const { mirror, sent } = editable();
    const outcome = mirror.edit("Delete", { op: "delete", ids: ["a1"] });
    expect(mirror.getSnapshot().preview).toEqual({ ids: ["a1"], deleted: true });
    mirror.handle(batch({ deleted: ["a1"] }));
    expect(mirror.getSnapshot().preview).toBeNull();
    expect(await outcome).toEqual({ ok: true });
    mirror.handle(edited(editOf(sent).id, true));
  });

  it("a refused edit: the preview goes and the host's reason is the outcome", async () => {
    const { mirror, sent } = editable();
    const outcome = mirror.edit("Move", { op: "transform", ids: ["a1"], matrix: MOVE });
    mirror.handle(edited(editOf(sent).id, false, "There is no object a1 in Rhino any more."));
    expect(await outcome).toEqual({ ok: false, error: "There is no object a1 in Rhino any more." });
    expect(mirror.getSnapshot().preview).toBeNull();
  });

  it("no answer within 5 s: the preview goes and the outcome says so", async () => {
    vi.useFakeTimers();
    try {
      const { mirror } = editable();
      const outcome = mirror.edit("Move", { op: "transform", ids: ["a1"], matrix: MOVE });
      vi.advanceTimersByTime(EDIT_TIMEOUT_MS);
      expect(await outcome).toEqual({ ok: false, error: "Rhino did not answer within 5 seconds." });
      expect(mirror.getSnapshot().preview).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("an edit for a host that cannot take edits is refused at once, and nothing is sent", async () => {
    const { mirror, sent } = setup();
    mirror.handle(state({ objects: [object("a1")] }));
    expect(await mirror.edit("Move", { op: "delete", ids: ["a1"] })).toMatchObject({
      ok: false,
      error: expect.stringContaining("does not take edits from HAI"),
    });
    expect(sent.some((m) => m.type === "host.edit")).toBe(false);
  });

  it("one edit at a time, and a drag cannot replace the preview of an edit on its way", async () => {
    const { mirror } = editable();
    void mirror.edit("Move", { op: "transform", ids: ["a1"], matrix: MOVE });
    expect(await mirror.edit("Move", { op: "delete", ids: ["a2"] })).toMatchObject({ ok: false });
    mirror.preview(["a2"], MOVE);
    expect(mirror.getSnapshot().preview?.ids).toEqual(["a1"]);
  });
});

describe("what the agent changed for a request about a selection", () => {
  const mirrorsWith = () => {
    const mirrors = new HostMirrors(() => true);
    mirrors.handle(state({ objects: [object("a1"), object("a2"), object("b1")] }));
    return mirrors;
  };

  it("the changed objects glow: what changed while the team worked, shown once it is idle", async () => {
    const { RequestChanges } = await import("./request-changes.ts");
    const mirrors = mirrorsWith();
    const changes = new RequestChanges(mirrors);
    changes.start("rhino");
    changes.working(false); // not yet started: nothing is shown
    expect(mirrors.byHost.rhino.getSnapshot().changed).toEqual([]);
    changes.working(true);
    mirrors.handle(batch({ changed: [object("a1")] }));
    mirrors.handle(batch({ changed: [object("a2"), object("a1")] }));
    changes.working(false);
    expect(mirrors.byHost.rhino.getSnapshot().changed).toEqual(["a1", "a2"]);
    // Later changes are not this request's.
    mirrors.handle(batch({ changed: [object("b1")] }));
    expect(mirrors.byHost.rhino.getSnapshot().changed).toEqual(["a1", "a2"]);
  });

  it("the glow goes with the next selection", () => {
    const mirrors = mirrorsWith();
    mirrors.byHost.rhino.showChanged(["a1"]);
    mirrors.select(["b1"]);
    expect(mirrors.byHost.rhino.getSnapshot().changed).toEqual([]);
  });
});

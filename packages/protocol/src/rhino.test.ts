import { describe, expect, it } from "vitest";
import { parseMessage } from "./messages.ts";
import { RhinoObject, ViewRequest } from "./rhino.ts";

const frame = (type: string, payload: unknown) => JSON.stringify({ type, id: "m1", payload });
const ASSET = "0f8fad5b-d9cb-469f-a165-70867728950e";
const object = {
  id: "9b2c1f4e-1111-4222-8333-444455556666",
  name: "Canopy",
  type: "brep",
  layer: "Roof::Canopy",
  color: "#3c6ec8",
  bounds: { min: [0, 0, 0], max: [6000, 6000, 900] },
  asset: ASSET,
  triangles: 1152,
  tags: { "hai.owner": "architect" },
};
const batch = {
  changed: [object],
  deleted: ["a1"],
  notDrawn: { curves: 12, points: 0, annotations: 1, other: 0, heavy: 0 },
  sync: { done: 1, total: 40 },
  reset: true,
  changedAt: 1_700_000_000_000,
};
const rhinoHello = {
  client: "rhino",
  protocolVersion: 1,
  rhinoVersion: "8.12.0",
  pluginVersion: "0.1.0",
  python: { state: "ready" },
  document: null,
};

describe("the Rhino plugin's messages", () => {
  it.each([
    ["hello", rhinoHello],
    [
      "hello",
      { ...rhinoHello, python: { state: "unavailable", reason: "Python 3 is not installed in Rhino" } },
    ],
    ["hello", { client: "web", protocolVersion: 1 }],
    ["rhino.status", { python: { state: "ready" }, document: "tower.3dm" }],
    ["rhino.objects", batch],
    ["rhino.objects", { ...batch, sync: null, reset: false, changed: [], deleted: [] }],
    ["rhino.selection", { objects: [{ id: "a1", type: "Brep", layer: "Facade" }] }],
    ["rhino.select", { ids: ["a1", "a2"] }],
    ["rhino.select", { ids: [] }],
    ["rhino.python.run", { id: "r1", code: "print(1)", timeoutMs: 60_000 }],
    ["rhino.python.result", { id: "r1", ok: true, stdout: "1\n", result: "3", durationMs: 120 }],
    ["rhino.python.result", { id: "r1", ok: false, stdout: "", error: "NameError: x", durationMs: 4 }],
    ["view.set", { azimuth: 225 }],
    ["view.set", { frame: ["a1", "a2"], requestId: "v1" }],
  ])("accepts %s", (type, payload) => {
    expect(parseMessage(frame(type, payload)).ok).toBe(true);
  });

  it.each([
    ["a hello from an unknown client", "hello", { ...rhinoHello, client: "excel" }],
    ["a Rhino hello without its Python status", "hello", { ...rhinoHello, python: undefined }],
    ["an unavailable Python without a reason", "hello", { ...rhinoHello, python: { state: "unavailable" } }],
    ["an object with a bad colour", "rhino.objects", { ...batch, changed: [{ ...object, color: "blue" }] }],
    [
      "an object with an asset that is not an id",
      "rhino.objects",
      { ...batch, changed: [{ ...object, asset: "x" }] },
    ],
    [
      "an object whose box is inside out",
      "rhino.objects",
      {
        ...batch,
        changed: [{ ...object, bounds: { min: [10, 0, 0], max: [0, 0, 0] } }],
      },
    ],
    ["more than 500 objects in a batch", "rhino.objects", { ...batch, changed: Array(501).fill(object) }],
    ["negative counts", "rhino.objects", { ...batch, notDrawn: { ...batch.notDrawn, curves: -1 } }],
    ["a missing reset flag", "rhino.objects", { ...batch, reset: undefined }],
    ["an unknown object type", "rhino.objects", { ...batch, changed: [{ ...object, type: "curve" }] }],
    [
      "a script longer than the limit",
      "rhino.python.run",
      { id: "r", code: "x".repeat(200_001), timeoutMs: 1000 },
    ],
    ["a script with no time limit", "rhino.python.run", { id: "r", code: "x" }],
    ["a select with a thousand ids", "rhino.select", { ids: Array(501).fill("a") }],
    ["an extra field", "rhino.select", { ids: [], force: true }],
  ])("rejects %s", (_name, type, payload) => {
    expect(parseMessage(frame(type, payload)).ok).toBe(false);
  });

  it("a Rhino object may carry up to 20 tags", () => {
    const tags = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`hai.t${i}`, "x"]));
    expect(RhinoObject.safeParse({ ...object, tags: tags(20) }).success).toBe(true);
    expect(RhinoObject.safeParse({ ...object, tags: tags(21) }).success).toBe(false);
  });

  it("an object too heavy to mirror in full has no asset and is drawn as its box", () => {
    expect(RhinoObject.safeParse({ ...object, asset: null, triangles: 0 }).success).toBe(true);
  });
});

describe("the viewer's state of Rhino", () => {
  it("rhino.state carries the connection, the mode in use and the mirror", () => {
    const state = {
      connected: true,
      mode: "auto",
      inUse: "rhino",
      python: { state: "ready" },
      document: "tower.3dm",
      objects: [object],
      notDrawn: batch.notDrawn,
      sync: null,
      selection: [],
    };
    expect(parseMessage(frame("rhino.state", state)).ok).toBe(true);
    expect(parseMessage(frame("rhino.state", { ...state, mode: "sometimes" })).ok).toBe(false);
    expect(parseMessage(frame("rhino.state", { ...state, inUse: "auto" })).ok).toBe(false);
  });

  it("the modelling mode is a setting: auto, rhino or python", () => {
    for (const modelling of ["auto", "rhino", "python"])
      expect(parseMessage(frame("settings.set", { modelling })).ok).toBe(true);
    expect(parseMessage(frame("settings.set", { modelling: "both" })).ok).toBe(false);
  });
});

describe("ViewRequest", () => {
  it.each([
    [{ azimuth: 225 }],
    [{ elevation: 40, distance: 30_000 }],
    [{ target: [1000, 2000, 0] }],
    [{ frame: ["a1"] }],
  ])("accepts %j", (request) => {
    expect(ViewRequest.safeParse(request).success).toBe(true);
  });

  it.each([
    ["nothing at all", {}],
    ["only a request id", { requestId: "v1" }],
    ["an elevation under the floor", { elevation: 2 }],
    ["an elevation straight down", { elevation: 90 }],
    ["a distance of zero", { distance: 0 }],
    ["an empty frame list", { frame: [] }],
  ])("rejects %s", (_name, request) => {
    expect(ViewRequest.safeParse(request).success).toBe(false);
  });
});

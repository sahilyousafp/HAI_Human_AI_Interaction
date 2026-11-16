import { describe, expect, it } from "vitest";
import { RequestContext } from "./agent.ts";
import { olderHostHello, PROTOCOL_VERSION } from "./envelope.ts";
import { HostComponent, HostObject } from "./host.ts";
import { parseMessage } from "./messages.ts";
import { ViewRequest } from "./view.ts";

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
  notDrawn: { curves: 12, points: 0, annotations: 1, other: 0, heavy: 0, simplified: 0 },
  sync: { done: 1, total: 40 },
  reset: true,
  changedAt: 1_700_000_000_000,
};
const capabilities = {
  languages: ["python"],
  capture: true,
  placeImage: true,
  apiLookup: true,
  describe: true,
};
const rhinoHello = {
  client: "rhino",
  protocolVersion: PROTOCOL_VERSION,
  app: { name: "Rhino 8", version: "8.36.0" },
  connectorVersion: "0.2.0",
  run: { state: "ready" },
  document: null,
  capabilities,
};
const component = {
  id: "a1",
  name: "Canopy",
  type: "Closed Brep",
  layer: "Roof::Canopy",
  bounds: { min: [0, 0, 0], max: [6000, 6000, 900] },
  quantities: { areaMm2: 7.2e7, volumeMm3: 3.24e10 },
  material: "Timber",
  properties: { "hai.part": "canopy", fireRating: 60, loadBearing: true },
};

describe("the hosts' messages", () => {
  it.each([
    ["hello", rhinoHello],
    ["hello", { ...rhinoHello, run: { state: "unavailable", reason: "Python 3 is not installed in Rhino" } }],
    [
      "hello",
      {
        ...rhinoHello,
        client: "revit",
        app: { name: "Revit 2026", version: "26.0" },
        capabilities: { ...capabilities, languages: ["csharp"] },
      },
    ],
    ["hello", { client: "web", protocolVersion: PROTOCOL_VERSION }],
    ["host.status", { host: "rhino", run: { state: "ready" }, document: "tower.3dm" }],
    ["host.objects", { host: "rhino", ...batch }],
    ["host.objects", { host: "blender", ...batch, sync: null, reset: false, changed: [], deleted: [] }],
    [
      "host.objects",
      { host: "blender", ...batch, changed: [{ ...object, type: "object", layer: "Scene/Massing" }] },
    ],
    ["host.objects", { host: "revit", ...batch, changed: [{ ...object, type: "element", layer: "Walls" }] }],
    ["host.selection", { host: "rhino", objects: [{ id: "a1", type: "Brep", layer: "Facade" }] }],
    ["host.selection", { host: "rhino", objects: [], components: [component] }],
    ["host.select", { host: "rhino", ids: ["a1", "a2"] }],
    ["host.select", { host: "blender", ids: [] }],
    ["host.run", { host: "rhino", id: "r1", language: "python", code: "print(1)", timeoutMs: 60_000 }],
    ["host.run", { host: "revit", id: "r1", language: "csharp", code: "return 1;", timeoutMs: 1000 }],
    ["host.result", { host: "rhino", id: "r1", ok: true, stdout: "1\n", result: "3", durationMs: 120 }],
    ["host.result", { host: "rhino", id: "r1", ok: false, stdout: "", error: "NameError: x", durationMs: 4 }],
    ["host.undo", { host: "rhino" }],
    ["host.capture", { host: "rhino", id: "c1", view: "top", width: 1280, height: 720 }],
    ["host.captured", { host: "rhino", id: "c1", ok: true, asset: ASSET, durationMs: 640 }],
    ["host.captured", { host: "rhino", id: "c1", ok: false, error: "No active view", durationMs: 3 }],
    [
      "host.image.place",
      {
        host: "rhino",
        id: "i1",
        path: "D:/project/.hai/images/site.jpg",
        origin: [0, 0, 0],
        normal: [0, -1, 0],
        widthMm: 40_000,
      },
    ],
    ["host.image.placed", { host: "rhino", id: "i1", ok: true, objectId: "f1" }],
    ["host.api", { host: "rhino", id: "q1", query: "Brep.CreateFromLoft" }],
    [
      "host.api.result",
      {
        host: "rhino",
        id: "q1",
        entries: [{ name: "Rhino.Geometry.Brep.CreateFromLoft", kind: "method", signature: "Brep[] (...)" }],
        truncated: false,
      },
    ],
    ["host.describe", { host: "rhino", id: "d1", ids: ["a1"] }],
    ["host.described", { host: "rhino", id: "d1", components: [component] }],
    ["host.refused", { reason: "This HAI for Rhino is older than the bridge: install the new one" }],
    ["host.open", { host: "rhino", path: "canopy.3dm" }],
    ["view.set", { azimuth: 225 }],
    ["view.set", { frame: ["a1", "a2"], requestId: "v1" }],
  ])("accepts %s", (type, payload) => {
    expect(parseMessage(frame(type, payload)).ok).toBe(true);
  });

  it.each([
    ["a hello from an unknown client", "hello", { ...rhinoHello, client: "excel" }],
    ["a host hello without its run status", "hello", { ...rhinoHello, run: undefined }],
    ["a host hello without its capabilities", "hello", { ...rhinoHello, capabilities: undefined }],
    ["a host hello from the older protocol", "hello", { ...rhinoHello, protocolVersion: 1 }],
    ["an unavailable run without a reason", "hello", { ...rhinoHello, run: { state: "unavailable" } }],
    ["a message for an unknown host", "host.select", { host: "sketchup", ids: [] }],
    ["a message without its host", "host.select", { ids: [] }],
    [
      "an object with a bad colour",
      "host.objects",
      { host: "rhino", ...batch, changed: [{ ...object, color: "blue" }] },
    ],
    [
      "an object with an asset that is not an id",
      "host.objects",
      { host: "rhino", ...batch, changed: [{ ...object, asset: "x" }] },
    ],
    [
      "an object whose box is inside out",
      "host.objects",
      { host: "rhino", ...batch, changed: [{ ...object, bounds: { min: [10, 0, 0], max: [0, 0, 0] } }] },
    ],
    [
      "more than 500 objects in a batch",
      "host.objects",
      { host: "rhino", ...batch, changed: Array(501).fill(object) },
    ],
    [
      "negative counts",
      "host.objects",
      { host: "rhino", ...batch, notDrawn: { ...batch.notDrawn, curves: -1 } },
    ],
    ["a missing reset flag", "host.objects", { host: "rhino", ...batch, reset: undefined }],
    [
      "an unknown object type",
      "host.objects",
      { host: "rhino", ...batch, changed: [{ ...object, type: "curve" }] },
    ],
    [
      "a script longer than the limit",
      "host.run",
      { host: "rhino", id: "r", language: "python", code: "x".repeat(200_001), timeoutMs: 1000 },
    ],
    ["a script with no time limit", "host.run", { host: "rhino", id: "r", language: "python", code: "x" }],
    ["a script with no language", "host.run", { host: "rhino", id: "r", code: "x", timeoutMs: 1000 }],
    ["a capture larger than 1280 px", "host.capture", { host: "rhino", id: "c", width: 1920, height: 1080 }],
    [
      "a capture of an unknown view",
      "host.capture",
      { host: "rhino", id: "c", view: "iso", width: 640, height: 480 },
    ],
    ["describing nothing", "host.describe", { host: "rhino", id: "d", ids: [] }],
    ["describing more than 50", "host.describe", { host: "rhino", id: "d", ids: Array(51).fill("a") }],
    ["a select with too many ids", "host.select", { host: "rhino", ids: Array(501).fill("a") }],
    ["an extra field", "host.select", { host: "rhino", ids: [], force: true }],
  ])("rejects %s", (_name, type, payload) => {
    expect(parseMessage(frame(type, payload)).ok).toBe(false);
  });

  it("a host object may carry up to 20 tags", () => {
    const tags = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`hai.t${i}`, "x"]));
    expect(HostObject.safeParse({ ...object, tags: tags(20) }).success).toBe(true);
    expect(HostObject.safeParse({ ...object, tags: tags(21) }).success).toBe(false);
  });

  it("a block's placement says where its shared mesh goes, in 16 numbers, and its parts' colours", () => {
    const block = { ...object, type: "block" as const };
    const transform = [1, 0, 0, 5000, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    expect(HostObject.safeParse({ ...block, transform, partColors: ["#463223", null] }).success).toBe(true);
    expect(HostObject.safeParse({ ...block, transform: transform.slice(1) }).success).toBe(false);
    expect(HostObject.safeParse({ ...block, partColors: ["brown"] }).success).toBe(false);
  });

  it("an object too heavy to mirror in full has no asset and is drawn as its box", () => {
    expect(HostObject.safeParse({ ...object, asset: null, triangles: 0 }).success).toBe(true);
  });
});

describe("an old connector's hello", () => {
  it("is recognised by its host and older protocol, so the bridge can say to update it", () => {
    const old = {
      type: "hello",
      id: "h",
      payload: { client: "rhino", protocolVersion: 1, rhinoVersion: "8.36" },
    };
    expect(olderHostHello(old)).toBe("rhino");
  });

  it("is not a current hello, a page's hello or something else", () => {
    expect(olderHostHello({ type: "hello", id: "h", payload: rhinoHello })).toBeNull();
    expect(
      olderHostHello({ type: "hello", id: "h", payload: { client: "web", protocolVersion: 1 } }),
    ).toBeNull();
    expect(
      olderHostHello({ type: "host.status", id: "h", payload: { client: "rhino", protocolVersion: 1 } }),
    ).toBeNull();
    expect(olderHostHello("hello")).toBeNull();
  });
});

describe("a described component", () => {
  it("carries quantities, a material and the host's own properties", () => {
    expect(HostComponent.safeParse(component).success).toBe(true);
    expect(
      HostComponent.safeParse({ ...component, bounds: null, material: null, quantities: {} }).success,
    ).toBe(true);
  });

  it("holds at most 100 properties, each value at most 200 characters", () => {
    const props = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}`, i]));
    expect(HostComponent.safeParse({ ...component, properties: props(100) }).success).toBe(true);
    expect(HostComponent.safeParse({ ...component, properties: props(101) }).success).toBe(false);
    expect(HostComponent.safeParse({ ...component, properties: { note: "x".repeat(201) } }).success).toBe(
      false,
    );
  });

  it("goes with a request, under its host", () => {
    const context = {
      references: [],
      selection: ["a1"],
      groundPoint: null,
      components: [{ host: "rhino", ...component }],
    };
    expect(RequestContext.safeParse(context).success).toBe(true);
    expect(RequestContext.safeParse({ ...context, components: [component] }).success).toBe(false);
  });
});

describe("the viewer's state of a host", () => {
  const state = {
    host: "rhino",
    switchedOn: true,
    connected: true,
    app: { name: "Rhino 8", version: "8.36.0" },
    run: { state: "ready" },
    capabilities,
    document: "tower.3dm",
    objects: [object],
    notDrawn: batch.notDrawn,
    sync: null,
    selection: [],
    components: [],
  };

  it("host.state carries the switch, the connection, what the host can do and the mirror", () => {
    expect(parseMessage(frame("host.state", state)).ok).toBe(true);
    const gone = { ...state, connected: false, app: null, run: null, capabilities: null, objects: [] };
    expect(parseMessage(frame("host.state", gone)).ok).toBe(true);
    expect(parseMessage(frame("host.state", { ...state, host: "archicad" })).ok).toBe(false);
  });

  it("the hosts in use are a setting, one switch per host", () => {
    expect(parseMessage(frame("settings.set", { hosts: { rhino: false } })).ok).toBe(true);
    expect(
      parseMessage(frame("settings.set", { hosts: { rhino: true, blender: false, revit: true } })).ok,
    ).toBe(true);
    expect(parseMessage(frame("settings.set", { hosts: { sketchup: true } })).ok).toBe(false);
    expect(parseMessage(frame("settings.set", { modelling: "python" })).ok).toBe(false);
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

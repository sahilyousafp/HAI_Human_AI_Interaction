import type { SceneDocument } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { AgentEyes, describeCamera, PRESETS, presetCameras } from "./agent-eyes.ts";

const box = {
  min: [0, 0, 0] as [number, number, number],
  max: [10_000, 6000, 3000] as [number, number, number],
};

function eyes(changed: () => void = () => {}) {
  const doc: SceneDocument = {
    version: 1,
    units: "mm",
    up: "Z",
    name: "t",
    levels: [{ id: "L0", name: "L0", elevation: 0 }],
    elements: {
      a: {
        id: "a",
        name: "a",
        type: "column",
        level: "L0",
        properties: {},
        position: [1000, 1000],
        section: [400, 400],
        height: 3000,
      },
      b: {
        id: "b",
        name: "b",
        type: "column",
        level: "L0",
        properties: {},
        position: [9000, 5000],
        section: [400, 400],
        height: 3000,
      },
    },
  } as SceneDocument;
  return new AgentEyes({
    doc: () => doc,
    rhinoBounds: () => [{ id: "r1", bounds: { min: [20_000, 0, 0], max: [21_000, 1000, 1000] } }],
    shoot: async () => ({ ok: false, error: "no viewer" }),
    changed,
  });
}

describe("presets", () => {
  it("each preset makes the cameras it promises, framed on the box and looking at its middle", () => {
    const counts = Object.fromEntries(PRESETS.map((p) => [p, presetCameras(p, box).length]));
    expect(counts).toEqual({ iso: 4, top: 1, front: 1, left: 1, "orbit-sheet": 8 });
    for (const camera of presetCameras("orbit-sheet", box)) {
      expect(camera.target).toEqual([5000, 3000, 1500]);
      expect(camera.distance).toBeGreaterThan(2000);
    }
  });

  it("looks down for the top, from the south for the front and from the west for the left", () => {
    expect(presetCameras("top", box)[0]).toMatchObject({ name: "top", elevation: 89 });
    expect(presetCameras("front", box)[0]).toMatchObject({ azimuth: 270 });
    expect(presetCameras("left", box)[0]).toMatchObject({ azimuth: 180 });
    expect(presetCameras("iso", box).map((c) => c.name)).toEqual(["iso-ne", "iso-nw", "iso-sw", "iso-se"]);
    expect(new Set(presetCameras("orbit-sheet", box).map((c) => c.name)).size).toBe(8);
  });

  it("falls back to a view of the origin when the model is empty", () => {
    expect(presetCameras("iso", null)[0]?.target).toEqual([0, 0, 0]);
  });

  it("labels a picture with where it looks from", () => {
    expect(
      describeCamera({ name: "south", azimuth: 270, elevation: 30, distance: 20_000, target: [0, 0, 0] }),
    ).toBe("south: from the s, 30 degrees up, 20 m away");
  });
});

describe("agent cameras", () => {
  it("frames the whole model for a new camera, scene elements and Rhino objects together", () => {
    const placed = eyes().place("architect", "all", {});
    expect(placed).toMatchObject({ ok: true, camera: { name: "all" } });
    if (placed.ok) expect(placed.camera.target[0]).toBeCloseTo(10_900, -2);
  });

  it("frames named elements, and keeps what the request leaves out", () => {
    const e = eyes();
    e.place("architect", "dome", { azimuth: 90, elevation: 40 });
    const moved = e.place("architect", "dome", { frame: ["b"] });
    expect(moved).toMatchObject({ ok: true, camera: { azimuth: 90, elevation: 40 } });
    if (moved.ok) expect(moved.camera.target[0]).toBeCloseTo(9000, -2);
  });

  it("names the missing id when nothing can be framed", () => {
    expect(eyes().place("architect", "x", { frame: ["zzz"] })).toEqual({
      ok: false,
      error: 'No element with the id "zzz", so there is nothing to frame.',
    });
  });

  it("keeps cameras private and tells the strip when anything changes", () => {
    let changes = 0;
    const e = eyes(() => changes++);
    e.place("architect", "south", { azimuth: 270 });
    e.place("product", "south", { azimuth: 90 });
    expect(e.get("architect", "south")?.azimuth).toBe(270);
    expect(e.get("product", "south")?.azimuth).toBe(90);
    expect(e.list("climate")).toEqual([]);
    expect(
      e
        .snapshot()
        .cameras.map((c) => c.agent)
        .sort(),
    ).toEqual(["architect", "product"]);
    e.noteShot("architect", "south", "data:image/jpeg;base64,/9j/");
    expect(e.snapshot().shots).toMatchObject([{ agent: "architect", camera: "south" }]);
    expect(changes).toBe(3);
    // A task ends: its cameras go, the last picture stays for the user to look at.
    e.clear("architect");
    expect(e.snapshot()).toMatchObject({ shots: [{ agent: "architect" }], cameras: [{ agent: "product" }] });
    e.clear();
    expect(e.snapshot()).toEqual({ shots: [], cameras: [] });
  });

  it("reports a viewer that did not take every picture", async () => {
    const e = new AgentEyes({
      doc: () => ({ version: 1, units: "mm", up: "Z", name: "t", levels: [], elements: {} }) as SceneDocument,
      rhinoBounds: () => [],
      shoot: async () => ({ ok: true, shots: [] }),
      changed: () => {},
    });
    const camera = {
      name: "s",
      azimuth: 0,
      elevation: 30,
      distance: 10_000,
      target: [0, 0, 0] as [number, number, number],
    };
    expect(await e.capture("architect", [camera], {})).toEqual({
      ok: false,
      error: "The viewer did not return a picture for every camera.",
    });
  });
});

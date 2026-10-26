import { type ContextItem, type SceneDocument, Site } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { simulationGeometry } from "./simulation-geometry.ts";

const doc: SceneDocument = {
  version: 1,
  units: "mm",
  up: "Z",
  name: "Test",
  levels: [
    { id: "L0", name: "Ground", elevation: 0 },
    { id: "L1", name: "Level 1", elevation: 3500 },
  ],
  elements: {
    "w-1": {
      id: "w-1",
      type: "wall",
      name: "North wall",
      level: "L0",
      start: [0, 6000],
      end: [8000, 6000],
      height: 3500,
      thickness: 250,
      properties: {},
    },
    "s-1": {
      id: "s-1",
      type: "slab",
      name: "Floor 1",
      level: "L1",
      outline: [
        [0, 0],
        [8000, 0],
        [8000, 6000],
        [0, 6000],
      ],
      thickness: 300,
      properties: {},
    },
    "c-1": {
      id: "c-1",
      type: "column",
      name: "C1",
      level: "L0",
      position: [1000, 1000],
      section: [400, 400],
      height: 3500,
      properties: {},
    },
    "m-1": {
      id: "m-1",
      type: "massing",
      name: "Annex",
      origin: [9000, 0, 0],
      size: [4000, 3000, 2800],
      properties: {},
    },
  },
};

const site = Site.parse({ lat: 52.37, lon: 4.9, northDeg: 15 });

describe("simulation geometry", () => {
  it("describes the model in metres with +Z up, each element by what a simulation needs", () => {
    const g = simulationGeometry({ doc, site: null });
    expect(g).toMatchObject({ units: "m", up: "Z", site: null });
    expect(g.levels).toEqual([
      { id: "L0", name: "Ground", elevationM: 0 },
      { id: "L1", name: "Level 1", elevationM: 3.5 },
    ]);
    const byId = Object.fromEntries(g.objects.map((o) => [o.id, o]));
    expect(byId["w-1"]).toEqual({
      id: "w-1",
      name: "North wall",
      kind: "wall",
      start: [0, 6],
      end: [8, 6],
      thicknessM: 0.25,
      baseM: 0,
      heightM: 3.5,
    });
    expect(byId["s-1"]).toMatchObject({ kind: "slab", thicknessM: 0.3, topM: 3.5 });
    expect(byId["c-1"]).toMatchObject({
      kind: "column",
      position: [1, 1],
      sectionM: [0.4, 0.4],
      heightM: 3.5,
    });
    expect(byId["m-1"]).toMatchObject({
      kind: "massing",
      footprint: [
        [9, 0],
        [13, 0],
        [13, 3],
        [9, 3],
      ],
      baseM: 0,
      heightM: 2.8,
    });
  });

  it("carries the site and the north angle when there is one, so the simulation can choose weather and orientation", () => {
    const g = simulationGeometry({ doc, site });
    expect(g.site).toEqual({ lat: 52.37, lon: 4.9, northDegCounterClockwiseFromY: 15 });
  });

  it("lists what it simplified, and nothing it describes is left unsaid", () => {
    const g = simulationGeometry({ doc, site });
    expect(g.simplified.join(" ")).toMatch(/Walls are centre lines/);
    expect(g.simplified.join(" ")).toMatch(/Slabs hang from their level/);
    expect(g.simplified.join(" ")).toMatch(/Materials, constructions/);
    expect(g.shading).toBeUndefined();
  });

  it("imported models and Rhino objects are boxes, and the list says so", () => {
    const withImport: SceneDocument = {
      ...doc,
      elements: {
        ...doc.elements,
        "i-1": {
          id: "i-1",
          type: "imported",
          name: "Pavilion",
          asset: "11111111-1111-1111-1111-111111111111",
          part: 0,
          bounds: { min: [0, 0, 0], max: [2000, 3000, 4000] },
          translation: [1000, 0, 500],
          properties: {},
        },
      },
    };
    const g = simulationGeometry({
      doc: withImport,
      site,
      rhino: [{ id: "r-9", name: "Roof", bounds: { min: [0, 0, 3500], max: [8000, 6000, 4000] } }],
    });
    const box = g.objects.find((o) => o.id === "i-1");
    expect(box).toMatchObject({ kind: "box", of: "imported model", min: [1, 0, 0.5], max: [3, 3, 4.5] });
    expect(g.objects.find((o) => o.id === "r-9")).toMatchObject({ kind: "box", of: "Rhino object" });
    expect(g.simplified.join(" ")).toMatch(/1 imported model\(s\) are given as their bounding boxes/);
    expect(g.simplified.join(" ")).toMatch(/Rhino objects are given as their bounding boxes/);
  });

  it("the neighbouring buildings are included as shading objects, marked as context, when asked for", () => {
    const context: ContextItem[] = [
      {
        id: "way/1",
        kind: "building",
        footprint: [
          [20_000, 0],
          [30_000, 0],
          [30_000, 10_000],
          [20_000, 10_000],
        ],
        heightMm: 12_000,
        heightSource: "inferred",
        baseMm: 0,
        source: "overpass",
        label: "Tower",
      },
      { id: "node/1", kind: "tree", position: [0, 0], source: "overpass" },
    ];
    const g = simulationGeometry({ doc, site, context });
    expect(g.shading).toEqual([
      {
        id: "way/1",
        name: "Tower",
        footprint: [
          [20, 0],
          [30, 0],
          [30, 10],
          [20, 10],
        ],
        baseM: 0,
        heightM: 12,
        heightSource: "inferred",
      },
    ]);
    expect(g.objects.some((o) => o.id === "way/1")).toBe(false);
    expect(g.simplified.join(" ")).toMatch(
      /1 neighbouring building\(s\) are given as shading objects.*worked out or a default.*trees and ground data are not included/,
    );
  });

  it("an empty model is an empty list, not an error", () => {
    const g = simulationGeometry({ doc: { ...doc, elements: {} }, site: null });
    expect(g.objects).toEqual([]);
  });
});

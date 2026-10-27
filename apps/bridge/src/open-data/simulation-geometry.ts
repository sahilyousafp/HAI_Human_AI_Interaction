import type { ContextBuilding, ContextItem, Level, SceneDocument, Site } from "@hai/protocol";
import { elementBase } from "@hai/scene";

type Pt = [number, number];

/** One thing of the model as a simulation tool wants it: metres, Z up, the shape and where it stands. */
export type SimObject =
  | {
      id: string;
      name: string;
      kind: "wall";
      start: Pt;
      end: Pt;
      thicknessM: number;
      baseM: number;
      heightM: number;
    }
  | { id: string; name: string; kind: "slab"; outline: Pt[]; thicknessM: number; topM: number }
  | { id: string; name: string; kind: "column"; position: Pt; sectionM: Pt; baseM: number; heightM: number }
  | { id: string; name: string; kind: "massing"; footprint: Pt[]; baseM: number; heightM: number }
  | {
      id: string;
      name: string;
      kind: "box";
      min: [number, number, number];
      max: [number, number, number];
      of: string;
    };

export interface SimShading {
  id: string;
  name?: string;
  footprint: Pt[];
  baseM: number;
  heightM: number;
  /** Where the height came from. */
  heightSource: ContextBuilding["heightSource"];
}

export interface SimulationGeometry {
  units: "m";
  up: "Z";
  /** The site the model stands at, when it has one: latitude, longitude and where true north points. */
  site: { lat: number; lon: number; northDegCounterClockwiseFromY: number } | null;
  levels: Array<{ id: string; name: string; elevationM: number }>;
  objects: SimObject[];
  /** The neighbouring buildings, when asked for: shading objects, not part of the design. */
  shading?: SimShading[];
  /** What was simplified or left out in this description. Nothing is left out without being listed here. */
  simplified: string[];
}

const m = (mm: number) => Math.round(mm) / 1000;
const pt = ([x, y]: readonly [number, number]): Pt => [m(x), m(y)];

/** A rectangle's plan, counter-clockwise from its minimum corner. */
const rect = (x: number, y: number, w: number, d: number): Pt[] => [
  [m(x), m(y)],
  [m(x + w), m(y)],
  [m(x + w), m(y + d)],
  [m(x), m(y + d)],
];

/** The Rhino objects the mirror knows only by their boxes. */
export interface MirroredBox {
  id: string;
  name: string;
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

/**
 * The model, and optionally the city context, as a simplified description in metres with +Z up, for a simulation tool
 * to build its own model from. Every simplification is listed; an element type that cannot be described is said so,
 * never dropped quietly.
 */
export function simulationGeometry(input: {
  doc: SceneDocument;
  site: Site | null;
  context?: ReadonlyArray<ContextItem>;
  rhino?: ReadonlyArray<MirroredBox>;
}): SimulationGeometry {
  const { doc } = input;
  const levels: Level[] = doc.levels;
  const objects: SimObject[] = [];
  let imported = 0;
  for (const element of Object.values(doc.elements)) {
    const base = elementBase(element, levels);
    switch (element.type) {
      case "wall":
        objects.push({
          id: element.id,
          name: element.name,
          kind: "wall",
          start: pt(element.start),
          end: pt(element.end),
          thicknessM: m(element.thickness),
          baseM: m(base),
          heightM: m(element.height),
        });
        break;
      case "slab":
        // A slab hangs from its level: its top is the level and it extends down by its thickness.
        objects.push({
          id: element.id,
          name: element.name,
          kind: "slab",
          outline: element.outline.map(pt),
          thicknessM: m(element.thickness),
          topM: m(base),
        });
        break;
      case "column":
        objects.push({
          id: element.id,
          name: element.name,
          kind: "column",
          position: pt(element.position),
          sectionM: [m(element.section[0]), m(element.section[1])],
          baseM: m(base),
          heightM: m(element.height),
        });
        break;
      case "massing":
        objects.push({
          id: element.id,
          name: element.name,
          kind: "massing",
          footprint: rect(element.origin[0], element.origin[1], element.size[0], element.size[1]),
          baseM: m(element.origin[2]),
          heightM: m(element.size[2]),
        });
        break;
      case "line":
        break; // a curve casts no shadow and holds no sun
      case "imported": {
        imported++;
        const [tx, ty, tz] = element.translation;
        objects.push({
          id: element.id,
          name: element.name,
          kind: "box",
          of: "imported model",
          min: [m(element.bounds.min[0] + tx), m(element.bounds.min[1] + ty), m(element.bounds.min[2] + tz)],
          max: [m(element.bounds.max[0] + tx), m(element.bounds.max[1] + ty), m(element.bounds.max[2] + tz)],
        });
        break;
      }
    }
  }
  for (const r of input.rhino ?? [])
    objects.push({
      id: r.id,
      name: r.name,
      kind: "box",
      of: "Rhino object",
      min: [m(r.bounds.min[0]), m(r.bounds.min[1]), m(r.bounds.min[2])],
      max: [m(r.bounds.max[0]), m(r.bounds.max[1]), m(r.bounds.max[2])],
    });

  const buildings = (input.context ?? []).filter((i): i is ContextBuilding => i.kind === "building");
  const simplified = [
    "Walls are centre lines with a thickness; a window or a door in a wall is not described (the model has none).",
    "Slabs hang from their level: topM is the level and the slab extends down by thicknessM.",
    "Materials, constructions, programs and schedules are not described: choose them in the simulation.",
    ...(imported > 0
      ? [`${imported} imported model(s) are given as their bounding boxes (kind "box"), not their meshes.`]
      : []),
    ...((input.rhino?.length ?? 0) > 0
      ? ['Rhino objects are given as their bounding boxes (kind "box"), not their geometry.']
      : []),
    ...(input.context
      ? [
          `${buildings.length} neighbouring building(s) are given as shading objects: footprint extruded to a height${
            buildings.some((b) => b.heightSource !== "measured")
              ? " (some heights are worked out or a default, see heightSource)"
              : ""
          }; trees and ground data are not included.`,
        ]
      : []),
  ];

  return {
    units: "m",
    up: "Z",
    site: input.site
      ? { lat: input.site.lat, lon: input.site.lon, northDegCounterClockwiseFromY: input.site.northDeg }
      : null,
    levels: levels.map((l) => ({ id: l.id, name: l.name, elevationM: m(l.elevation) })),
    objects,
    ...(input.context
      ? {
          shading: buildings.map((b) => ({
            id: b.id,
            ...(b.label ? { name: b.label } : {}),
            footprint: b.footprint.map(pt),
            baseM: m(b.baseMm),
            heightM: m(b.heightMm),
            heightSource: b.heightSource,
          })),
        }
      : {}),
    simplified,
  };
}

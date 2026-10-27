import {
  DEFAULT_DRAWING_AIDS,
  type DrawingAids,
  type Element,
  type Point3Mm,
  type SceneDocument,
} from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { buildSnapIndex, GRID_MM, type Projector, resolvePoint, SNAP_TOLERANCE_PX } from "./snap.ts";

const wall = (id: string, start: [number, number], end: [number, number], extra: object = {}): Element =>
  ({
    id,
    type: "wall",
    name: id,
    properties: {},
    start,
    end,
    height: 3000,
    thickness: 200,
    ...extra,
  }) as Element;

const docOf = (...elements: Element[]): SceneDocument => ({
  version: 1,
  units: "mm",
  up: "Z",
  name: "Test",
  levels: [
    { id: "L0", name: "Ground", elevation: 0 },
    { id: "L1", name: "Level 1", elevation: 4500 },
  ],
  elements: Object.fromEntries(elements.map((e) => [e.id, e])),
});

const aids = (on: Partial<DrawingAids>): DrawingAids =>
  ({
    ...Object.fromEntries(Object.keys(DEFAULT_DRAWING_AIDS).map((k) => [k, false])),
    ...on,
  }) as DrawingAids;

/**
 * A view where `mmPerPixel` millimetres are a pixel and height shifts a point on screen, up and to the right, by half
 * its height (an oblique view, so a point at 4500 mm is far from its footprint on the ground).
 */
const view = (mmPerPixel: number) => {
  const project: Projector = ([x, y, z], out) => {
    out[0] = (x + 0.5 * z) / mmPerPixel;
    out[1] = (y + 0.5 * z) / mmPerPixel;
    return true;
  };
  const ground = (px: [number, number]) => (z: number) =>
    [px[0] * mmPerPixel - 0.5 * z, px[1] * mmPerPixel - 0.5 * z, z] as Point3Mm;
  return { project, ground };
};

/** The pointer is where the free point on the ground would be, `raw` millimetres, unless a test says where it is. */
const resolve = (
  doc: SceneDocument,
  on: Partial<DrawingAids>,
  raw: [number, number],
  anchor: Point3Mm | null = null,
  mmPerPixel = 1,
  constraints?: { angleStepDeg?: number; lengthMm?: number | null },
) => {
  const { project, ground } = view(mmPerPixel);
  const pointer: [number, number] = [raw[0] / mmPerPixel, raw[1] / mmPerPixel];
  const result = resolvePoint({
    pointer,
    ground: ground(pointer),
    anchor,
    aids: aids(on),
    index: buildSnapIndex(doc),
    project,
    ...(constraints ? { constraints } : {}),
  });
  if (!result) throw new Error("no point");
  return result;
};

/** The pointer at a screen position (px) directly. */
const resolveAt = (
  doc: SceneDocument,
  on: Partial<DrawingAids>,
  pointer: [number, number],
  anchor: Point3Mm | null = null,
) => {
  const { project, ground } = view(1);
  const result = resolvePoint({
    pointer,
    ground: ground(pointer),
    anchor,
    aids: aids(on),
    index: buildSnapIndex(doc),
    project,
  });
  if (!result) throw new Error("no point");
  return result;
};

const north = wall("w", [0, 0], [6000, 0]);

describe("resolvePoint: geometry on the ground", () => {
  it("snaps to a wall end within 24 px, to the millimetre", () => {
    const doc = docOf(wall("w", [0, 0], [5000, 2000]));
    const r = resolve(doc, { endpoint: true }, [5012, 1995]);
    expect(r).toMatchObject({ point: [5000, 2000, 0], kind: "endpoint", label: "Endpoint" });
  });

  it("midpoint of a wall", () => {
    const r = resolve(docOf(north), { midpoint: true }, [3010, 8]);
    expect(r).toMatchObject({ point: [3000, 0, 0], kind: "midpoint", label: "Midpoint" });
  });

  it("centre of a slab, a massing and an imported box", () => {
    const slab: Element = {
      id: "s",
      type: "slab",
      name: "s",
      properties: {},
      outline: [
        [0, 0],
        [4000, 0],
        [4000, 2000],
        [0, 2000],
      ],
      thickness: 200,
    };
    expect(resolve(docOf(slab), { centre: true }, [2005, 995]).point).toEqual([2000, 1000, 0]);
    const massing: Element = {
      id: "m",
      type: "massing",
      name: "m",
      properties: {},
      origin: [1000, 1000, 0],
      size: [2000, 2000, 3000],
    };
    expect(resolve(docOf(massing), { centre: true }, [2000, 2010]).point).toEqual([2000, 2000, 0]);
    const imported: Element = {
      id: "i",
      type: "imported",
      name: "i",
      properties: {},
      asset: "0f8fad5b-d9cb-469f-a165-70867728950e",
      part: 0,
      bounds: { min: [0, 0, 0], max: [2000, 1000, 100] },
      translation: [1000, 0, 0],
    };
    expect(resolve(docOf(imported), { centre: true }, [2000, 500]).point).toEqual([2000, 500, 0]);
    expect(resolve(docOf(imported), { endpoint: true }, [3010, 1000]).point).toEqual([3000, 1000, 0]);
  });

  it("a column centre is both an endpoint and a centre", () => {
    const c: Element = {
      id: "c",
      type: "column",
      name: "c",
      properties: {},
      position: [800, 900],
      section: [400, 400],
      height: 3000,
    };
    expect(resolve(docOf(c), { endpoint: true }, [810, 905]).point).toEqual([800, 900, 0]);
    expect(resolve(docOf(c), { centre: true }, [810, 905]).point).toEqual([800, 900, 0]);
  });

  it("project: the nearest point on an edge, not a grid point", () => {
    const r = resolve(docOf(north), { project: true }, [2437, 15]);
    expect(r).toMatchObject({ point: [2437, 0, 0], kind: "project", label: "Project" });
  });

  it("perpendicular: the foot of the perpendicular from the start of the line", () => {
    const r = resolve(docOf(north), { perpendicular: true }, [2010, 12], [2000, 3000, 0]);
    expect(r).toMatchObject({ point: [2000, 0, 0], kind: "perpendicular", label: "Perpendicular" });
  });

  it("perpendicular does not use the extension of an edge", () => {
    const r = resolve(docOf(north), { perpendicular: true }, [7000, 10], [7000, 3000, 0]);
    expect(r.kind).toBeNull();
  });

  it("perpendicular needs a start point", () => {
    expect(resolve(docOf(north), { perpendicular: true }, [2010, 12]).kind).toBeNull();
  });
});

describe("resolvePoint: every height", () => {
  const upper = wall("up", [5000, 2000], [11_000, 2000], { level: "L1" });

  it("a wall end on an upper level snaps where it appears on screen, and keeps its height", () => {
    // On screen the end at (5000, 2000, 4500) is at (7250, 4250) px; its footprint on the ground is far from there.
    const r = resolveAt(docOf(upper), { endpoint: true }, [7250 + 12, 4250 - 5]);
    expect(r).toMatchObject({ point: [5000, 2000, 4500], kind: "endpoint" });
    // The same pointer on the plan position of that end finds nothing: the old, ground-only matching.
    expect(resolveAt(docOf(upper), { endpoint: true }, [5000, 2000]).kind).toBeNull();
  });

  it("the top of a wall has its own ends, and a column its own top centre", () => {
    const column: Element = {
      id: "c",
      type: "column",
      name: "c",
      properties: {},
      position: [1000, 1000],
      section: [400, 400],
      height: 3000,
    };
    // The column's top centre (1000, 1000, 3000) appears at (2500, 2500) px.
    expect(resolveAt(docOf(column), { centre: true }, [2500, 2500]).point).toEqual([1000, 1000, 3000]);
    // Its base centre at (1000, 1000, 0) appears at (1000, 1000) px.
    expect(resolveAt(docOf(column), { centre: true }, [1000, 1000]).point).toEqual([1000, 1000, 0]);
  });

  it("the top corner of an imported building, not the one at ground level", () => {
    const building: Element = {
      id: "b",
      type: "imported",
      name: "b",
      properties: {},
      asset: "0f8fad5b-d9cb-469f-a165-70867728950e",
      part: 0,
      bounds: { min: [0, 0, 0], max: [20_000, 20_000, 30_000] },
      translation: [0, 0, 0],
    };
    // (20000, 20000, 30000) appears at (35000, 35000) px.
    const r = resolveAt(docOf(building), { endpoint: true }, [35_000 + 6, 35_000 - 4]);
    expect(r.point).toEqual([20_000, 20_000, 30_000]);
  });

  it("an element with its own base sits at that height", () => {
    const high = wall("high", [0, 0], [4000, 0], { base: 31_200 });
    const r = resolveAt(docOf(high), { endpoint: true }, [0 + 0.5 * 31_200 + 5, 0 + 0.5 * 31_200]);
    expect(r.point).toEqual([0, 0, 31_200]);
  });

  it("the nearer of two candidates on screen wins, at whatever height", () => {
    const doc = docOf(wall("a", [0, 0], [1000, 0]), wall("b", [0, 0], [1000, 0], { level: "L1" }));
    // a's start appears at (0, 0) px, b's start (0, 0, 4500) at (2250, 2250) px.
    expect(resolveAt(doc, { endpoint: true }, [2240, 2245]).point).toEqual([0, 0, 4500]);
    expect(resolveAt(doc, { endpoint: true }, [8, 4]).point).toEqual([0, 0, 0]);
  });

  it("project onto an upper edge: a point on it at its height", () => {
    // The edge from (5000, 2000, 4500) to (11000, 2000, 4500) appears from (7250, 4250) to (13250, 4250).
    const r = resolveAt(docOf(upper), { project: true }, [9000, 4260]);
    expect(r).toMatchObject({ kind: "project" });
    expect(r.point[2]).toBe(4500);
    expect(r.point[1]).toBe(2000);
    expect(r.point[0]).toBeGreaterThan(6740);
    expect(r.point[0]).toBeLessThan(6760); // 9000 px is 1750 px along an edge 6000 px long: 5000 + 1750
  });

  it("a free point is drawn in the plane at the anchor's height", () => {
    const { project, ground } = view(1);
    const pointer: [number, number] = [5000, 5000];
    const r = resolvePoint({
      pointer,
      ground: ground(pointer),
      anchor: [0, 0, 4500],
      aids: aids({}),
      index: buildSnapIndex(docOf()),
      project,
    });
    expect(r?.point[2]).toBe(4500);
    expect(r?.point[0]).toBe(5000 - 0.5 * 4500);
  });

  it("a long element is found by an end far from its middle, among many that are skipped", () => {
    const elements: Element[] = [wall("long", [0, 0], [100_000, 0])];
    for (let i = 0; i < 200; i++)
      elements.push(wall(`other${i}`, [i * 1000, 50_000], [i * 1000 + 500, 50_000]));
    const r = resolveAt(docOf(...elements), { endpoint: true }, [100_000 + 10, 5]);
    expect(r.point).toEqual([100_000, 0, 0]);
  });

  it("no ground under the pointer and nothing to snap to gives nothing", () => {
    const r = resolvePoint({
      pointer: [0, 0],
      ground: () => null,
      anchor: null,
      aids: aids({ grid: true, endpoint: true }),
      index: buildSnapIndex(docOf()),
      project: view(1).project,
    });
    expect(r).toBeNull();
  });

  it("without a camera only ortho and grid apply", () => {
    const r = resolvePoint({
      pointer: [1234, 678],
      ground: (z) => [1234, 678, z],
      anchor: null,
      aids: aids({ grid: true, endpoint: true }),
      index: buildSnapIndex(docOf(north)),
      project: null,
    });
    expect(r).toMatchObject({ point: [1200, 700, 0], kind: "grid" });
  });
});

describe("resolvePoint: priority and distance", () => {
  const doc = docOf(wall("w", [0, 0], [5000, 2000]));

  it("an endpoint 30 px away is out of reach, so the grid wins", () => {
    const r = resolve(doc, { endpoint: true, grid: true }, [5030, 2000]);
    expect(r).toMatchObject({ point: [5000, 2000, 0], kind: "grid" });
    const free = resolve(doc, { endpoint: true }, [5030, 2000]);
    expect(free).toMatchObject({ point: [5030, 2000, 0], kind: null });
  });

  it("endpoint beats midpoint, project and grid when all are near", () => {
    const d = docOf(wall("w", [0, 0], [100, 0]));
    const r = resolve(d, { endpoint: true, midpoint: true, project: true, grid: true }, [10, 3]);
    expect(r.kind).toBe("endpoint");
  });

  it("the tolerance is in pixels: 24 px reaches further on the ground when zoomed out", () => {
    const d = docOf(wall("w", [0, 0], [5000, 2000]));
    expect(resolve(d, { endpoint: true }, [5100, 2000], null, 1).kind).toBeNull();
    expect(resolve(d, { endpoint: true }, [5100, 2000], null, 5).kind).toBe("endpoint");
    expect(SNAP_TOLERANCE_PX).toBe(24);
  });

  it("nothing on gives the free point untouched", () => {
    const r = resolve(doc, {}, [1234.5, 678.9]);
    expect(r).toEqual({ point: [1234.5, 678.9, 0], kind: null, label: null, ortho: false });
  });

  it("grid alone rounds to 100 mm, as the tools always did", () => {
    expect(resolve(doc, { grid: true }, [1234, 678]).point).toEqual([1200, 700, 0]);
    expect(GRID_MM).toBe(100);
  });

  it("an element being moved is not snapped to", () => {
    const index = buildSnapIndex(docOf(north), new Set(["w"]));
    const { project, ground } = view(1);
    const r = resolvePoint({
      pointer: [10, 10],
      ground: ground([10, 10]),
      anchor: null,
      aids: aids({ endpoint: true }),
      index,
      project,
    });
    expect(r?.kind).toBeNull();
  });
});

describe("resolvePoint: lines", () => {
  const polyline = (closed: boolean): Element => ({
    id: "ln",
    name: "Line",
    type: "line",
    properties: {},
    closed,
    points: [
      [0, 0, 0],
      [4000, 0, 0],
      [4000, 3000, 0],
    ],
  });

  it("an open line offers its vertices and the middle of each span, and a closed one the closing span too", () => {
    const open = buildSnapIndex(docOf(polyline(false)));
    expect(open.endpoint).toHaveLength(3);
    expect(open.midpoint).toEqual([
      [2000, 0, 0],
      [4000, 1500, 0],
    ]);
    const closed = buildSnapIndex(docOf(polyline(true)));
    expect(closed.midpoint).toHaveLength(3);
    expect(closed.segments).toHaveLength(3);
  });

  it("Endpoint snaps to a vertex of a line", () => {
    const r = resolve(docOf(polyline(false)), { endpoint: true }, [4010, 20]);
    expect(r).toMatchObject({ kind: "endpoint", point: [4000, 0, 0] });
  });
});

describe("resolvePoint: ortho", () => {
  const empty = docOf();
  const origin: Point3Mm = [0, 0, 0];

  it("a line nearly along X ends on the axis", () => {
    const r = resolve(empty, { ortho: true }, [5000, 200], origin);
    expect(r.ortho).toBe(true);
    expect(r.point[1]).toBeCloseTo(0);
    expect(r.point[0]).toBeCloseTo(5000, 0);
    expect(r.kind).toBe("ortho");
  });

  it("a drag at 40 degrees falls on the 45 degree line", () => {
    const angle = (40 * Math.PI) / 180;
    const r = resolve(empty, { ortho: true }, [Math.cos(angle) * 4000, Math.sin(angle) * 4000], origin);
    expect(r.ortho).toBe(true);
    expect(r.point[0]).toBeCloseTo(r.point[1], 3);
  });

  it("is a hard lock: a hand 20 degrees off the axis still draws along it", () => {
    const angle = (20 * Math.PI) / 180;
    const raw: [number, number] = [Math.cos(angle) * 4000, Math.sin(angle) * 4000];
    const r = resolve(empty, { ortho: true }, raw, origin);
    expect(r.ortho).toBe(true);
    expect(r.point[1]).toBeCloseTo(0);
    expect(r.point[0]).toBeCloseTo(raw[0], 0);
  });

  it("the angle step sets the directions: 90 holds to the axes only, 15 to every 15 degrees", () => {
    const at = (deg: number): [number, number] => [
      Math.cos((deg * Math.PI) / 180) * 4000,
      Math.sin((deg * Math.PI) / 180) * 4000,
    ];
    // 40 degrees: 90 says the X axis's neighbour (45 is not allowed), 45 says the diagonal, 15 says 45 (nearest of 30, 45).
    const ninety = resolve(empty, { ortho: true }, at(40), origin, 1, { angleStepDeg: 90 });
    expect(ninety.point[1]).toBeCloseTo(0);
    expect(ninety.point[0]).toBeCloseTo(at(40)[0], 0);
    const fifteen = resolve(empty, { ortho: true }, at(34), origin, 1, { angleStepDeg: 15 });
    expect(Math.atan2(fifteen.point[1], fifteen.point[0])).toBeCloseTo((30 * Math.PI) / 180, 5);
    const diagonal = resolve(empty, { ortho: true }, at(40), origin, 1, { angleStepDeg: 45 });
    expect(diagonal.point[0]).toBeCloseTo(diagonal.point[1], 3);
  });

  it("a locked length fixes the segment along the held direction, whatever the pointer or the geometry", () => {
    const d = docOf(wall("w", [3000, -2000], [3000, 2000]));
    const r = resolve(d, { ortho: true, endpoint: true, grid: true }, [5100, 300], origin, 1, {
      lengthMm: 2500,
    });
    expect(r).toMatchObject({ point: [2500, 0, 0], kind: "length", ortho: true });
  });

  it("a locked length without Ortho runs towards the pointer; with the pointer on the anchor it is not applied", () => {
    const r = resolve(empty, {}, [3000, 4000], origin, 1, { lengthMm: 1000 });
    expect(r.kind).toBe("length");
    expect(r.point[0]).toBeCloseTo(600, 0);
    expect(r.point[1]).toBeCloseTo(800, 0);
    expect(resolve(empty, {}, [0, 0], origin, 1, { lengthMm: 1000 }).kind).toBeNull();
  });

  it("a length needs a start point", () => {
    expect(resolve(empty, {}, [3000, 4000], null, 1, { lengthMm: 1000 }).kind).toBeNull();
  });

  it("off means a 20 degree wall is drawn at 20 degrees", () => {
    const angle = (20 * Math.PI) / 180;
    const raw: [number, number] = [Math.cos(angle) * 4000, Math.sin(angle) * 4000];
    expect(resolve(empty, {}, raw, origin).point).toEqual([raw[0], raw[1], 0]);
  });

  it("keeps the direction when a midpoint is off the line", () => {
    const d = docOf(wall("w", [0, 1000], [6000, 0]));
    const r = resolve(d, { ortho: true, midpoint: true }, [3010, 40], origin);
    expect(r.kind).toBe("ortho");
    expect(r.point[1]).toBeCloseTo(0);
  });

  it("snaps to a midpoint that is on the line", () => {
    const d = docOf(wall("w", [0, 3000], [6000, 3000]), wall("v", [1000, 0], [5000, 0]));
    const r = resolve(d, { ortho: true, midpoint: true }, [3010, 40], origin);
    expect(r).toMatchObject({ kind: "midpoint", point: [3000, 0, 0], ortho: true });
  });

  it("with grid, the length lands on the grid along the line", () => {
    const r = resolve(empty, { ortho: true, grid: true }, [5030, 180], origin);
    expect(r.point).toEqual([5000, 0, 0]);
    const diagonal = resolve(empty, { ortho: true, grid: true }, [3020, 2980], origin);
    expect(diagonal.point).toEqual([3000, 3000, 0]);
  });

  it("project with ortho: where the line meets the edge", () => {
    const d = docOf(wall("w", [2000, -3000], [2000, 3000]));
    const r = resolve(d, { ortho: true, project: true }, [1990, 30], origin);
    expect(r).toMatchObject({ kind: "project", point: [2000, 0, 0] });
  });

  it("holds the line in the plane at the start height: an endpoint at another height is not on it", () => {
    // A line begun at 4500 mm; the candidate end at ground level is on the line in plan but in another plane.
    const d = docOf(wall("w", [4000, 0], [6000, 0]));
    const { project, ground } = view(1);
    const pointer: [number, number] = [4000 + 0.5 * 4500 + 5, 2250];
    const r = resolvePoint({
      pointer,
      ground: ground(pointer),
      anchor: [0, 0, 4500],
      aids: aids({ ortho: true, endpoint: true }),
      index: buildSnapIndex(d),
      project,
    });
    expect(r?.point[2]).toBe(4500);
  });

  it("needs a start point", () => {
    expect(resolve(empty, { ortho: true }, [5000, 200]).ortho).toBe(false);
  });
});

describe("resolvePoint: cost", () => {
  it("every aid on, 2000 elements, camera included: one point in at most 2 ms", () => {
    const elements: Element[] = [];
    for (let i = 0; i < 2000; i++) {
      const x = (i % 50) * 3000;
      const y = Math.floor(i / 50) * 3000;
      elements.push(wall(`w${i}`, [x, y], [x + 2000, y + 500], i % 3 === 0 ? { level: "L1" } : {}));
    }
    const index = buildSnapIndex(docOf(...elements));
    const every = aids({
      grid: true,
      ortho: true,
      endpoint: true,
      midpoint: true,
      centre: true,
      project: true,
      perpendicular: true,
    });
    const { project, ground } = view(10);
    const run = () =>
      resolvePoint({
        pointer: [7412, 6187],
        ground: ground([7412, 6187]),
        anchor: [100, 100, 0],
        aids: every,
        index,
        project,
      });
    for (let i = 0; i < 20; i++) run(); // warm up
    const start = performance.now();
    const runs = 50;
    for (let i = 0; i < runs; i++) run();
    expect((performance.now() - start) / runs).toBeLessThan(2);
  });
});

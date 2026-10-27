import {
  DEFAULT_ACTION_LAYOUT,
  DEFAULT_DRAWING_AIDS,
  DEFAULT_REFERENCE_LAYOUT,
  type Point2,
  type Point3Mm,
  type SceneDocument,
  type SceneOp,
} from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { registerBuiltinTools } from "./builtin.ts";
import { ToolController, type ToolEnvironment } from "./controller.ts";
import { finishSketch, outlineArea, pathLength, simplify } from "./reference.ts";
import { ReferenceLayer } from "./reference-layer.ts";
import { ToolRegistry } from "./registry.ts";

// A plan view of a 40 x 30 m site, 10 mm a pixel.
const toViewer = (xMm: number, yMm: number): Point2 => [xMm / 40_000, 1 - yMm / 30_000];

const doc: SceneDocument = { version: 1, units: "mm", levels: [], elements: {} } as unknown as SceneDocument;

function setup() {
  const registry = new ToolRegistry();
  registerBuiltinTools(registry);
  const controller = new ToolController(registry, {
    action: DEFAULT_ACTION_LAYOUT,
    reference: DEFAULT_REFERENCE_LAYOUT,
  });
  const applied: Array<{ label: string; ops: SceneOp[] }> = [];
  const env: ToolEnvironment = {
    doc: () => doc,
    apply: (label, ops) => void applied.push({ label, ops }),
    undo: () => {},
    redo: () => {},
    select: () => {},
    pick: () => null,
    ground: ([ax, ay], heightMm = 0) => [ax * 40_000, (1 - ay) * 30_000, heightMm],
    screenSize: () => [4000, 3000],
    projector:
      () =>
      ([x, y], out) => {
        out[0] = x / 10;
        out[1] = (30_000 - y) / 10;
        return true;
      },
    aids: () => DEFAULT_DRAWING_AIDS,
    bounds: () => ({ min: [0, 0, 0], max: [40_000, 30_000, 3000] }),
    handToViewer: (p) => p,
    handAspect: () => 4 / 3,
    navigate: () => {},
    press: () => false,
    isButton: () => false,
    scrollAt: () => null,
    onSectionLine: () => false,
    askAgent: () => null,
  };
  controller.attach(env);
  return { controller, applied, references: controller.references };
}

/** Drags through the points (mm) with the active tool, as one hand. */
function draw(controller: ToolController, points: Array<[number, number]>, hand: "Left" | "Right" = "Left") {
  const [first, ...rest] = points;
  if (!first) return;
  expect(controller.dragStart(toViewer(...first), hand)).toBe(true);
  for (const p of rest) controller.drag(toViewer(...p), hand);
  const last = points[points.length - 1] ?? first;
  controller.dragEnd(toViewer(...last), hand);
}

/** The points of a straight run from a to b every `step` mm. */
function run(a: [number, number], b: [number, number], step = 100): Array<[number, number]> {
  const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
  return Array.from({ length: n + 1 }, (_, i) => [
    a[0] + ((b[0] - a[0]) * i) / n,
    a[1] + ((b[1] - a[1]) * i) / n,
  ]);
}

describe("sketch geometry", () => {
  it("simplify keeps the corners of an L and drops the points along its legs", () => {
    const points: Point3Mm[] = [...run([0, 0], [4000, 0]), ...run([4000, 0], [4000, 2000]).slice(1)].map(
      ([x, y]) => [x, y, 0],
    );
    expect(simplify(points)).toEqual([
      [0, 0, 0],
      [4000, 0, 0],
      [4000, 2000, 0],
    ]);
  });

  it("simplify keeps a bump bigger than the tolerance and drops a smaller one", () => {
    expect(
      simplify([
        [0, 0, 0],
        [500, 90, 0],
        [1000, 0, 0],
      ]),
    ).toHaveLength(2);
    expect(
      simplify([
        [0, 0, 0],
        [500, 150, 0],
        [1000, 0, 0],
      ]),
    ).toHaveLength(3);
  });

  it("measures a path's length and an outline's area", () => {
    expect(
      pathLength([
        [0, 0, 0],
        [3000, 0, 0],
        [3000, 4000, 0],
      ]),
    ).toBe(7000);
    expect(
      outlineArea([
        [0, 0, 0],
        [10_000, 0, 0],
        [10_000, 8000, 0],
        [0, 8000, 0],
      ]),
    ).toBe(80_000_000);
  });

  it("keeps a path of at least 300 mm and an outline of at least a square metre", () => {
    expect(
      finishSketch("path", [
        [0, 0, 0],
        [200, 0, 0],
      ]),
    ).toHaveProperty("tooSmall");
    expect(
      finishSketch("path", [
        [0, 0, 0],
        [300, 0, 0],
      ]),
    ).toHaveProperty("points");
    const square = (side: number): Point3Mm[] => [
      [0, 0, 0],
      [side, 0, 0],
      [side, side, 0],
      [0, side, 0],
    ];
    expect(finishSketch("outline", square(900))).toHaveProperty("tooSmall");
    expect(finishSketch("outline", square(1000))).toEqual({ points: square(1000) });
  });

  it("an outline drawn back to its start does not repeat its first point", () => {
    const loop: Point3Mm[] = [
      [0, 0, 0],
      [5000, 0, 0],
      [5000, 5000, 0],
      [0, 5000, 0],
      [20, 30, 0],
    ];
    expect(finishSketch("outline", loop)).toEqual({ points: loop.slice(0, 4) });
  });
});

describe("the reference layer", () => {
  it("labels sketches S1, S2 and so on, keeps 8 and starts again at S1 once cleared", () => {
    const layer = new ReferenceLayer();
    const line: Point3Mm[] = [
      [0, 0, 0],
      [1000, 0, 0],
    ];
    for (let i = 0; i < 9; i++) layer.addSketch("path", line, "Left");
    expect(layer.sketches.map((s) => s.label)).toEqual(["S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9"]);
    layer.clearSketches();
    expect(layer.addSketch("path", line, null).label).toBe("S1");
  });

  it("Letters are reused: a marker takes the first free letter, and every change is reported", () => {
    const layer = new ReferenceLayer();
    const reported: string[][] = [];
    layer.onMarkersChange = (markers) => reported.push(markers.map((m) => m.letter));
    layer.placeMarker([0, 0, 0]);
    layer.placeMarker([1000, 0, 0]);
    layer.removeMarker("A");
    expect(layer.placeMarker([2000, 0, 0])?.letter).toBe("A");
    expect(reported).toEqual([["A"], ["A", "B"], ["B"], ["A", "B"]]);
    layer.loadMarkers([]);
    expect(reported).toHaveLength(4); // markers from the bridge are not sent back
  });
});

describe("Sketch line, Sketch area and Place marker", () => {
  it("Draw a path: an L across the ground keeps one path of three points and adds nothing to the model", () => {
    const { controller, applied, references } = setup();
    controller.choose("sketch-line");
    draw(controller, [...run([2000, 2000], [6000, 2000]), ...run([6000, 2000], [6000, 4000]).slice(1)]);
    expect(references.sketches).toEqual([
      {
        label: "S1",
        kind: "path",
        hand: "Left",
        points: [
          [2000, 2000, 0],
          [6000, 2000, 0],
          [6000, 4000, 0],
        ],
      },
    ]);
    expect(applied).toEqual([]);
    expect(references.getSnapshot().draft).toBeNull();
  });

  it("Too short: a 200 mm path keeps nothing and says why", () => {
    const { controller, references } = setup();
    controller.choose("sketch-line");
    draw(controller, run([2000, 2000], [2200, 2000]));
    expect(references.sketches).toEqual([]);
    expect(controller.getSnapshot().overlay.notice).toMatch(/at least 300 mm/);
  });

  it("Outline a courtyard: a 10 by 8 m loop released away from its start becomes a closed outline", () => {
    const { controller, applied, references } = setup();
    controller.choose("sketch-area");
    draw(controller, [
      ...run([5000, 5000], [15_000, 5000]),
      ...run([15_000, 5000], [15_000, 13_000]).slice(1),
      ...run([15_000, 13_000], [5000, 13_000]).slice(1),
      ...run([5000, 13_000], [5000, 6000]).slice(1),
    ]);
    const [sketch] = references.sketches;
    expect(sketch?.kind).toBe("outline");
    expect(outlineArea(sketch?.points ?? [])).toBeGreaterThan(75_000_000);
    expect(outlineArea(sketch?.points ?? [])).toBeLessThanOrEqual(80_000_000);
    expect(applied).toEqual([]);
  });

  it("the sketch being drawn shows as a draft in the drawing hand", () => {
    const { controller, references } = setup();
    controller.choose("sketch-line");
    controller.dragStart(toViewer(1000, 1000), "Right");
    controller.drag(toViewer(3000, 1000), "Right");
    expect(references.getSnapshot().draft).toMatchObject({ kind: "path", hand: "Right" });
    controller.cancelDrag("Right");
    expect(references.getSnapshot().draft).toBeNull();
  });

  it("Escape with a sketch tool clears the sketches, and the next Escape returns to Select", () => {
    const { controller, references } = setup();
    controller.choose("sketch-line");
    draw(controller, run([2000, 2000], [6000, 2000]));
    controller.cancel();
    expect(references.sketches).toEqual([]);
    expect(controller.getSnapshot().activeId).toBe("sketch-line");
    controller.cancel();
    expect(controller.getSnapshot().activeId).toBe("select");
  });

  it("Delete one sketch: tapping S2 with Delete removes only S2, without asking", () => {
    const { controller, references } = setup();
    controller.choose("sketch-line");
    draw(controller, run([2000, 2000], [6000, 2000]));
    draw(controller, run([2000, 8000], [6000, 8000]));
    controller.choose("delete");
    controller.tap(toViewer(4000, 8050));
    expect(references.sketches.map((s) => s.label)).toEqual(["S1"]);
    expect(controller.getSnapshot().question).toBeNull();
  });

  it("Two markers: taps place A and B on the grid; a tap on a marker removes it", () => {
    const { controller, applied, references } = setup();
    controller.choose("place-marker");
    controller.tap(toViewer(3030, 4040));
    controller.tap(toViewer(9000, 9000));
    expect(references.markers).toEqual([
      { letter: "A", point: [3000, 4000, 0] },
      { letter: "B", point: [9000, 9000, 0] },
    ]);
    controller.tap(toViewer(3100, 4100));
    expect(references.markers.map((m) => m.letter)).toEqual(["B"]);
    controller.choose("delete");
    controller.tap(toViewer(9000, 9000));
    expect(references.markers).toEqual([]);
    expect(applied).toEqual([]);
  });
});

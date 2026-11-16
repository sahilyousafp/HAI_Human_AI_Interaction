import {
  DEFAULT_ACTION_LAYOUT,
  DEFAULT_DRAWING_AIDS,
  DEFAULT_REFERENCE_LAYOUT,
  type DrawingAids,
  type Element,
  type Point2,
  type SceneDocument,
  type SceneOp,
} from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { registerBuiltinTools } from "./builtin.ts";
import { ToolController, type ToolEnvironment } from "./controller.ts";
import { ToolRegistry } from "./registry.ts";

// A flat stand-in for the 3D view: viewer x 0..1 spans 0..40 m east, y 0..1 spans 30..0 m north, so one
// "pixel" (the test says 10 mm) makes the 24 px reach 240 mm.
const toMm = ([x, y]: Point2): [number, number] => [x * 40_000, (1 - y) * 30_000];
const toViewer = (xMm: number, yMm: number): Point2 => [xMm / 40_000, 1 - yMm / 30_000];

const wall = (id: string, start: [number, number], end: [number, number]): Element => ({
  id,
  type: "wall",
  name: id,
  properties: {},
  start,
  end,
  height: 3000,
  thickness: 200,
});

const column: Element = {
  id: "col",
  type: "column",
  name: "Column",
  properties: {},
  position: [20_000, 20_000],
  section: [400, 400],
  height: 3000,
};

const baseDoc: SceneDocument = {
  version: 1,
  units: "mm",
  up: "Z",
  name: "test",
  levels: [
    { id: "L0", name: "Ground", elevation: 0 },
    { id: "L1", name: "Level 1", elevation: 4500 },
  ],
  elements: {
    existing: wall("existing", [5000, 5000], [11_000, 5000]),
    col: column,
  },
};

function setup(on: Partial<DrawingAids> = {}, extra: Element[] = []) {
  const doc: SceneDocument = {
    ...baseDoc,
    elements: { ...baseDoc.elements, ...Object.fromEntries(extra.map((e) => [e.id, e])) },
  };
  const registry = new ToolRegistry();
  registerBuiltinTools(registry);
  const controller = new ToolController(registry, {
    action: DEFAULT_ACTION_LAYOUT,
    reference: DEFAULT_REFERENCE_LAYOUT,
  });
  const applied: Array<{ label: string; ops: SceneOp[] }> = [];
  const aids = { ...DEFAULT_DRAWING_AIDS, ...on };
  const env: ToolEnvironment = {
    doc: () => doc,
    apply: (label, ops) => void applied.push({ label, ops }),
    undo: () => {},
    redo: () => {},
    select: () => {},
    pick: (at) => {
      const [x, y] = toMm(at);
      const onColumn = Math.abs(x - 20_000) < 300 && Math.abs(y - 20_000) < 300;
      return onColumn ? { elementId: "col", point: [x, y, 3000] } : null;
    },
    ground: ([ax, ay], heightMm = 0) => [
      ax * 40_000 - heightMm / 2,
      (1 - ay) * 30_000 - heightMm / 2,
      heightMm,
    ],
    screenSize: () => [4000, 3000],
    // An oblique view, 10 mm a pixel: height moves a point up and to the right on screen by half its value in mm / 10.
    projector:
      () =>
      ([x, y, z], out) => {
        out[0] = x / 10 + z / 20;
        out[1] = (30_000 - y) / 10 - z / 20;
        return true;
      },
    aids: () => aids,
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
  return { controller, applied };
}

const drag = (controller: ToolController, from: [number, number], to: [number, number]) => {
  controller.dragStart(toViewer(...from));
  controller.drag(toViewer(...to));
  const notice = controller.getSnapshot().overlay.notice;
  const snap = controller.getSnapshot().overlay.snap;
  controller.dragEnd(toViewer(...to));
  return { notice, snap };
};

describe("drawing aids in Move", () => {
  it("Move with only Grid keeps the element's own alignment, as before", () => {
    const { controller, applied } = setup();
    controller.choose("move");
    drag(controller, [20_050, 20_050], [23_130, 21_080]);
    expect(applied.at(-1)).toMatchObject({ label: "Move" });
    expect(applied.at(-1)?.ops[0]).toMatchObject({
      op: "update",
      id: "col",
      patch: { position: [23_100, 21_000] },
    });
  });

  it("Move: the column's centre goes to a wall's end within 24 px", () => {
    const { controller, applied } = setup({ endpoint: true });
    controller.choose("move");
    // Grab the column off-centre; its centre ends 100 mm from the wall's end at (11000, 5000).
    drag(controller, [20_100, 20_100], [11_100, 5100]);
    expect(applied.at(-1)?.ops[0]).toMatchObject({ patch: { position: [11_000, 5000] } });
  });

  it("Move does not snap an element to itself", () => {
    const { controller, applied } = setup({ endpoint: true, grid: false });
    controller.choose("move");
    drag(controller, [20_100, 20_100], [20_150, 20_130]);
    expect(applied.at(-1)?.ops[0]).toMatchObject({ patch: { position: [20_050, 20_030] } });
  });
});

/** Where a scene point (mm) is in the view, 0..1, in the oblique test view. */
const viewerOf = ([x, y, z]: [number, number, number]): [number, number] => [
  (x / 10 + z / 20) / 4000,
  ((30_000 - y) / 10 - z / 20) / 3000,
];

describe("Measure uses the drawing aids", () => {
  const box = {
    id: "box",
    type: "imported",
    name: "box",
    properties: {},
    asset: "0f8fad5b-d9cb-469f-a165-70867728950e",
    part: 0,
    bounds: { min: [1000, 1000, 0], max: [7000, 1000, 3000] },
    translation: [0, 0, 0],
  } as Element;

  it("corner to corner at two heights: the straight distance and its across and up parts", () => {
    const { controller } = setup({ endpoint: true }, [box]);
    controller.choose("measure");
    const [ax, ay] = viewerOf([1000, 1000, 0]);
    const [bx, by] = viewerOf([7000, 1000, 3000]);
    controller.tap([ax + 9 / 4000, ay + 6 / 3000]);
    controller.tap([bx - 7 / 4000, by - 5 / 3000]);
    const { measure, notice } = controller.getSnapshot().overlay;
    expect(measure).toEqual([
      [1000, 1000, 0],
      [7000, 1000, 3000],
    ]);
    expect(notice).toMatch(/^6708 mm \(6000 across, 3000 up\)/);
  });

  it("shows the marker while hovering over a corner", () => {
    const { controller } = setup({ endpoint: true }, [box]);
    controller.choose("measure");
    const [x, y] = viewerOf([7000, 1000, 3000]);
    controller.hover([x + 6 / 4000, y]);
    expect(controller.getSnapshot().overlay.snap).toMatchObject({
      label: "Endpoint",
      point: [7000, 1000, 3000],
    });
  });

  it("with no snap in reach it takes the surface point under the pointer, as before", () => {
    const { controller } = setup({}, [box]);
    controller.choose("measure");
    controller.tap(toViewer(20_000, 20_000)); // over the column in the test model: a surface hit at (x, y, 3000)
    const first = controller.getSnapshot().overlay.measure[0];
    expect(first?.[2]).toBe(3000);
    expect(controller.getSnapshot().overlay.snap).toBeNull();
  });
});

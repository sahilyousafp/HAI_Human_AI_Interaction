import {
  DEFAULT_DRAWING_AIDS,
  type DrawingAids,
  type Element,
  type Point2,
  type SceneDocument,
  type SceneOp,
} from "@aex/protocol";
import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, registerBuiltinTools } from "./builtin.ts";
import { ToolController, type ToolEnvironment } from "./controller.ts";
import { DEFAULT_CREATE_LAYOUT } from "./create.ts";
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
  const controller = new ToolController(registry, { tools: DEFAULT_LAYOUT, create: DEFAULT_CREATE_LAYOUT });
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

const created = (applied: Array<{ ops: SceneOp[] }>): Element => {
  const op = applied.at(-1)?.ops[0];
  if (op?.op !== "create") throw new Error("nothing was created");
  return op.element;
};

describe("drawing aids in the create tools", () => {
  it("with only Grid on a wall lands on the 100 mm grid, as before", () => {
    const { controller, applied } = setup();
    controller.choose("wall");
    drag(controller, [1230, 2040], [6480, 2040]);
    expect(created(applied)).toMatchObject({ start: [1200, 2000], end: [6500, 2000] });
  });

  it("Endpoint: a wall starts exactly on the end of another wall", () => {
    const { controller, applied } = setup({ endpoint: true });
    controller.choose("wall");
    const { snap } = drag(controller, [11_100, 5100], [15_000, 9000]);
    expect(snap).toBeNull(); // the marker is gone once the drag ends
    expect(created(applied)).toMatchObject({ start: [11_000, 5000] });
  });

  it("shows the marker with its name while drawing", () => {
    const { controller } = setup({ endpoint: true });
    controller.choose("wall");
    controller.dragStart(toViewer(11_100, 5100));
    controller.drag(toViewer(5100, 5100));
    expect(controller.getSnapshot().overlay.snap).toMatchObject({
      label: "Endpoint",
      point: [5000, 5000, 0],
    });
    expect(controller.getSnapshot().overlay.notice).toMatch(/\(Endpoint\)/);
    controller.cancelDrag();
    expect(controller.getSnapshot().overlay.snap).toBeNull();
  });

  it("hovering shows what a start point would snap to", () => {
    const { controller } = setup({ midpoint: true });
    controller.choose("wall");
    controller.hover(toViewer(8050, 5050));
    expect(controller.getSnapshot().overlay.snap).toMatchObject({
      label: "Midpoint",
      point: [8000, 5000, 0],
    });
    controller.hover(toViewer(30_000, 25_000));
    expect(controller.getSnapshot().overlay.snap).toBeNull();
  });

  it("Ortho: a wall drawn nearly along X ends on the axis, and the notice has length and angle", () => {
    const { controller, applied } = setup({ ortho: true, grid: false });
    controller.choose("wall");
    const { notice } = drag(controller, [1000, 1000], [6000, 1200]);
    expect(created(applied)).toMatchObject({ start: [1000, 1000] });
    const end = (created(applied) as Extract<Element, { type: "wall" }>).end;
    expect(end[1]).toBe(1000);
    expect(notice).toMatch(/^Wall 5000 mm at 0 deg \(Ortho\)/);
  });

  it("Ortho off: a 20 degree wall stays at 20 degrees", () => {
    const { controller, applied } = setup({ grid: false });
    controller.choose("wall");
    drag(controller, [0, 0], [4000, 1456]);
    const end = (created(applied) as Extract<Element, { type: "wall" }>).end;
    expect(end).toEqual([4000, 1456]);
  });

  it("the column goes to the snapped point", () => {
    const { controller, applied } = setup({ endpoint: true });
    controller.choose("column");
    controller.tap(toViewer(5100, 4900));
    expect(created(applied)).toMatchObject({ type: "column", position: [5000, 5000] });
  });

  it("the slab corners snap, and Ortho does not apply to a rectangle", () => {
    const { controller, applied } = setup({ endpoint: true, ortho: true });
    controller.choose("slab");
    drag(controller, [11_100, 5100], [15_000, 9100]);
    const slab = created(applied) as Extract<Element, { type: "slab" }>;
    expect(slab.outline[0]).toEqual([11_000, 5000]);
    expect(slab.outline[2]?.[1]).toBeGreaterThan(8000);
  });
});

describe("drawing aids in Move and Copy", () => {
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

  it("Copy takes the same snaps", () => {
    const { controller, applied } = setup({ endpoint: true });
    controller.choose("copy");
    drag(controller, [20_100, 20_100], [11_100, 5100]);
    expect(created(applied)).toMatchObject({ type: "column", position: [11_000, 5000], name: "Column copy" });
  });
});

/** Where a scene point (mm) is in the view, 0..1, in the oblique test view. */
const viewerOf = ([x, y, z]: [number, number, number]): [number, number] => [
  (x / 10 + z / 20) / 4000,
  ((30_000 - y) / 10 - z / 20) / 3000,
];

describe("drawing aids at every height", () => {
  it("a wall started on the end of a wall on an upper level is on that level, and its end is in that plane", () => {
    const upper = wall("upper", [5000, 2000], [11_000, 2000]);
    const { controller, applied } = setup({ endpoint: true }, [{ ...upper, level: "L1" } as Element]);
    controller.choose("wall");
    // The end at (5000, 2000, 4500), seen from 12 px away.
    const [x, y] = viewerOf([5000, 2000, 4500]);
    controller.hover([x + 12 / 4000, y]);
    expect(controller.getSnapshot().overlay.snap).toMatchObject({
      label: "Endpoint",
      point: [5000, 2000, 4500],
    });
    controller.dragStart([x + 12 / 4000, y]);
    controller.drag(viewerOf([9000, 2000, 4500]));
    controller.dragEnd(viewerOf([9000, 2000, 4500]));
    const wall2 = created(applied) as Extract<Element, { type: "wall" }>;
    expect(wall2.start).toEqual([5000, 2000]);
    expect(wall2.level).toBe("L1");
    expect(wall2.base).toBeUndefined();
    expect(wall2.end[1]).toBe(2000);
  });

  it("a roof corner at a height no level has gives the wall that base and no level", () => {
    const roof = { ...wall("roof", [3000, 3000], [4000, 3000]), base: 31_200 } as Element;
    const { controller, applied } = setup({ endpoint: true }, [roof]);
    controller.choose("wall");
    const [x, y] = viewerOf([3000, 3000, 31_200]);
    controller.dragStart([x + 8 / 4000, y + 5 / 3000]);
    controller.drag(viewerOf([3000 + 3000, 3000, 31_200]));
    controller.dragEnd(viewerOf([6000, 3000, 31_200]));
    const placed = created(applied) as Extract<Element, { type: "wall" }>;
    expect(placed.start).toEqual([3000, 3000]);
    expect(placed.level).toBeUndefined();
    expect(placed.base).toBe(31_200);
  });

  it("a column tapped on an upper wall end is placed on that level", () => {
    const upper = { ...wall("upper", [5000, 2000], [11_000, 2000]), level: "L1" } as Element;
    const { controller, applied } = setup({ endpoint: true }, [upper]);
    controller.choose("column");
    const [x, y] = viewerOf([11_000, 2000, 4500]);
    controller.tap([x - 6 / 4000, y - 4 / 3000]);
    const column = created(applied) as Extract<Element, { type: "column" }>;
    expect(column.position).toEqual([11_000, 2000]);
    expect(column.level).toBe("L1");
  });

  it("with no snap the tools keep drawing on the ground level", () => {
    const { controller, applied } = setup();
    controller.choose("wall");
    drag(controller, [1000, 1000], [4000, 1000]);
    const placed = created(applied) as Extract<Element, { type: "wall" }>;
    expect(placed.level).toBe("L0");
    expect(placed.base).toBeUndefined();
  });
});

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

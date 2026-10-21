import type { GestureEvent, Point2, SceneDocument, SceneOp } from "@aex/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LAYOUT, MASSING_SIZE, registerBuiltinTools } from "./builtin.ts";
import {
  DEFAULT_TOOL,
  FIST_RESET_MS,
  SCROLL_SLOP,
  type ScrollGrab,
  ToolController,
  type ToolEnvironment,
} from "./controller.ts";
import { COLUMN, DEFAULT_CREATE_LAYOUT, SLAB, WALL } from "./create.ts";
import { InputRouter } from "./input-router.ts";
import { ToolRegistry } from "./registry.ts";

// A flat stand-in for the 3D view: viewer x 0..1 spans 0..40 m east, y 0..1 spans 30..0 m north.
const toMm = ([x, y]: Point2): [number, number] => [x * 40_000, (1 - y) * 30_000];
const toViewer = (xMm: number, yMm: number): Point2 => [xMm / 40_000, 1 - yMm / 30_000];

const doc = (): SceneDocument => ({
  version: 1,
  units: "mm",
  up: "Z",
  name: "test",
  levels: [{ id: "L0", name: "Ground", elevation: 0 }],
  elements: {
    "block-b": {
      id: "block-b",
      name: "Block B",
      type: "massing",
      level: "L0",
      properties: {},
      origin: [24_000, 4_000, 0],
      size: [12_000, 12_000, 21_000],
    },
  },
});

/** Where the test's stand-in page has a scrolled list (right of x = 0.95) and buttons (above y = 0.05). */
const LIST_X = 0.95;
const BUTTON_Y = 0.05;

function setup() {
  const registry = new ToolRegistry();
  registerBuiltinTools(registry);
  const controller = new ToolController(registry, { tools: DEFAULT_LAYOUT, create: DEFAULT_CREATE_LAYOUT });
  const applied: Array<{ label: string; ops: SceneOp[] }> = [];
  const calls: string[] = [];
  const navigated: GestureEvent[] = [];
  const env: ToolEnvironment = {
    doc,
    apply: (label, ops) => void applied.push({ label, ops }),
    undo: () => void calls.push("undo"),
    redo: () => void calls.push("redo"),
    select: (ids) => void calls.push(`select:${ids.join(",")}`),
    pick: (at) => {
      const [x, y] = toMm(at);
      const inside = x >= 24_000 && x <= 36_000 && y >= 4_000 && y <= 16_000;
      return inside ? { elementId: "block-b", point: [x, y, 21_000] } : null;
    },
    ground: (at, heightMm = 0) => [...toMm(at), heightMm],
    bounds: () => ({ min: [0, 0, 0], max: [40_000, 30_000, 21_000] }),
    handToViewer: (p) => p,
    handAspect: () => 4 / 3,
    navigate: (e) => void navigated.push(e),
    press: (at) => {
      if (at[1] >= BUTTON_Y) return false;
      calls.push("press");
      return true;
    },
    isButton: (at) => at[1] < BUTTON_Y,
    scrollAt: (at): ScrollGrab | null =>
      at[0] > LIST_X
        ? {
            move: (dy) => void calls.push(`scroll:${dy.toFixed(2)}`),
            release: () => void calls.push("scroll.end"),
          }
        : null,
    onSectionLine: () => false,
    askAgent: () => "The agent is not connected: the bridge is offline.",
  };
  controller.attach(env);
  return { registry, controller, applied, calls, navigated };
}

/** Opens the palette with the mouse at the centre of the view, steers in a direction and releases. */
function flick(controller: ToolController, [dx, dy]: Point2) {
  controller.openPalette({ center: [0.5, 0.5], aspect: 4 / 3 }, "pointer");
  controller.steerPalette([0.5 + dx, 0.5 + dy]);
  controller.releasePalette();
}

describe("palette and active tool", () => {
  it("default tool on start: Select", () => {
    expect(setup().controller.getSnapshot().activeId).toBe(DEFAULT_TOOL);
    expect(DEFAULT_TOOL).toBe("select");
  });

  it("flick right to choose: Measure is in the right-hand slot and becomes active", () => {
    const { controller } = setup();
    expect(controller.getSnapshot().layouts.tools[2]).toBe("measure");
    flick(controller, [0.2, 0]);
    expect(controller.getSnapshot().activeId).toBe("measure");
    expect(controller.getSnapshot().palette).toBeNull();
  });

  it("release in the centre cancels: the active tool is unchanged", () => {
    const { controller } = setup();
    flick(controller, [0.01, 0]);
    expect(controller.getSnapshot().activeId).toBe("select");
  });

  it("a long pinch opens the palette at the hand, steering and release choose, and the orbit ends", () => {
    const { controller, navigated } = setup();
    const router = new InputRouter(controller.routerTargets);
    const ev = (type: string, position: Point2) =>
      ({ type, ts: 1, confidence: 1, hand: "Right", position, delta: [0, 0] }) as GestureEvent;
    router.handle(ev("pinch.drag.start", [0.4, 0.4]));
    navigated.length = 0;
    router.handle(ev("pinch.hold", [0.4, 0.4]));
    expect(controller.getSnapshot().palette?.center).toEqual([0.4, 0.4]);
    router.handle(ev("pinch.drag.update", [0.4, 0.6])); // down: bottom slot, Move
    expect(controller.getSnapshot().palette?.highlighted).toBe(4);
    router.handle(ev("pinch.drag.end", [0.4, 0.6]));
    expect(controller.getSnapshot().activeId).toBe("move");
    // Navigation only hears the orbit end (so it stops orbiting); steering never reaches it.
    expect(navigated.map((e) => e.type)).toEqual(["pinch.drag.end"]);
  });

  describe("fist returns to Select", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("after the fist is held 600 ms (the clutch is recognised 100 ms in)", () => {
      const { controller } = setup();
      controller.choose("move");
      controller.fist(true);
      vi.advanceTimersByTime(FIST_RESET_MS - 100 - 1);
      expect(controller.getSnapshot().activeId).toBe("move");
      vi.advanceTimersByTime(1);
      expect(controller.getSnapshot().activeId).toBe("select");
    });

    it("a fist opened sooner (a clutch while navigating) keeps the tool", () => {
      const { controller } = setup();
      controller.choose("move");
      controller.fist(true);
      vi.advanceTimersByTime(300);
      controller.fist(false);
      vi.advanceTimersByTime(1000);
      expect(controller.getSnapshot().activeId).toBe("move");
    });
  });

  it("registered tool appears in the list of available tools", () => {
    const { registry, controller } = setup();
    const before = controller.getSnapshot().registryVersion;
    registry.register({ id: "rhino-bake", label: "Bake to Rhino", icon: "M4 4h16v16H4z", shortcut: "k" });
    expect(controller.getSnapshot().registryVersion).toBe(before + 1);
    expect(registry.list().map((t) => t.id)).toContain("rhino-bake");
  });

  it("refuses a tool whose shortcut is taken", () => {
    const { registry } = setup();
    expect(() => registry.register({ id: "other", label: "Other", icon: "", shortcut: "m" })).toThrow(
      /already used/,
    );
  });
});

describe("built-in tools", () => {
  it("select: tap selects the element under the pointer, tap on empty space clears", () => {
    const { controller, calls } = setup();
    controller.tap(toViewer(30_000, 10_000));
    controller.tap(toViewer(2_000, 2_000));
    expect(calls).toEqual(["select:block-b", "select:"]);
  });

  it("undo from the palette: undoes once and Move is still active", () => {
    const { controller, calls } = setup();
    controller.choose("move");
    flick(controller, [-0.15, -0.2]); // top left: Undo
    expect(calls).toEqual(["undo"]);
    expect(controller.getSnapshot().activeId).toBe("move");
  });

  it("snapped move: dragging a block about 1.23 m east moves it 1200 mm in one Move transaction", () => {
    const { controller, applied } = setup();
    controller.choose("move");
    const from = toViewer(30_000, 10_000);
    expect(controller.dragStart(from)).toBe(true);
    controller.drag(toViewer(30_600, 10_020));
    controller.drag(toViewer(31_230, 10_030));
    expect(controller.getSnapshot().overlay.movePreview?.offsetMm).toEqual([1200, 0]);
    controller.dragEnd(toViewer(31_230, 10_030));
    expect(applied).toEqual([
      { label: "Move", ops: [{ op: "update", id: "block-b", patch: { origin: [25_200, 4_000, 0] } }] },
    ]);
  });

  it("drag on empty space with Move does not take the drag (the view orbits) and changes nothing", () => {
    const { controller, applied } = setup();
    controller.choose("move");
    expect(controller.dragStart(toViewer(2_000, 2_000))).toBe(false);
    expect(applied).toEqual([]);
  });

  it("measure: two taps show the distance in millimetres and change nothing", () => {
    const { controller, applied } = setup();
    controller.choose("measure");
    controller.tap(toViewer(25_000, 10_000));
    controller.tap(toViewer(31_000, 10_000));
    const { measure, notice } = controller.getSnapshot().overlay;
    expect(measure).toHaveLength(2);
    expect(notice).toMatch(/^6000 mm/);
    expect(applied).toEqual([]);
    controller.choose("select");
    expect(controller.getSnapshot().overlay.measure).toEqual([]);
  });

  it("lower the section: a downward drag lowers the cut, which stays after leaving the tool", () => {
    const { controller } = setup();
    controller.choose("section");
    expect(controller.getSnapshot().overlay.sectionMm).toBe(21_000);
    controller.dragStart([0.5, 0.3]);
    controller.drag([0.5, 0.5]);
    controller.dragEnd([0.5, 0.5]);
    const height = controller.getSnapshot().overlay.sectionMm ?? 0;
    expect(height).toBeLessThan(21_000);
    expect(height).toBeGreaterThan(0);
    controller.choose("select");
    expect(controller.getSnapshot().overlay.sectionMm).toBe(height);
    controller.clearSection();
    expect(controller.getSnapshot().overlay.sectionMm).toBeNull();
  });

  it("place a block: a 6000 x 6000 x 3500 mm massing centred on the snapped tap point", () => {
    const { controller, applied } = setup();
    controller.choose("massing");
    controller.tap(toViewer(10_040, 20_960));
    expect(applied).toHaveLength(1);
    expect(applied[0]?.label).toBe("Add massing");
    const op = applied[0]?.ops[0];
    if (op?.op !== "create" || op.element.type !== "massing") throw new Error("expected a massing create");
    expect(op.element.size).toEqual(MASSING_SIZE);
    expect(op.element.origin).toEqual([10_000 - 3_000, 21_000 - 3_000, 0]);
  });

  it("confirm with nod: the marked element is deleted in one Delete transaction", () => {
    const { controller, applied } = setup();
    controller.choose("delete");
    controller.tap(toViewer(30_000, 10_000));
    expect(controller.getSnapshot().overlay.marked).toBe("block-b");
    expect(controller.getSnapshot().question).toMatch(/Delete Block B/);
    expect(applied).toEqual([]);
    controller.respond(true);
    expect(applied).toEqual([{ label: "Delete", ops: [{ op: "delete", id: "block-b" }] }]);
    expect(controller.getSnapshot().overlay.marked).toBeNull();
  });

  it("cancel with shake: nothing is deleted", () => {
    const { controller, applied } = setup();
    controller.choose("delete");
    controller.tap(toViewer(30_000, 10_000));
    controller.respond(false);
    expect(applied).toEqual([]);
    expect(controller.getSnapshot().question).toBeNull();
  });

  it("no agent: Ask agent shows why and keeps the tool", () => {
    const { controller } = setup();
    controller.choose("measure");
    controller.choose("ask-agent");
    expect(controller.getSnapshot().overlay.notice).toMatch(/agent is not connected/);
    expect(controller.getSnapshot().activeId).toBe("measure");
  });
});

describe("two hands", () => {
  const ev = (type: string, hand: "Left" | "Right", position: Point2) =>
    ({ type, ts: 1, confidence: 1, hand, position, delta: [0, 0] }) as GestureEvent;

  it("the left hand's long pinch opens the create ring; steering up and letting go picks Wall", () => {
    const { controller } = setup();
    const router = new InputRouter(controller.routerTargets);
    router.handle(ev("pinch.drag.start", "Left", [0.4, 0.4]));
    router.handle(ev("pinch.hold", "Left", [0.4, 0.4]));
    expect(controller.getSnapshot().palette).toMatchObject({ ring: "create", hand: "Left" });
    router.handle(ev("pinch.drag.update", "Left", [0.4, 0.2])); // up: the top slot
    router.handle(ev("pinch.drag.end", "Left", [0.4, 0.2]));
    expect(controller.getSnapshot().activeId).toBe("wall");
  });

  it("the active tool takes one hand's drag at a time: the other hand's drag navigates", () => {
    const { controller } = setup();
    controller.choose("move");
    const on = toViewer(30_000, 10_000);
    expect(controller.dragStart(on, "Left")).toBe(true);
    expect(controller.dragStart(on, "Right")).toBe(false);
    controller.dragEnd(on, "Left");
    expect(controller.dragStart(on, "Right")).toBe(true);
  });

  it("a pinch-drag on a scrolled list scrolls it with the hand, whichever hand", () => {
    const { controller, calls } = setup();
    expect(controller.dragStart([0.97, 0.5], "Left")).toBe(true);
    controller.drag([0.97, 0.6], "Left");
    controller.dragEnd([0.97, 0.6], "Left");
    expect(calls).toEqual(["scroll:0.10", "scroll.end"]);
  });

  it("a pinch on a button presses it, unless it moves up or down first in a scrolled list: then it scrolls", () => {
    const pressed = setup();
    expect(pressed.controller.dragStart([0.97, 0.02], "Right")).toBe(true);
    pressed.controller.drag([0.97, 0.02 + SCROLL_SLOP / 2], "Right");
    pressed.controller.dragEnd([0.97, 0.02 + SCROLL_SLOP / 2], "Right");
    expect(pressed.calls).toEqual(["press"]);

    const scrolled = setup();
    scrolled.controller.dragStart([0.97, 0.02], "Right");
    scrolled.controller.drag([0.97, 0.12], "Right");
    scrolled.controller.dragEnd([0.97, 0.12], "Right");
    expect(scrolled.calls).toEqual(["scroll:0.10", "scroll.end"]);
  });
});

describe("create tools", () => {
  /** The single element a create transaction adds. */
  const created = (applied: Array<{ label: string; ops: SceneOp[] }>) => {
    const op = applied[0]?.ops[0];
    if (applied.length !== 1 || op?.op !== "create") throw new Error("expected one create");
    return { label: applied[0]?.label, element: op.element };
  };

  it("wall: a drag on the ground draws a 200 mm thick, 3000 mm high wall between the snapped ends", () => {
    const { controller, applied } = setup();
    controller.choose("wall");
    expect(controller.dragStart(toViewer(2_030, 2_040))).toBe(true);
    controller.drag(toViewer(5_000, 2_000));
    const draft = controller.getSnapshot().overlay.draft;
    expect(draft).toMatchObject({ type: "wall", start: [2_000, 2_000], end: [5_000, 2_000] });
    expect(controller.getSnapshot().overlay.notice).toMatch(/^Wall 3000 mm/);
    expect(applied).toEqual([]); // nothing is created until the hand lets go
    controller.drag(toViewer(6_210, 2_000));
    controller.dragEnd(toViewer(6_210, 2_000));
    const { label, element } = created(applied);
    expect(label).toBe("Add Wall 1");
    expect(element).toMatchObject({
      type: "wall",
      level: "L0",
      start: [2_000, 2_000],
      end: [6_200, 2_000],
      thickness: WALL.thickness,
      height: WALL.height,
    });
    expect(controller.getSnapshot().overlay.draft).toBeNull();
  });

  it("wall: a drag shorter than 300 mm places nothing and says why", () => {
    const { controller, applied } = setup();
    controller.choose("wall");
    controller.dragStart(toViewer(2_000, 2_000));
    controller.drag(toViewer(2_200, 2_000));
    controller.dragEnd(toViewer(2_200, 2_000));
    expect(applied).toEqual([]);
    expect(controller.getSnapshot().overlay.notice).toMatch(/at least 300 mm/);
  });

  it("slab: a drag between two corners draws a counter-clockwise rectangle, 200 mm thick", () => {
    const { controller, applied } = setup();
    controller.choose("slab");
    controller.dragStart(toViewer(8_000, 6_000));
    controller.drag(toViewer(2_000, 1_000)); // dragged down and to the left
    controller.dragEnd(toViewer(2_000, 1_000));
    const { element } = created(applied);
    expect(element).toMatchObject({
      type: "slab",
      thickness: SLAB.thickness,
      outline: [
        [2_000, 1_000],
        [8_000, 1_000],
        [8_000, 6_000],
        [2_000, 6_000],
      ],
    });
  });

  it("column: a tap places a 400 x 400 mm column, 3000 mm high, snapped to 100 mm", () => {
    const { controller, applied } = setup();
    controller.choose("column");
    controller.tap(toViewer(3_040, 7_960));
    const { element } = created(applied);
    expect(element).toMatchObject({
      type: "column",
      position: [3_000, 8_000],
      section: COLUMN.section,
      height: COLUMN.height,
    });
  });

  it("copy: dragging an element places a snapped copy and leaves the original", () => {
    const { controller, applied } = setup();
    controller.choose("copy");
    expect(controller.dragStart(toViewer(30_000, 10_000))).toBe(true);
    controller.drag(toViewer(30_000, 23_040));
    expect(controller.getSnapshot().overlay.draft).toMatchObject({ origin: [24_000, 17_000, 0] });
    controller.dragEnd(toViewer(30_000, 23_040));
    const { label, element } = created(applied);
    expect(label).toBe("Copy Block B");
    expect(element).toMatchObject({ type: "massing", name: "Block B copy", origin: [24_000, 17_000, 0] });
    expect(element.id).not.toBe("block-b");
  });

  it("copy: a drag that starts off the model does not take the drag (the view orbits)", () => {
    const { controller } = setup();
    controller.choose("copy");
    expect(controller.dragStart(toViewer(2_000, 2_000))).toBe(false);
  });

  it("the create ring's default layout lists the create tools first, clockwise from the top", () => {
    expect(DEFAULT_CREATE_LAYOUT.slice(0, 5)).toEqual(["wall", "slab", "column", "massing", "copy"]);
  });
});

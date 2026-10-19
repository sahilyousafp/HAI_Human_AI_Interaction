import type { GestureEvent, Point2, SceneDocument, SceneOp } from "@aex/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LAYOUT, MASSING_SIZE, registerBuiltinTools } from "./builtin.ts";
import { DEFAULT_TOOL, FIST_RESET_MS, ToolController, type ToolEnvironment } from "./controller.ts";
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

function setup() {
  const registry = new ToolRegistry();
  registerBuiltinTools(registry);
  const controller = new ToolController(registry, DEFAULT_LAYOUT);
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
    press: () => false,
    isButton: () => false,
    onSectionLine: () => false,
    agentAvailable: () => false,
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
    expect(controller.getSnapshot().layout[2]).toBe("measure");
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

  it("no agent yet: Ask agent explains that the agent is not connected and keeps the tool", () => {
    const { controller } = setup();
    controller.choose("measure");
    controller.choose("ask-agent");
    expect(controller.getSnapshot().overlay.notice).toMatch(/agent is not connected/);
    expect(controller.getSnapshot().activeId).toBe("measure");
  });
});

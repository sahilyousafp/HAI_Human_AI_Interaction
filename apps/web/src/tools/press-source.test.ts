import type { Point2 } from "@aex/protocol";
import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, registerBuiltinTools } from "./builtin.ts";
import { type PointerSource, ToolController, type ToolEnvironment } from "./controller.ts";
import { DEFAULT_CREATE_LAYOUT } from "./create.ts";
import { ToolRegistry } from "./registry.ts";

/** A page where the left hand's pointer is snapped to a button, wherever it is, and nothing else is a button. */
function setup() {
  const registry = new ToolRegistry();
  registerBuiltinTools(registry);
  const controller = new ToolController(registry, { tools: DEFAULT_LAYOUT, create: DEFAULT_CREATE_LAYOUT });
  const pressed: Array<{ at: Point2; source?: PointerSource }> = [];
  const navigated: string[] = [];
  const snapped: PointerSource = "Left";
  const env: ToolEnvironment = {
    doc: () => null,
    apply: () => {},
    undo: () => {},
    redo: () => {},
    select: () => {},
    pick: () => null,
    ground: (at, heightMm = 0) => [at[0], at[1], heightMm],
    bounds: () => ({ min: [0, 0, 0], max: [1, 1, 1] }),
    handToViewer: (p) => p,
    handAspect: () => 4 / 3,
    navigate: (e) => void navigated.push(e.type),
    press: (at, source) => {
      if (source !== snapped) return false;
      pressed.push({ at, source });
      return true;
    },
    isButton: (_at, source) => source === snapped,
    scrollAt: () => null,
    onSectionLine: () => false,
    askAgent: () => null,
  };
  controller.attach(env);
  return { controller, pressed, navigated };
}

describe("a hand's pointer presses the control it is snapped to", () => {
  it("a tap from the snapped hand presses, wherever the position is", () => {
    const { controller, pressed } = setup();
    controller.routerTargets.tool.tap([0.9, 0.9], "Left");
    expect(pressed).toHaveLength(1);
    expect(pressed[0]?.source).toBe("Left");
  });

  it("a tap from the other hand does not", () => {
    const { controller, pressed } = setup();
    controller.routerTargets.tool.tap([0.9, 0.9], "Right");
    expect(pressed).toHaveLength(0);
  });

  it("a long pinch from the snapped hand is a press on release, never an orbit", () => {
    const { controller, pressed, navigated } = setup();
    const tool = controller.routerTargets.tool;
    expect(tool.dragStart([0.2, 0.2], "Left")).toBe(true);
    tool.drag([0.4, 0.2], "Left"); // the hand drifted sideways, not enough to scroll
    tool.dragEnd([0.4, 0.2], "Left");
    expect(pressed).toHaveLength(1);
    expect(navigated).toEqual([]);
  });

  it("the other hand's drag is not taken by it", () => {
    const { controller } = setup();
    expect(controller.routerTargets.tool.dragStart([0.2, 0.2], "Right")).toBe(false);
  });
});

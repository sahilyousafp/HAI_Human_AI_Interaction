import type { GestureEvent, Hand, Point2 } from "@aex/protocol";
import { describe, expect, it } from "vitest";
import { InputRouter, type RouterTargets } from "./input-router.ts";

function setup(toolTakesDrag = false) {
  const log: string[] = [];
  let open = false;
  const targets: RouterTargets = {
    palette: {
      get isOpen() {
        return open;
      },
      open: () => {
        open = true;
        log.push("palette.open");
      },
      steer: () => log.push("palette.steer"),
      release: () => {
        open = false;
        log.push("palette.release");
      },
      cancel: () => {
        open = false;
        log.push("palette.cancel");
      },
    },
    tool: {
      tap: () => log.push("tool.tap"),
      dragStart: () => {
        log.push("tool.dragStart");
        return toolTakesDrag;
      },
      drag: () => log.push("tool.drag"),
      dragEnd: () => log.push("tool.dragEnd"),
      dragCancel: () => log.push("tool.dragCancel"),
      nod: () => log.push("tool.nod"),
      shake: () => log.push("tool.shake"),
      clutch: (closed) => log.push(`tool.clutch.${closed}`),
    },
    navigation: (e) => log.push(`nav:${e.type}`),
  };
  return { router: new InputRouter(targets), log };
}

let ts = 1000;
const at: Point2 = [0.5, 0.5];
const ev = (type: string, hand: Hand = "Right", extra: object = {}): GestureEvent =>
  ({ type, ts: ts++, confidence: 1, hand, position: at, delta: [0.01, 0], ...extra }) as GestureEvent;
const twoHand = (type: string): GestureEvent =>
  ({ type, ts: ts++, confidence: 1, hand: "both", distance: 0.3, midpoint: at, angle: 0 }) as GestureEvent;

describe("InputRouter", () => {
  it("drag events never reach navigation while the palette is open", () => {
    const { router, log } = setup();
    // A long pinch: the drag started (as an orbit) before the hold, then the palette takes it over.
    router.handle(ev("pinch.drag.start"));
    router.handle(ev("pinch.hold"));
    log.length = 0;
    for (let i = 0; i < 5; i++) router.handle(ev("pinch.drag.update"));
    router.handle(twoHand("twohand.update"));
    router.handle(ev("pinch.drag.start", "Left")); // the other hand cannot navigate either
    router.handle(ev("pinch.drag.update", "Left"));
    router.handle(ev("pinch.drag.end"));
    expect(log.filter((l) => l.startsWith("nav:"))).toEqual([]);
    expect(log.filter((l) => l === "palette.steer")).toHaveLength(5);
    expect(log.at(-1)).toBe("palette.release");
  });

  it("a long pinch while a tool holds something keeps holding it: no palette", () => {
    const { router, log } = setup(true);
    router.handle(ev("pinch.drag.start"));
    router.handle(ev("pinch.drag.update"));
    router.handle(ev("pinch.hold"));
    router.handle(ev("pinch.drag.update"));
    router.handle(ev("pinch.drag.end"));
    expect(log).toEqual(["tool.dragStart", "tool.drag", "tool.drag", "tool.dragEnd"]);
  });

  it("a long pinch during an orbit ends the orbit before the palette opens", () => {
    const { router, log } = setup(false);
    router.handle(ev("pinch.drag.start"));
    router.handle(ev("pinch.hold"));
    expect(log).toEqual(["tool.dragStart", "nav:pinch.drag.start", "nav:pinch.drag.end", "palette.open"]);
  });

  it("without the palette, a drag the tool does not take navigates", () => {
    const { router, log } = setup(false);
    router.handle(ev("pinch.drag.start"));
    router.handle(ev("pinch.drag.update"));
    router.handle(ev("pinch.drag.end"));
    expect(log).toEqual([
      "tool.dragStart",
      "nav:pinch.drag.start",
      "nav:pinch.drag.update",
      "nav:pinch.drag.end",
    ]);
  });

  it("a drag the tool takes never navigates", () => {
    const { router, log } = setup(true);
    router.handle(ev("pinch.drag.start"));
    router.handle(ev("pinch.drag.update"));
    router.handle(ev("pinch.drag.end"));
    expect(log).toEqual(["tool.dragStart", "tool.drag", "tool.dragEnd"]);
  });

  it("taps go to the tool, except while the palette is open", () => {
    const { router, log } = setup();
    router.handle(ev("pinch.tap"));
    router.handle(ev("pinch.drag.start"));
    router.handle(ev("pinch.hold"));
    router.handle(ev("pinch.tap", "Left"));
    expect(log.filter((l) => l === "tool.tap")).toHaveLength(1);
  });

  it("disengaging closes the palette without choosing and cancels a tool drag", () => {
    const palette = setup();
    palette.router.handle(ev("pinch.drag.start"));
    palette.router.handle(ev("pinch.hold"));
    palette.router.handle({ type: "disengaged", ts: ts++, confidence: 1, reason: "idle" });
    expect(palette.log).toContain("palette.cancel");
    expect(palette.log).not.toContain("palette.release");

    const tool = setup(true);
    tool.router.handle(ev("pinch.drag.start"));
    tool.router.handle({ type: "disengaged", ts: ts++, confidence: 1, reason: "no-hands" });
    expect(tool.log).toContain("tool.dragCancel");
  });

  it("head gestures and the fist reach the tool", () => {
    const { router, log } = setup();
    router.handle({ type: "head.nod", ts: ts++, confidence: 1 });
    router.handle({ type: "head.shake", ts: ts++, confidence: 1 });
    router.handle({ type: "clutch.start", ts: ts++, confidence: 1, hand: "Right" });
    router.handle({ type: "clutch.end", ts: ts++, confidence: 1, hand: "Right" });
    expect(log).toEqual(["tool.nod", "tool.shake", "tool.clutch.true", "tool.clutch.false"]);
  });
});

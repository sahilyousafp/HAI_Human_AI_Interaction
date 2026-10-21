import {
  DEFAULT_BINDINGS,
  type FeatureId,
  type GestureBindings,
  type GestureEvent,
  type Hand,
  type Point2,
} from "@aex/protocol";
import { describe, expect, it } from "vitest";
import { InputRouter, type RouterAgent, type RouterTargets } from "./input-router.ts";

function setup(
  toolTakesDrag = false,
  options: { bindings?: Partial<GestureBindings>; cards?: number; off?: FeatureId[] } = {},
) {
  const log: string[] = [];
  let cards = options.cards ?? 0;
  let open = false;
  const targets: RouterTargets = {
    palette: {
      get isOpen() {
        return open;
      },
      open: (_position, ring, hand) => {
        open = true;
        log.push(`palette.open:${ring}:${hand}`);
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
      tap: (_p, hand) => log.push(hand === "Left" ? "tool.tap:Left" : "tool.tap"),
      dragStart: (_p, hand) => {
        log.push(hand === "Left" ? "tool.dragStart:Left" : "tool.dragStart");
        return toolTakesDrag;
      },
      drag: (_p, hand) => log.push(hand === "Left" ? "tool.drag:Left" : "tool.drag"),
      dragEnd: (_p, hand) => log.push(hand === "Left" ? "tool.dragEnd:Left" : "tool.dragEnd"),
      dragCancel: () => log.push("tool.dragCancel"),
      nod: () => log.push("tool.nod"),
      shake: () => log.push("tool.shake"),
      clutch: (closed, held) => {
        log.push(`tool.clutch.${closed}`);
        if (closed) held?.(); // as if the fist were held long enough
      },
      select: () => log.push("tool.select"),
      undo: () => log.push("tool.undo"),
      redo: () => log.push("tool.redo"),
      cancel: () => log.push("tool.cancel"),
    },
    navigation: (e, mode) => log.push(`nav:${e.type}${mode === "pan" ? ":pan" : ""}`),
  };
  const agent: RouterAgent = {
    answer: (yes) => {
      if (cards !== 1) return false;
      cards = 0;
      log.push(`agent.${yes ? "allow" : "deny"}`);
      return true;
    },
    stop: () => log.push("agent.stop"),
    ask: () => log.push("agent.ask"),
  };
  const bindings = { ...DEFAULT_BINDINGS, ...options.bindings };
  const enabled = (feature: FeatureId) => !options.off?.includes(feature);
  return { router: new InputRouter(targets, { bindings: () => bindings, agent, enabled }), log };
}

let ts = 1000;
const at: Point2 = [0.5, 0.5];
const ev = (type: string, hand: Hand = "Right", extra: object = {}): GestureEvent =>
  ({ type, ts: ts++, confidence: 1, hand, position: at, delta: [0.01, 0], ...extra }) as GestureEvent;
const twoHand = (type: string): GestureEvent =>
  ({ type, ts: ts++, confidence: 1, hand: "both", distance: 0.3, midpoint: at, angle: 0 }) as GestureEvent;

describe("InputRouter", () => {
  it("the ring gets the drag of the hand that opened it, and nothing of that hand navigates", () => {
    const { router, log } = setup();
    // A long pinch: the drag started (as an orbit) before the hold, then the ring takes it over.
    router.handle(ev("pinch.drag.start"));
    router.handle(ev("pinch.hold"));
    log.length = 0;
    for (let i = 0; i < 5; i++) router.handle(ev("pinch.drag.update"));
    router.handle(twoHand("twohand.update"));
    router.handle(ev("pinch.drag.end"));
    expect(log.filter((l) => l.startsWith("nav:"))).toEqual([]);
    expect(log.filter((l) => l === "palette.steer")).toHaveLength(5);
    expect(log.at(-1)).toBe("palette.release");
  });

  it("a long pinch opens the right hand's tools ring and the left hand's create ring", () => {
    const right = setup();
    right.router.handle(ev("pinch.drag.start"));
    right.router.handle(ev("pinch.hold"));
    expect(right.log.at(-1)).toBe("palette.open:tools:Right");
    const left = setup();
    left.router.handle(ev("pinch.drag.start", "Left"));
    left.router.handle(ev("pinch.hold", "Left"));
    expect(left.log.at(-1)).toBe("palette.open:create:Left");
  });

  it("while one hand holds its ring open, the other hand still taps, drags and navigates", () => {
    const { router, log } = setup();
    router.handle(ev("pinch.drag.start", "Left"));
    router.handle(ev("pinch.hold", "Left"));
    log.length = 0;
    router.handle(ev("pinch.tap"));
    router.handle(ev("pinch.drag.start"));
    router.handle(ev("pinch.drag.update"));
    router.handle(ev("pinch.drag.end"));
    router.handle(ev("pinch.hold")); // one ring at a time: a second long pinch opens nothing
    expect(log).toEqual([
      "tool.tap",
      "tool.dragStart",
      "nav:pinch.drag.start",
      "nav:pinch.drag.update",
      "nav:pinch.drag.end",
    ]);
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
    expect(log).toEqual([
      "tool.dragStart",
      "nav:pinch.drag.start",
      "nav:pinch.drag.end",
      "palette.open:tools:Right",
    ]);
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

  it("taps from either hand go to the tool, with the hand", () => {
    const { router, log } = setup();
    router.handle(ev("pinch.tap"));
    router.handle(ev("pinch.tap", "Left"));
    expect(log).toEqual(["tool.tap", "tool.tap:Left"]);
  });

  it("each hand drags on its own: the controller decides per hand", () => {
    const { router, log } = setup(true);
    router.handle(ev("pinch.drag.start", "Left"));
    router.handle(ev("pinch.drag.start"));
    router.handle(ev("pinch.drag.update", "Left"));
    router.handle(ev("pinch.drag.update"));
    router.handle(ev("pinch.drag.end", "Left"));
    router.handle(ev("pinch.drag.end"));
    expect(log).toEqual([
      "tool.dragStart:Left",
      "tool.dragStart",
      "tool.drag:Left",
      "tool.drag",
      "tool.dragEnd:Left",
      "tool.dragEnd",
    ]);
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

  it("both fists together are the stop's start: neither hand's fist action runs until both open", () => {
    const { router, log } = setup(false, { bindings: { "fist.left": "undo", "fist.right": "undo" } });
    const clutch = (type: "clutch.start" | "clutch.end", hand: Hand) =>
      router.handle({ type, ts: ts++, confidence: 1, hand });
    clutch("clutch.start", "Left");
    log.length = 0; // a single fist starts its timer (the fake runs it at once)
    clutch("clutch.start", "Right");
    clutch("clutch.end", "Left");
    clutch("clutch.start", "Left");
    clutch("clutch.end", "Left");
    clutch("clutch.end", "Right");
    expect(log.filter((l) => l === "tool.undo")).toEqual([]);
    expect(log.every((l) => l === "tool.clutch.false")).toBe(true);
    // Once both hands have opened, a single fist works again.
    clutch("clutch.start", "Right");
    expect(log.at(-1)).toBe("tool.undo");
  });
});

describe("gesture bindings", () => {
  it("defaults: tap uses the tool, nod and shake answer the tool, fists then open hands stop the agents", () => {
    const { router, log } = setup();
    router.handle(ev("pinch.tap"));
    router.handle(ev("head.nod"));
    router.handle(ev("head.shake"));
    router.handle({ type: "hands.stop", ts: ts++, confidence: 1 });
    expect(log).toEqual(["tool.tap", "tool.nod", "tool.shake", "agent.stop"]);
  });

  it("yes and no answer the agent's only waiting card first, and then not the tool", () => {
    const { router, log } = setup(false, { cards: 1 });
    router.handle(ev("head.shake"));
    router.handle(ev("head.shake"));
    expect(log).toEqual(["agent.deny", "tool.shake"]);
  });

  it("tap set to select selects whatever the tool; long pinch set to undo undoes instead of opening the palette", () => {
    const { router, log } = setup(false, { bindings: { "tap.right": "select", "hold.right": "undo" } });
    router.handle(ev("pinch.tap"));
    router.handle(ev("pinch.drag.start"));
    router.handle(ev("pinch.hold"));
    expect(log).toEqual(["tool.select", "tool.dragStart", "nav:pinch.drag.start", "tool.undo"]);
  });

  it("drag set to pan pans, and set to nothing does nothing (even over a tool that would take it)", () => {
    const panning = setup(true, { bindings: { "drag.right": "pan" } });
    panning.router.handle(ev("pinch.drag.start"));
    panning.router.handle(ev("pinch.drag.update"));
    expect(panning.log).toEqual(["nav:pinch.drag.start:pan", "nav:pinch.drag.update:pan"]);
    const off = setup(true, { bindings: { "drag.right": "none" } });
    off.router.handle(ev("pinch.drag.start"));
    off.router.handle(ev("pinch.drag.update"));
    off.router.handle(ev("pinch.drag.end"));
    expect(off.log).toEqual([]);
  });

  it("fist set to undo undoes once held; set to nothing ignores the fist", () => {
    const undo = setup(false, { bindings: { "fist.right": "undo" } });
    undo.router.handle(ev("clutch.start"));
    expect(undo.log).toEqual(["tool.clutch.true", "tool.undo"]);
    const off = setup(false, { bindings: { "fist.right": "none", twohand: "none" } });
    off.router.handle(ev("clutch.start"));
    off.router.handle(twoHand("twohand.start"));
    expect(off.log).toEqual([]);
  });

  it("each hand has its own settings: the left hand's tap selects while the right's uses the tool", () => {
    const { router, log } = setup(false, { bindings: { "tap.left": "select" } });
    router.handle(ev("pinch.tap", "Left"));
    router.handle(ev("pinch.tap"));
    expect(log).toEqual(["tool.select", "tool.tap"]);
  });

  it("nod set to ask the agent opens the agent panel", () => {
    const { router, log } = setup(false, { bindings: { nod: "ask-agent" } });
    router.handle(ev("head.nod"));
    expect(log).toEqual(["agent.ask"]);
  });
});

describe("feature switches", () => {
  it("switched-off features ignore their gestures", () => {
    const { router, log } = setup(false, {
      off: ["twoHandNavigation", "headGestures", "stopGesture", "toolRings"],
    });
    router.handle(twoHand("twohand.start"));
    router.handle({ type: "head.nod", ts: ts++, confidence: 1 });
    router.handle({ type: "hands.stop", ts: ts++, confidence: 1 });
    router.handle(ev("pinch.drag.start"));
    router.handle(ev("pinch.hold"));
    expect(log).toEqual(["tool.dragStart", "nav:pinch.drag.start"]);
  });

  it("without the create tools, the left hand's long pinch opens no ring; the right hand's still does", () => {
    const { router, log } = setup(false, { off: ["createTools"] });
    router.handle(ev("pinch.drag.start", "Left"));
    router.handle(ev("pinch.hold", "Left"));
    expect(log.some((l) => l.startsWith("palette.open"))).toBe(false);
    router.handle(ev("pinch.drag.start"));
    router.handle(ev("pinch.hold"));
    expect(log.at(-1)).toBe("palette.open:tools:Right");
  });
});

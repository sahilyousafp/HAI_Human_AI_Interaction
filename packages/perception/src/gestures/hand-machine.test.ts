import type { GestureEvent, Point2 } from "@aex/protocol";
import { describe, expect, it } from "vitest";
import { HandMachine, type HandObservation } from "./hand-machine.ts";

const STEP = 1000 / 30;
const engaged = { engaged: true };

/** Drives a machine through observations at 30 fps; returns every event in order. */
function run(
  steps: Array<Partial<HandObservation> | null>,
  ctx = engaged,
  machine = new HandMachine("Right"),
): GestureEvent[] {
  const events: GestureEvent[] = [];
  steps.forEach((s, i) => {
    const ts = 1000 + i * STEP;
    const obs: HandObservation | null =
      s === null
        ? null
        : { ts, ratio: 1, others: 1.5, posture: "other", position: [0.5, 0.5], confidence: 0.9, ...s };
    events.push(...machine.update(obs, ts, ctx));
  });
  return events;
}
const types = (events: GestureEvent[]) => events.map((e) => e.type);
const repeat = <T>(n: number, f: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => f(i));
const at = (x: number, y = 0.5): Point2 => [x, y];

describe("pinch hysteresis and minimum hold", () => {
  it("borderline distance does not flicker", () => {
    const events = run([
      ...repeat(10, () => ({ ratio: 0.1 })),
      ...repeat(30, (i) => ({ ratio: i % 2 ? 0.17 : 0.19 })),
      ...repeat(3, () => ({ ratio: 0.8 })),
    ]);
    // One pinch only: it started once and ended once (as a drag, since it lasted over 250 ms).
    expect(types(events).filter((t) => t === "pinch.drag.start")).toHaveLength(1);
    expect(types(events).filter((t) => t === "pinch.drag.end")).toHaveLength(1);
    expect(types(events)).not.toContain("pinch.tap");
  });

  it("a brief touch is not a pinch", () => {
    // 30 ms below the threshold (one frame at 30 fps is 33 ms; use timestamps 30 ms apart).
    const m = new HandMachine("Right");
    const obs = (ts: number, ratio: number): HandObservation => ({
      ts,
      ratio,
      others: 1.5,
      posture: "other",
      position: [0.5, 0.5],
      confidence: 1,
    });
    const events = [
      ...m.update(obs(1000, 0.1), 1000, engaged),
      ...m.update(obs(1030, 0.1), 1030, engaged),
      ...m.update(obs(1060, 0.8), 1060, engaged),
      ...m.update(obs(1090, 0.8), 1090, engaged),
    ];
    expect(events).toEqual([]);
  });

  it("a near miss is not a pinch: fingertips hovering just apart never start one", () => {
    // Labelled footage: a visible 1-3 mm gap reads 0.18-0.21, real touches 0.12-0.15.
    const events = run([
      ...repeat(30, (i) => ({ ratio: 0.18 + (i % 4) * 0.01 })),
      ...repeat(3, () => ({ ratio: 0.8 })),
    ]);
    expect(events).toEqual([]);
  });
});

describe("tap and drag", () => {
  it("a deliberate pinch is a tap: still for 500 ms, then released (recorded pinches last 450-650 ms)", () => {
    const events = run([
      ...repeat(15, () => ({ ratio: 0.12, position: at(0.5) })),
      ...repeat(3, () => ({ ratio: 0.8 })),
    ]);
    expect(types(events)).toEqual(["pinch.tap"]);
  });

  it("a still pinch released just before the hold is still a tap", () => {
    const events = run([
      ...repeat(22, () => ({ ratio: 0.12, position: at(0.5) })),
      ...repeat(3, () => ({ ratio: 0.8 })),
    ]);
    expect(types(events)).toEqual(["pinch.tap"]);
  });

  it("tap: a 180 ms still pinch emits one tap and no drag events", () => {
    const events = run([...repeat(6, () => ({ ratio: 0.1 })), ...repeat(3, () => ({ ratio: 0.8 }))]);
    expect(types(events)).toEqual(["pinch.tap"]);
  });

  it("drag: an 800 ms moving pinch emits start, updates and end in order", () => {
    const events = run([
      ...repeat(24, (i) => ({ ratio: 0.1, position: at(0.3 + i * 0.01) })),
      ...repeat(3, () => ({ ratio: 0.8 })),
    ]);
    const t = types(events);
    expect(t[0]).toBe("pinch.drag.start");
    expect(t.at(-1)).toBe("pinch.drag.end");
    expect(t.filter((x) => x === "pinch.drag.update").length).toBeGreaterThan(0);
    expect(t.slice(1, -1).every((x) => x === "pinch.drag.update")).toBe(true);
    // Deltas add up to the total movement since the drag start.
    const start = events[0] as Extract<GestureEvent, { type: "pinch.drag.start" }>;
    const sum = events
      .filter(
        (e): e is Extract<GestureEvent, { type: "pinch.drag.update" }> => e.type === "pinch.drag.update",
      )
      .reduce((s, e) => s + e.delta[0], 0);
    const last = events.at(-2) as Extract<GestureEvent, { type: "pinch.drag.update" }>;
    expect(start.position[0] + sum).toBeCloseTo(last.position[0], 9);
  });
});

describe("clutch (spec: closed fist acts as a clutch)", () => {
  it("reposition with clutch: no updates while the fist is closed, and the resumed drag starts at the new position", () => {
    const events = run([
      ...repeat(15, (i) => ({ ratio: 0.1, position: at(0.3 + i * 0.01) })), // drag to the right
      ...repeat(10, (i) => ({ ratio: 0.1, posture: "fist" as const, position: at(0.45 - i * 0.03) })), // fist, move back
      ...repeat(15, (i) => ({ ratio: 0.1, position: at(0.2 + i * 0.01) })), // reopen into a pinch, drag again
      ...repeat(3, () => ({ ratio: 0.8 })),
    ]);
    const t = types(events);
    const clutchStart = t.indexOf("clutch.start");
    const clutchEnd = t.indexOf("clutch.end");
    expect(clutchStart).toBeGreaterThan(0);
    expect(clutchEnd).toBeGreaterThan(clutchStart);
    // The first drag ended before the clutch, nothing happened during it.
    expect(t[clutchStart - 1]).toBe("pinch.drag.end");
    expect(t.slice(clutchStart + 1, clutchEnd)).toEqual([]);
    // The resumed drag starts where the hand now is, not where the first drag left off.
    const resumed = events.slice(clutchEnd).find((e) => e.type === "pinch.drag.start") as Extract<
      GestureEvent,
      { type: "pinch.drag.start" }
    >;
    expect(resumed.position[0]).toBeLessThan(0.3);
  });

  it("a fist is never read as a pinch or a tap", () => {
    const events = run([
      ...repeat(10, () => ({ ratio: 0.1, posture: "fist" as const })),
      // Clutch release is debounced by 100 ms: five frames at 30 fps.
      ...repeat(5, () => ({})),
    ]);
    expect(types(events)).toEqual(["clutch.start", "clutch.end"]);
  });

  it("closing into a fist and opening again is not a pinch, though the thumb passes the index both ways", () => {
    // On footage the frames between an open hand and a fist read as low as 0.11 with the other fingers half curled.
    const events = run([
      ...repeat(4, () => ({ ratio: 0.12, others: 1.1 })),
      ...repeat(10, () => ({ ratio: 0.12, posture: "fist" as const, others: 0.75 })),
      ...repeat(6, () => ({ ratio: 0.12, others: 1.1 })),
      ...repeat(3, () => ({ ratio: 0.8 })),
    ]);
    expect(types(events)).toEqual(["clutch.start", "clutch.end"]);
  });

  it("a touch that becomes a fist before the minimum hold is dropped, not resumed after the fist", () => {
    const events = run([
      { ratio: 0.12 },
      ...repeat(10, () => ({ ratio: 0.12, posture: "fist" as const, others: 0.75 })),
      ...repeat(5, () => ({ ratio: 0.8 })), // fist release debounce
      { ratio: 0.12 },
      ...repeat(3, () => ({ ratio: 0.8 })),
    ]);
    expect(types(events)).toEqual(["clutch.start", "clutch.end"]);
  });
});

describe("long pinch (hold)", () => {
  it("hold then steer: one hold at 800 ms, then drag updates and a drag end", () => {
    const events = run([
      ...repeat(28, () => ({ ratio: 0.12, position: at(0.5) })), // about 930 ms still
      ...repeat(10, (i) => ({ ratio: 0.12, position: at(0.5 + i * 0.01) })), // steer right
      ...repeat(3, () => ({ ratio: 0.8 })),
    ]);
    const t = types(events);
    expect(t.filter((x) => x === "pinch.hold")).toHaveLength(1);
    const hold = events.find((e) => e.type === "pinch.hold");
    // The pinch starts when the fingertips first touch; the hold fires 800 ms after that.
    expect(hold && hold.ts - 1000).toBeGreaterThanOrEqual(800);
    expect(hold && hold.ts - 1000).toBeLessThan(800 + 2 * STEP);
    const afterHold = t.slice(t.indexOf("pinch.hold") + 1);
    expect(afterHold.filter((x) => x === "pinch.drag.update").length).toBeGreaterThan(5);
    expect(afterHold.at(-1)).toBe("pinch.drag.end");
    expect(t).not.toContain("pinch.tap");
  });

  it("a moving pinch never holds", () => {
    const events = run([
      ...repeat(30, (i) => ({ ratio: 0.12, position: at(0.3 + i * 0.006) })), // steady move for 1 s
      ...repeat(3, () => ({ ratio: 0.8 })),
    ]);
    expect(types(events)).not.toContain("pinch.hold");
  });

  it("a pinch that moved and then stops does not hold later", () => {
    const events = run([
      ...repeat(5, (i) => ({ ratio: 0.12, position: at(0.3 + i * 0.01) })),
      ...repeat(30, () => ({ ratio: 0.12, position: at(0.34) })),
    ]);
    expect(types(events)).not.toContain("pinch.hold");
  });

  it("a short tap never holds", () => {
    const events = run([...repeat(6, () => ({ ratio: 0.12 })), ...repeat(3, () => ({ ratio: 0.8 }))]);
    expect(types(events)).toEqual(["pinch.tap"]);
  });
});

describe("tracking loss (hand sweeping fast or passing over the face)", () => {
  it("a pinch that tracking loses mid-sweep is not a tap", () => {
    // Recorded clip: the fingertips touch, the hand starts a fast sweep across the face and is lost for 300 ms+.
    const events = run([...repeat(4, () => ({ ratio: 0.12 })), ...repeat(15, () => null)]);
    expect(types(events)).not.toContain("pinch.tap");
  });

  it("a drag survives a short loss and carries on from where the hand reappears", () => {
    const events = run([
      ...repeat(12, (i) => ({ ratio: 0.12, position: at(0.3 + i * 0.01) })),
      ...repeat(4, () => null), // 133 ms lost
      ...repeat(6, (i) => ({ ratio: 0.12, position: at(0.5 + i * 0.01) })),
      ...repeat(3, () => ({ ratio: 0.8 })),
    ]);
    const t = types(events);
    expect(t.filter((x) => x === "pinch.drag.start")).toHaveLength(1);
    expect(t.filter((x) => x === "pinch.drag.end")).toHaveLength(1);
    expect(t.at(-1)).toBe("pinch.drag.end");
    // The movement during the loss arrives as one update when the hand is seen again.
    const updates = events.filter(
      (e): e is Extract<GestureEvent, { type: "pinch.drag.update" }> => e.type === "pinch.drag.update",
    );
    expect(Math.max(...updates.map((e) => e.delta[0]))).toBeGreaterThan(0.05);
  });

  it("a drag lost for longer than the grace period ends", () => {
    const events = run([
      ...repeat(12, (i) => ({ ratio: 0.12, position: at(0.3 + i * 0.01) })),
      ...repeat(12, () => null), // 400 ms lost
    ]);
    expect(types(events).at(-1)).toBe("pinch.drag.end");
  });

  it("a short pinch whose release happened during a loss is not a tap either", () => {
    const events = run([
      ...repeat(4, () => ({ ratio: 0.12 })),
      ...repeat(3, () => null),
      ...repeat(3, () => ({ ratio: 0.8 })),
    ]);
    expect(events).toEqual([]);
  });
});

describe("engagement gating", () => {
  it("pinch before engaging is ignored", () => {
    const events = run([...repeat(6, () => ({ ratio: 0.1 })), ...repeat(3, () => ({ ratio: 0.8 }))], {
      engaged: false,
    });
    expect(events).toEqual([]);
  });

  it("a pinch that began before engaging stays ignored after engaging", () => {
    const m = new HandMachine("Right");
    run(
      repeat(5, () => ({ ratio: 0.1 })),
      { engaged: false },
      m,
    );
    const later = run(
      [...repeat(10, () => ({ ratio: 0.1 })), ...repeat(3, () => ({ ratio: 0.8 }))],
      engaged,
      m,
    );
    expect(types(later).filter((t) => t.startsWith("pinch"))).toEqual([]);
  });
});

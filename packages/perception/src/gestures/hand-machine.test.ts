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
      s === null ? null : { ts, ratio: 1, posture: "other", position: [0.5, 0.5], confidence: 0.9, ...s };
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
      ...repeat(30, (i) => ({ ratio: i % 2 ? 0.27 : 0.33 })),
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
});

describe("tap and drag", () => {
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

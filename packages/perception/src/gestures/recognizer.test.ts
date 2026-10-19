import type { GestureEvent, HeadPose, TrackedHand, TrackingFrame } from "@aex/protocol";
import { describe, expect, it } from "vitest";
import { loadFixture } from "../testing/fixtures.ts";
import { DEFAULT_GESTURES } from "./config.ts";
import { pinchRatio, posture } from "./features.ts";
import { countReversals } from "./head-machine.ts";
import { GestureRecognizer } from "./recognizer.ts";

const STEP = 1000 / 30;
const P = DEFAULT_GESTURES.pinch;

// Template hands taken from the recorded footage, so synthetic sequences use real landmark geometry.
function template(clip: Parameters<typeof loadFixture>[0], test: (h: TrackedHand) => boolean): TrackedHand {
  for (const f of loadFixture(clip)) for (const h of f.hands) if (test(h)) return h;
  throw new Error(`no matching hand in ${clip}`);
}
const openRight = template("open-palm", (h) => h.handedness === "Right" && posture(h) === "open-palm");
const isOkPinch = (side: string) => (h: TrackedHand) =>
  h.handedness === side && pinchRatio(h) < P.press * 0.8 && posture(h) !== "fist";
const pinchLeft = template("two-hands", isOkPinch("Left"));
const pinchRight = template("two-hands", isOkPinch("Right"));
const neutralRight = template(
  "two-hands",
  (h) => h.handedness === "Right" && posture(h) === "other" && pinchRatio(h) > P.release * 1.5,
);

/** Moves a hand in image space (dx, dy in raw, unmirrored image coordinates). */
const shift = (h: TrackedHand, dx: number, dy = 0): TrackedHand => ({
  ...h,
  image: h.image.map(([x, y, z]) => [x + dx, y + dy, z]),
});

type Step = { hands?: TrackedHand[]; head?: HeadPose };
function play(steps: Step[], recognizer = new GestureRecognizer()): GestureEvent[] {
  const events: GestureEvent[] = [];
  steps.forEach((s, i) => {
    const ts = 1_000_000 + i * STEP;
    const frame: TrackingFrame = {
      seq: i,
      captureTs: ts,
      inferenceDoneTs: ts + 10,
      backend: "CPU",
      hands: s.hands ?? [],
      ...(s.head ? { face: { landmarks: [], blendshapes: {}, headPose: s.head } } : {}),
    };
    events.push(...recognizer.process(frame));
  });
  return events;
}
const repeat = (n: number, step: Step | ((i: number) => Step)): Step[] =>
  Array.from({ length: n }, (_, i) => (typeof step === "function" ? step(i) : step));
const types = (events: GestureEvent[]) => events.map((e) => e.type);
const engageSteps = repeat(12, { hands: [openRight] }); // 400 ms of open palm

describe("engagement (spec: gestures produce commands only while engaged)", () => {
  it("pinch before engaging is ignored", () => {
    const events = play([...repeat(6, { hands: [pinchRight] }), ...repeat(4, { hands: [neutralRight] })]);
    expect(events).toEqual([]);
  });

  it("open palm for 300 ms engages, and later pinches emit commands", () => {
    const events = play([
      ...engageSteps,
      ...repeat(4, { hands: [neutralRight] }),
      ...repeat(6, { hands: [pinchRight] }),
      ...repeat(4, { hands: [neutralRight] }),
    ]);
    expect(types(events)[0]).toBe("engaged");
    expect(types(events)).toContain("pinch.tap");
  });

  it("an open palm held for less than 300 ms does not engage", () => {
    expect(play([...repeat(7, { hands: [openRight] }), ...repeat(5, { hands: [neutralRight] })])).toEqual([]);
  });

  it("hands leaving for 1.5 s disengages", () => {
    const events = play([...engageSteps, ...repeat(50, {})]);
    expect(events.at(-1)).toMatchObject({ type: "disengaged", reason: "no-hands" });
  });

  it("10 s without a gesture disengages", () => {
    const events = play([...engageSteps, ...repeat(310, { hands: [neutralRight] })]);
    expect(events.at(-1)).toMatchObject({ type: "disengaged", reason: "idle" });
  });
});

describe("two-hand pinch (spec: reports distance, midpoint and angle)", () => {
  it("spreading hands: distance increases and no single-hand drag updates are emitted", () => {
    const events = play([
      ...engageSteps,
      ...repeat(20, (i) => ({ hands: [shift(pinchLeft, 0.004 * i), shift(pinchRight, -0.004 * i)] })),
      ...repeat(5, { hands: [neutralRight] }),
    ]);
    const t = types(events);
    const start = t.indexOf("twohand.start");
    const end = t.indexOf("twohand.end");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const between = events.slice(start, end + 1);
    expect(between.filter((e) => e.type === "pinch.drag.update")).toEqual([]);
    const distances = between
      .filter((e): e is Extract<GestureEvent, { type: "twohand.update" }> => e.type === "twohand.update")
      .map((e) => e.distance);
    expect(distances.length).toBeGreaterThan(5);
    expect(distances.at(-1) ?? 0).toBeGreaterThan(distances[0] ?? 0);
  });

  it("the recorded two-hands clip produces two-hand gestures once engaged", () => {
    const recognizer = new GestureRecognizer();
    const events = [...play(engageSteps, recognizer)];
    for (const frame of loadFixture("two-hands")) {
      events.push(...recognizer.process({ ...frame, captureTs: frame.captureTs + 2_000_000_000 }));
    }
    expect(types(events)).toContain("twohand.start");
    expect(types(events)).toContain("clutch.start"); // the clip also has fists
  });
});

describe("head gestures (spec: nod and shake are recognised)", () => {
  const still = { yaw: 0, pitch: 0, roll: 0 };
  const withHead = (head: HeadPose): Step => ({ hands: [neutralRight], head });

  it("nod: down 12, up 12, down again within 1 s emits one nod", () => {
    const pitches = [0, -4, -8, -12, -8, -4, 0, -4, -8, -12, -12, -12];
    const events = play([
      ...engageSteps,
      ...pitches.map((p) => withHead({ ...still, pitch: p })),
      ...repeat(20, withHead(still)),
    ]);
    expect(types(events).filter((t) => t === "head.nod")).toHaveLength(1);
    expect(types(events)).not.toContain("head.shake");
  });

  it("shake: left, right, left emits one shake", () => {
    const yaws = [0, 6, 12, 6, 0, -6, -12, -6, 0, 6, 12, 12];
    const events = play([
      ...engageSteps,
      ...yaws.map((y) => withHead({ ...still, yaw: y })),
      ...repeat(20, withHead(still)),
    ]);
    expect(types(events).filter((t) => t === "head.shake")).toHaveLength(1);
  });

  it("looking around is not a shake: turning 20 degrees and staying there", () => {
    const yaws = [0, 5, 10, 15, 20, ...Array(20).fill(20)];
    const events = play([...engageSteps, ...yaws.map((y) => withHead({ ...still, yaw: y }))]);
    expect(types(events)).not.toContain("head.shake");
  });

  it("the recorded head-turn clip (turn right, left, look up) produces no shake", () => {
    const recognizer = new GestureRecognizer();
    play(engageSteps, recognizer);
    const events = loadFixture("head-turn").flatMap((frame) =>
      recognizer.process({ ...frame, hands: [neutralRight], captureTs: frame.captureTs + 2_000_000_000 }),
    );
    expect(types(events)).not.toContain("head.shake");
  });

  it("countReversals ignores swings smaller than the threshold", () => {
    const samples = [0, 5, 0, 5, 0, 5].map((value, ts) => ({ ts, value }));
    expect(countReversals(samples, 8).reversals).toBe(0);
  });
});

describe("event stream", () => {
  it("every event validates and timestamps never go backwards", async () => {
    const { GestureEvent } = await import("@aex/protocol");
    const recognizer = new GestureRecognizer();
    const events = [...play(engageSteps, recognizer)];
    // Rebase each recorded clip so it starts right after the previous one.
    let lastTs = 1_000_000 + engageSteps.length * STEP;
    for (const clip of ["two-hands", "one-hand-pinch", "open-palm"] as const) {
      const frames = loadFixture(clip);
      const offset = lastTs + STEP - (frames[0]?.captureTs ?? 0);
      for (const f of frames) events.push(...recognizer.process({ ...f, captureTs: f.captureTs + offset }));
      lastTs = (frames.at(-1)?.captureTs ?? 0) + offset;
    }
    expect(events.length).toBeGreaterThan(10);
    for (const e of events) expect(GestureEvent.safeParse(e).success).toBe(true);
    for (let i = 1; i < events.length; i++)
      expect(events[i]?.ts ?? 0).toBeGreaterThanOrEqual(events[i - 1]?.ts ?? 0);
  });
});

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

// A left hand is the right one mirrored: the posture checks are symmetric.
const mirrorToLeft = (h: TrackedHand): TrackedHand => ({
  ...h,
  handedness: "Left",
  image: h.image.map(([x, y, z]) => [1 - x, y, z]),
  world: h.world.map(([x, y, z]) => [-x, y, z]),
});
const openLeft = mirrorToLeft(openRight);
const fistRight = template("two-hands", (h) => h.handedness === "Right" && posture(h) === "fist");
const fistLeft = mirrorToLeft(fistRight);
const neutralLeft = mirrorToLeft(neutralRight);

describe("stop (spec: both fists, then both hands opened, stop the agents)", () => {
  const fists = (n: number) => repeat(n, { hands: [fistLeft, fistRight] });
  const palms = (n: number) => repeat(n, { hands: [openLeft, openRight] });
  const stops = (events: GestureEvent[]) => events.filter((e) => e.type === "hands.stop");

  it("the templates have the postures they are named for", () => {
    expect(posture(openLeft)).toBe("open-palm");
    expect(posture(fistLeft)).toBe("fist");
    expect(posture(fistRight)).toBe("fist");
  });

  it("fists held for 250 ms then both hands opened fire one stop", () => {
    const events = play([...engageSteps, ...fists(10), ...palms(30)]);
    expect(stops(events)).toHaveLength(1);
  });

  it("open palms alone never stop, however long they are held", () => {
    expect(stops(play([...engageSteps, ...palms(90)]))).toEqual([]);
  });

  it("fists held too briefly, one fist only, or opening too late do not stop", () => {
    expect(stops(play([...engageSteps, ...fists(5), ...palms(10)]))).toEqual([]); // 167 ms of fists
    expect(
      stops(play([...engageSteps, ...repeat(12, { hands: [openLeft, fistRight] }), ...palms(10)])),
    ).toEqual([]);
    // Hands relaxed for 1.2 s between the fists and the palms.
    const late = play([
      ...engageSteps,
      ...fists(10),
      ...repeat(36, { hands: [neutralLeft, neutralRight] }),
      ...palms(10),
    ]);
    expect(stops(late)).toEqual([]);
  });

  it("is armed while both fists are held, so the HUD can say to open the hands", () => {
    const recognizer = new GestureRecognizer();
    play([...engageSteps, ...fists(10)], recognizer);
    expect(recognizer.state.stopArmed).toBe(true);
    play(palms(3), recognizer);
    expect(recognizer.state.stopArmed).toBe(false);
  });

  it("does nothing while not engaged", () => {
    const recognizer = new GestureRecognizer({
      ...DEFAULT_GESTURES,
      engage: { ...DEFAULT_GESTURES.engage, openPalmMs: 60_000 },
    });
    expect(stops(play([...fists(10), ...palms(10)], recognizer))).toEqual([]);
  });
});

describe("independent hands (spec: two pinches are one gesture only when they start together)", () => {
  const twoHandStarts = (events: GestureEvent[]) => events.filter((e) => e.type === "twohand.start");

  it("a long pinch on one hand keeps its ring: the other hand's pinch is its own tap", () => {
    const events = play([
      ...engageSteps,
      ...repeat(4, { hands: [neutralLeft, neutralRight] }),
      ...repeat(30, { hands: [neutralLeft, pinchRight] }), // right holds (long pinch at 800 ms)
      ...repeat(6, { hands: [pinchLeft, pinchRight] }), // left pinches while the right still holds
      ...repeat(4, { hands: [neutralLeft, pinchRight] }), // left lets go
    ]);
    expect(events).toContainEqual(expect.objectContaining({ type: "pinch.hold", hand: "Right" }));
    expect(twoHandStarts(events)).toEqual([]);
    expect(events).toContainEqual(expect.objectContaining({ type: "pinch.tap", hand: "Left" }));
  });

  it("a hand already dragging keeps its drag while the other hand taps", () => {
    const events = play([
      ...engageSteps,
      ...repeat(4, { hands: [neutralLeft, neutralRight] }),
      ...repeat(15, (i) => ({ hands: [neutralLeft, shift(pinchRight, -0.006 * i)] })), // right drags
      ...repeat(6, (i) => ({ hands: [pinchLeft, shift(pinchRight, -0.09 - 0.006 * i)] })),
      ...repeat(4, (i) => ({ hands: [neutralLeft, shift(pinchRight, -0.126 - 0.006 * i)] })),
    ]);
    expect(twoHandStarts(events)).toEqual([]);
    expect(events).toContainEqual(expect.objectContaining({ type: "pinch.tap", hand: "Left" }));
    const rightUpdates = events.filter((e) => e.type === "pinch.drag.update" && e.hand === "Right");
    expect(rightUpdates.length).toBeGreaterThan(15);
  });

  it("one hand pinching still, then the other: still a two-hand pinch", () => {
    const events = play([
      ...engageSteps,
      ...repeat(4, { hands: [neutralLeft, neutralRight] }),
      ...repeat(12, { hands: [neutralLeft, pinchRight] }), // 400 ms, before a long pinch
      ...repeat(10, { hands: [pinchLeft, pinchRight] }),
    ]);
    expect(twoHandStarts(events)).toHaveLength(1);
  });
});

describe("fist drag (spec: a moving fist is a fist drag)", () => {
  const fistDrags = (events: GestureEvent[]) => events.filter((e) => e.type.startsWith("fist.drag."));
  const still = (hand: TrackedHand, n: number): Step[] => repeat(n, { hands: [neutralLeft, hand] });
  const toTheRight = (n: number, perFrame: number): Step[] =>
    // Image x is unmirrored, so a hand moving left in the image moves right on screen.
    repeat(n, (i) => ({ hands: [neutralLeft, shift(fistRight, -perFrame * (i + 1))] }));
  const sumX = (events: GestureEvent[]) =>
    events.reduce((sum, e) => (e.type === "fist.drag.update" ? sum + e.delta[0] : sum), 0);

  it("a fist closed at rest, then moved 10%, starts, updates by 10% in total and ends; nothing else", () => {
    const events = play([
      ...engageSteps,
      ...still(fistRight, 8),
      ...toTheRight(10, 0.01),
      ...still(neutralRight, 6),
    ]);
    expect(types(fistDrags(events))).toEqual([
      "fist.drag.start",
      ...Array(events.filter((e) => e.type === "fist.drag.update").length).fill("fist.drag.update"),
      "fist.drag.end",
    ]);
    expect(events.filter((e) => e.type === "fist.drag.update").length).toBeGreaterThanOrEqual(8);
    expect(sumX(events)).toBeCloseTo(0.1, 2);
    expect(events).toContainEqual(expect.objectContaining({ type: "clutch.start", hand: "Right" }));
    expect(events.filter((e) => e.type.startsWith("pinch."))).toEqual([]);
  });

  it("starts where the fist closed, so the movement before the threshold is not lost", () => {
    const events = play([...engageSteps, ...still(fistRight, 8), ...toTheRight(10, 0.01)]);
    const start = events.find((e) => e.type === "fist.drag.start");
    const clutch = events.find((e) => e.type === "clutch.start");
    expect(start).toBeDefined();
    expect(clutch).toBeDefined();
    // The fist formed at rest, so the start sits at the resting palm (the first update carries the rest).
    const firstUpdate = events.find((e) => e.type === "fist.drag.update");
    if (start?.type !== "fist.drag.start" || firstUpdate?.type !== "fist.drag.update")
      throw new Error("no drag");
    expect(firstUpdate.position[0] - start.position[0]).toBeCloseTo(firstUpdate.delta[0], 9);
    expect(firstUpdate.delta[0]).toBeGreaterThanOrEqual(0.03 - 1e-9);
  });

  it("a fist that stays closed and still is a clutch and no drag", () => {
    const events = play([...engageSteps, ...still(fistRight, 40), ...still(neutralRight, 6)]);
    expect(types(events)).toContain("clutch.start");
    expect(fistDrags(events)).toEqual([]);
  });

  it("a wobble of 1% is not a drag", () => {
    const events = play([
      ...engageSteps,
      ...still(fistRight, 8),
      ...repeat(20, (i) => ({ hands: [neutralLeft, shift(fistRight, i % 2 ? -0.01 : 0)] })),
    ]);
    expect(fistDrags(events)).toEqual([]);
  });

  it("opening the hand ends the drag at the first frame that is no longer a fist, and the opening adds no update", () => {
    const events = play([
      ...engageSteps,
      ...still(fistRight, 8),
      ...toTheRight(10, 0.01),
      // The hand opens while it moves on: these frames must not move the view.
      ...repeat(6, (i) => ({ hands: [neutralLeft, shift(neutralRight, -0.1 - 0.02 * (i + 1))] })),
    ]);
    const stream = types(events);
    const end = stream.indexOf("fist.drag.end");
    expect(stream.filter((t) => t === "fist.drag.end")).toHaveLength(1);
    expect(stream.slice(end)).not.toContain("fist.drag.update");
    expect(stream.indexOf("clutch.end")).toBeGreaterThan(end); // the clutch ends after its own debounce
    expect(sumX(events)).toBeCloseTo(0.1, 2);
  });

  it("a fist closed while the hand was dragging is only a clutch, however far it moves", () => {
    const events = play([
      ...engageSteps,
      ...repeat(4, { hands: [neutralLeft, neutralRight] }),
      ...repeat(15, (i) => ({ hands: [neutralLeft, shift(pinchRight, -0.006 * i)] })), // a pinch drag
      ...repeat(5, { hands: [neutralLeft, shift(fistRight, -0.09)] }), // closes into a fist
      ...repeat(20, (i) => ({ hands: [neutralLeft, shift(fistRight, -0.09 - 0.01 * (i + 1))] })), // moves 20%
    ]);
    expect(types(events)).toContain("pinch.drag.start");
    expect(fistDrags(events)).toEqual([]);
  });

  it("tracking lost for 200 ms keeps the drag, lost for 400 ms ends it", () => {
    const lost = (n: number): Step[] => repeat(n, { hands: [neutralLeft] });
    const keep = play([
      ...engageSteps,
      ...still(fistRight, 8),
      ...toTheRight(10, 0.01),
      ...lost(6),
      ...toTheRight(3, 0.01),
    ]);
    expect(types(keep)).not.toContain("fist.drag.end");
    const end = play([...engageSteps, ...still(fistRight, 8), ...toTheRight(10, 0.01), ...lost(12)]);
    expect(types(end).filter((t) => t === "fist.drag.end")).toHaveLength(1);
  });

  it("the other hand closing into a fist ends the drag, and the stop still fires", () => {
    const events = play([
      ...engageSteps,
      ...still(fistRight, 8),
      ...toTheRight(10, 0.01),
      ...repeat(10, { hands: [fistLeft, shift(fistRight, -0.1)] }),
      ...repeat(10, (i) => ({ hands: [fistLeft, shift(fistRight, -0.1 - 0.01 * (i + 1))] })), // keeps moving
      ...repeat(20, { hands: [openLeft, openRight] }),
    ]);
    const stream = types(events);
    expect(stream.filter((t) => t === "fist.drag.end")).toHaveLength(1);
    // Only the first 10% moved the view: the fist kept moving another 10% while both hands were fists.
    expect(sumX(events)).toBeCloseTo(0.1, 2);
    expect(stream).toContain("hands.stop");
  });

  it("a fist closed before engaging is only a clutch, even after the other hand engages", () => {
    const events = play([
      ...repeat(12, { hands: [openLeft, fistRight] }), // the left palm engages while the right fist is already closed
      ...toTheRight(10, 0.01).map((step) => ({ hands: [openLeft, ...(step.hands ?? []).slice(1)] })),
    ]);
    expect(types(events)).toContain("engaged");
    expect(fistDrags(events)).toEqual([]);
  });

  it("does nothing while not engaged", () => {
    const events = play([...still(fistRight, 8), ...toTheRight(10, 0.01)]);
    expect(events).toEqual([]);
  });
});

describe("recorded footage", () => {
  it("the pinch in the one-hand-pinch clip is a tap, so it selects what it points at", () => {
    const events = new GestureRecognizer();
    const out = loadFixture("one-hand-pinch").flatMap((f) => events.process(f));
    expect(types(out).filter((t) => t.startsWith("pinch."))).toEqual(["pinch.tap"]);
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

import type { PinchReading, RecognizerState } from "@hai/perception";
import type { GestureEvent, Hand, TrackingFrame } from "@hai/protocol";
import { LatencyTracker } from "../viewer/latency.ts";

/** How far back detection rates and the frame strips look. */
export const DETECTION_WINDOW_MS = 5000;
/** A hand or face missing for less than this between two detections was dropped by tracking, not taken away. */
export const DROPOUT_MAX_MS = 500;
/** A frame is drawn up to the next one, but never longer than this, so a stall in the camera feed shows as a gap. */
const FRAME_MAX_MS = 100;

type HandState = "none" | "seen" | "pinched";

/** One tracked frame, as the detection strips draw it. */
export interface DetectionSample {
  /** Capture time, epoch ms. */
  ts: number;
  left: HandState;
  right: HandState;
  /** Null when face tracking did not run on this frame (it runs on alternate frames on slow machines). */
  face: boolean | null;
}

export interface DetectionSnapshot {
  /** Frames in the window, oldest first. */
  samples: DetectionSample[];
  /** Share of frames in the window each was found in, 0..1, or null before any frame. */
  rates: { left: number | null; right: number | null; face: number | null };
  pinch: Partial<Record<Hand, PinchReading>>;
  counts: { taps: number; drags: number; twoHand: number };
  /** Capture to the frame's gestures reaching the page, p90 over the last 3 s. */
  cameraToGestureP90: number | null;
  /** Capture time of the newest frame, epoch ms (the strips end here). */
  latestTs: number | null;
}

const EMPTY: DetectionSnapshot = {
  samples: [],
  rates: { left: null, right: null, face: null },
  pinch: {},
  counts: { taps: 0, drags: 0, twoHand: 0 },
  cameraToGestureP90: null,
  latestTs: null,
};

export type Track = "left" | "right" | "face";

export interface StripSegment {
  from: number;
  to: number;
  kind: "seen" | "pinched" | "dropped";
}

function stateOf(sample: DetectionSample, track: Track): HandState | null {
  if (track !== "face") return sample[track];
  if (sample.face === null) return null;
  return sample.face ? "seen" : "none";
}

/**
 * What the detection strip draws for one track, as time segments: found, pinching, or dropped. A gap shorter than
 * DROPOUT_MAX_MS between two detections is a dropout (a tracking failure); a longer one, or one at either end of the
 * window, is the hand being out of view and is left blank. Frames where face tracking did not run keep the last
 * result.
 */
export function stripSegments(samples: DetectionSample[], track: Track): StripSegment[] {
  const segments: StripSegment[] = [];
  const add = (from: number, to: number, kind: StripSegment["kind"]) => {
    const last = segments.at(-1);
    if (last && last.kind === kind && from - last.to < 1) last.to = to;
    else segments.push({ from, to, kind });
  };
  let held: HandState | null = null;
  let gapStart: number | null = null;
  samples.forEach((sample, i) => {
    const state = stateOf(sample, track) ?? held;
    held = state;
    const next = samples[i + 1];
    const end = next ? Math.min(next.ts, sample.ts + FRAME_MAX_MS) : sample.ts + 1000 / 30;
    if (state === null) return;
    if (state === "none") {
      gapStart ??= sample.ts;
      return;
    }
    if (gapStart !== null) {
      if (sample.ts - gapStart < DROPOUT_MAX_MS && segments.length > 0) add(gapStart, sample.ts, "dropped");
      gapStart = null;
    }
    add(sample.ts, end, state);
  });
  return segments;
}

function handSample(hand: Hand, frame: TrackingFrame, state: RecognizerState): HandState {
  if (!frame.hands.some((h) => h.handedness === hand)) return "none";
  const display = state.hands[hand];
  return display === "pinch" || display === "drag" ? "pinched" : "seen";
}

function share<T>(items: T[], counts: (item: T) => boolean | null): number | null {
  let total = 0;
  let hits = 0;
  for (const item of items) {
    const hit = counts(item);
    if (hit === null) continue;
    total += 1;
    if (hit) hits += 1;
  }
  return total === 0 ? null : hits / total;
}

/**
 * Tracking reliability and response for the Detection card: how often each hand and the face are found, what the
 * pinch measurement reads, how many pinches were recognised, and how long a camera frame takes to become gestures.
 * Fed once per tracked frame; a tiny external store so only the Detection card re-renders.
 */
export class DetectionStore {
  private samples: DetectionSample[] = [];
  private counts = { ...EMPTY.counts };
  private readonly response = new LatencyTracker(3000);
  private snapshot = EMPTY;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly now: () => number = () => performance.timeOrigin + performance.now()) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): DetectionSnapshot => this.snapshot;

  push(frame: TrackingFrame, faceRan: boolean, state: RecognizerState, events: GestureEvent[]): void {
    const now = this.now();
    this.response.add(now - frame.captureTs, now);
    this.samples.push({
      ts: frame.captureTs,
      left: handSample("Left", frame, state),
      right: handSample("Right", frame, state),
      face: faceRan ? Boolean(frame.face) : null,
    });
    const since = frame.captureTs - DETECTION_WINDOW_MS;
    while ((this.samples[0]?.ts ?? since) < since) this.samples.shift();
    for (const event of events) {
      if (event.type === "pinch.tap") this.counts.taps += 1;
      else if (event.type === "pinch.drag.start") this.counts.drags += 1;
      else if (event.type === "twohand.start") this.counts.twoHand += 1;
    }
    this.snapshot = {
      samples: [...this.samples],
      rates: {
        left: share(this.samples, (s) => s.left !== "none"),
        right: share(this.samples, (s) => s.right !== "none"),
        face: share(this.samples, (s) => s.face),
      },
      pinch: state.pinch,
      counts: { ...this.counts },
      cameraToGestureP90: this.response.p90(now),
      latestTs: frame.captureTs,
    };
    for (const listener of this.listeners) listener();
  }

  reset(): void {
    this.samples = [];
    this.counts = { ...EMPTY.counts };
    this.response.clear();
    this.snapshot = EMPTY;
    for (const listener of this.listeners) listener();
  }
}

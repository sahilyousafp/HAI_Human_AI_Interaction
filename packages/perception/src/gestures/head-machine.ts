import type { GestureEvent, HeadPose } from "@aex/protocol";
import { DEFAULT_GESTURES, type GestureConfig } from "./config.ts";

interface Sample {
  ts: number;
  value: number;
}

/**
 * Counts direction reversals whose swing exceeds `threshold` (a zigzag filter): a reversal is confirmed once
 * the signal has moved back from its last extreme by more than the threshold. Returns the count and the largest swing.
 */
export function countReversals(samples: Sample[], threshold: number): { reversals: number; swing: number } {
  let reversals = 0;
  let swing = 0;
  let direction = 0; // +1 rising, -1 falling, 0 unknown
  let extreme = samples[0]?.value ?? 0;
  const anchor = extreme;
  for (const { value } of samples) {
    if (direction >= 0 && value > extreme) extreme = value;
    if (direction <= 0 && value < extreme) extreme = value;
    if (direction === 0) {
      if (Math.abs(value - anchor) > threshold) {
        direction = value > anchor ? 1 : -1;
        extreme = value;
      }
      continue;
    }
    if (
      (direction === 1 && extreme - value > threshold) ||
      (direction === -1 && value - extreme > threshold)
    ) {
      reversals += 1;
      swing = Math.max(swing, Math.abs(extreme - value));
      direction = -direction;
      extreme = value;
    }
  }
  return { reversals, swing };
}

/** Recognises a nod (pitch) or a shake (yaw): repeated reversals inside a short window. */
export class HeadMachine {
  private pitch: Sample[] = [];
  private yaw: Sample[] = [];
  private cooldownUntil = 0;

  constructor(private readonly config: GestureConfig = DEFAULT_GESTURES) {}

  update(pose: HeadPose | undefined, ts: number, engaged: boolean): GestureEvent[] {
    if (!pose) return [];
    const h = this.config.head;
    if (ts < this.cooldownUntil) return [];
    this.pitch.push({ ts, value: pose.pitch });
    this.yaw.push({ ts, value: pose.yaw });
    const since = ts - h.windowMs;
    this.pitch = this.pitch.filter((s) => s.ts >= since);
    this.yaw = this.yaw.filter((s) => s.ts >= since);

    const nod = countReversals(this.pitch, h.nodDegrees);
    const shake = countReversals(this.yaw, h.shakeDegrees);
    let event: GestureEvent | null = null;
    if (nod.reversals >= h.reversals && nod.reversals >= shake.reversals) {
      event = { type: "head.nod", ts, confidence: Math.min(1, nod.swing / (2 * h.nodDegrees)) };
    } else if (shake.reversals >= h.reversals) {
      event = { type: "head.shake", ts, confidence: Math.min(1, shake.swing / (2 * h.shakeDegrees)) };
    }
    if (!event) return [];
    // One gesture fires once: clear the window and pause briefly.
    this.pitch = [];
    this.yaw = [];
    this.cooldownUntil = ts + h.cooldownMs;
    return engaged ? [event] : [];
  }
}

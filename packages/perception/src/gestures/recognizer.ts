import type { GestureEvent, Hand, Point2, TrackingFrame } from "@aex/protocol";
import { DEFAULT_GESTURES, type GestureConfig } from "./config.ts";
import { DEFAULT_ASPECT, othersExtension, pinchPoint, pinchRatio, posture } from "./features.ts";
import { type HandDisplay, HandMachine, type HandObservation } from "./hand-machine.ts";
import { HeadMachine } from "./head-machine.ts";

/** What the recogniser measured on a hand this frame, for the HUD's pinch meter. */
export interface PinchReading {
  /** Thumb-index distance / hand size, image space. */
  ratio: number;
  /** Middle, ring and little fingers open enough for a pinch to start (`pinch.othersMin`). */
  othersOpen: boolean;
}

export interface RecognizerState {
  engaged: boolean;
  hands: Partial<Record<Hand, HandDisplay>>;
  pinch: Partial<Record<Hand, PinchReading>>;
  twoHand: boolean;
  /** Most recent head gesture, for the HUD. */
  lastHead: { type: "head.nod" | "head.shake"; ts: number } | null;
}

/**
 * Turns smoothed tracking frames into one ordered gesture event stream:
 * engagement gating, per-hand pinch / tap / drag / clutch, two-hand pinch, and head nod / shake.
 * Pure and deterministic: the same frames always produce the same events.
 */
export class GestureRecognizer {
  private readonly machines: Record<Hand, HandMachine>;
  private readonly head: HeadMachine;
  private engaged = false;
  private openSince: number | null = null;
  private lastHandTs = 0;
  private lastActivityTs = 0;
  private twoHandActive = false;
  private lastTwoHand: { distance: number; midpoint: Point2; angle: number; confidence: number } | null =
    null;
  private lastHead: RecognizerState["lastHead"] = null;
  private readings: Partial<Record<Hand, PinchReading>> = {};
  /** Since when both palms are open, and whether this hold already stopped. */
  private palmsSince: number | null = null;
  private palmsFired = false;

  constructor(private readonly config: GestureConfig = DEFAULT_GESTURES) {
    this.machines = { Left: new HandMachine("Left", config), Right: new HandMachine("Right", config) };
    this.head = new HeadMachine(config);
  }

  get state(): RecognizerState {
    const hands: RecognizerState["hands"] = {};
    for (const hand of ["Left", "Right"] as const)
      if (this.readings[hand]) hands[hand] = this.machines[hand].display;
    return {
      engaged: this.engaged,
      hands,
      pinch: { ...this.readings },
      twoHand: this.twoHandActive,
      lastHead: this.lastHead,
    };
  }

  process(frame: TrackingFrame): GestureEvent[] {
    const ts = frame.captureTs;
    const aspect = frame.aspect ?? DEFAULT_ASPECT;
    const events: GestureEvent[] = [];
    const observations: Partial<Record<Hand, HandObservation>> = {};
    this.readings = {};
    for (const hand of frame.hands) {
      const obs: HandObservation = {
        ts,
        ratio: pinchRatio(hand, aspect),
        others: othersExtension(hand),
        posture: posture(hand, this.config),
        position: pinchPoint(hand),
        confidence: hand.score,
        aspect,
      };
      observations[hand.handedness] = obs;
      this.readings[hand.handedness] = {
        ratio: obs.ratio,
        othersOpen: obs.others >= this.config.pinch.othersMin,
      };
    }

    this.updateEngagement(ts, observations, events);

    const ctx = { engaged: this.engaged };
    for (const hand of ["Left", "Right"] as const) {
      events.push(...this.machines[hand].update(observations[hand] ?? null, ts, ctx));
    }
    this.updateTwoHand(ts, aspect, events);
    this.updatePalms(ts, observations, events);

    const headEvents = this.head.update(frame.face?.headPose, ts, this.engaged);
    for (const e of headEvents)
      if (e.type === "head.nod" || e.type === "head.shake") this.lastHead = { type: e.type, ts };
    events.push(...headEvents);

    if (events.some((e) => e.type !== "engaged" && e.type !== "disengaged")) this.lastActivityTs = ts;
    return events;
  }

  private updateEngagement(ts: number, obs: Partial<Record<Hand, HandObservation>>, events: GestureEvent[]) {
    const e = this.config.engage;
    const anyHand = Boolean(obs.Left || obs.Right);
    const openPalm = obs.Left?.posture === "open-palm" || obs.Right?.posture === "open-palm";
    if (anyHand) this.lastHandTs = ts;

    if (!this.engaged) {
      if (!openPalm) {
        this.openSince = null;
        return;
      }
      this.openSince ??= ts;
      if (ts - this.openSince >= e.openPalmMs) {
        this.engaged = true;
        this.lastActivityTs = ts;
        events.push({ type: "engaged", ts, confidence: 1 });
      }
      return;
    }

    if (openPalm) this.lastActivityTs = ts;
    let reason: "no-hands" | "idle" | null = null;
    if (ts - this.lastHandTs >= e.noHandsMs) reason = "no-hands";
    else if (ts - this.lastActivityTs >= e.idleMs) reason = "idle";
    if (!reason) return;

    // Close anything still open so consumers never see a dangling drag.
    this.endTwoHand(ts, events, false);
    for (const hand of ["Left", "Right"] as const) events.push(...this.machines[hand].cancel(ts));
    this.engaged = false;
    this.openSince = null;
    events.push({ type: "disengaged", ts, confidence: 1, reason });
  }

  /** Both open palms for `stop.palmsMs` while engaged: one stop per hold (lower a hand to stop again). */
  private updatePalms(ts: number, obs: Partial<Record<Hand, HandObservation>>, events: GestureEvent[]) {
    const both = this.engaged && obs.Left?.posture === "open-palm" && obs.Right?.posture === "open-palm";
    if (!both) {
      this.palmsSince = null;
      this.palmsFired = false;
      return;
    }
    this.palmsSince ??= ts;
    if (this.palmsFired || ts - this.palmsSince < this.config.stop.palmsMs) return;
    this.palmsFired = true;
    events.push({ type: "palms.stop", ts, confidence: 1 });
  }

  private updateTwoHand(ts: number, aspect: number, events: GestureEvent[]) {
    const { Left, Right } = this.machines;
    const both = this.engaged && Left.pinching && Right.pinching;
    if (!both) {
      if (this.twoHandActive) this.endTwoHand(ts, events, true);
      return;
    }
    const [a, b] = [Left.position, Right.position].sort((p, q) => p[0] - q[0]) as [Point2, Point2];
    const dx = b[0] - a[0];
    const dy = (b[1] - a[1]) / aspect;
    this.lastTwoHand = {
      distance: Math.hypot(dx, dy),
      midpoint: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
      confidence: 1,
    };
    if (!this.twoHandActive) {
      this.twoHandActive = true;
      events.push(...Left.suppress(ts), ...Right.suppress(ts));
      events.push({ type: "twohand.start", ts, hand: "both", ...this.lastTwoHand });
    } else {
      events.push({ type: "twohand.update", ts, hand: "both", ...this.lastTwoHand });
    }
  }

  private endTwoHand(ts: number, events: GestureEvent[], resume: boolean) {
    if (!this.twoHandActive || !this.lastTwoHand) return;
    this.twoHandActive = false;
    events.push({ type: "twohand.end", ts, hand: "both", ...this.lastTwoHand });
    if (resume) {
      this.machines.Left.resume(ts);
      this.machines.Right.resume(ts);
    }
  }
}

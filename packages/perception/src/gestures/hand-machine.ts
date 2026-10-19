import type { GestureEvent, Hand, Point2 } from "@aex/protocol";
import { DEFAULT_GESTURES, type GestureConfig } from "./config.ts";
import { DEFAULT_ASPECT, type Posture, screenDistance } from "./features.ts";

/** What the hand machine sees each frame; computed from landmarks by the recogniser. */
export interface HandObservation {
  ts: number;
  /** Thumb-index distance / hand size, image space. */
  ratio: number;
  /** Mean extension of the middle, ring and little fingers (see `othersExtension`). */
  others: number;
  posture: Posture;
  /** Pinch point, mirrored, normalised. */
  position: Point2;
  confidence: number;
  aspect?: number;
}

export interface HandContext {
  /** Commands may only be emitted while engaged. */
  engaged: boolean;
}

export type HandDisplay = "idle" | "open-palm" | "pinch" | "drag" | "clutch";

type Phase = "idle" | "candidate" | "pinching";

/**
 * Per-hand reducer for pinch (tap or drag) and the fist clutch.
 * - A pinch starts after the fingertips touch (ratio below `press`, other fingers not curled) for `minHoldMs`, and
 *   ends above `release` (hysteresis).
 * - Drag start is held back until the pinch outlasts a tap or moves; a short, still pinch is a tap.
 * - A fist (checked before pinch, since a fist also closes thumb and index) suspends all drag output.
 * - Only pinches that began while engaged emit anything ("pinch before engaging is ignored").
 * - Tracking often loses a hand for a few frames while it sweeps fast or passes over the face. A pinch survives a
 *   loss of up to `lostGraceMs` (a drag carries on from wherever the hand reappears), and a pinch interrupted by a
 *   loss is never a tap: the fingers were not seen opening.
 */
export class HandMachine {
  private phase: Phase = "idle";
  private candidateSince = 0;
  private startTs = 0;
  private startPos: Point2 = [0, 0];
  private lastPos: Point2 = [0, 0];
  private lastEmittedPos: Point2 = [0, 0];
  private maxMove = 0;
  private dragStarted = false;
  private valid = false;
  /** Resumed after a two-hand gesture: a quick release must not count as a tap. */
  private tapAllowed = true;
  private suppressed = false;
  private clutched = false;
  private fistSince: number | null = null;
  private notFistSince: number | null = null;
  private lastPosture: Posture = "other";
  private confidence = 1;
  private lostSince: number | null = null;

  constructor(
    readonly hand: Hand,
    private readonly config: GestureConfig = DEFAULT_GESTURES,
  ) {}

  /** In a pinch that began while engaged (used to detect two-hand pinches). */
  get pinching(): boolean {
    return this.phase === "pinching" && this.valid && !this.clutched;
  }

  get position(): Point2 {
    return this.lastPos;
  }

  get display(): HandDisplay {
    if (this.clutched) return "clutch";
    if (this.phase === "pinching") return this.dragStarted || this.suppressed ? "drag" : "pinch";
    return this.lastPosture === "open-palm" ? "open-palm" : "idle";
  }

  update(obs: HandObservation | null, ts: number, ctx: HandContext): GestureEvent[] {
    const events: GestureEvent[] = [];
    if (!obs) {
      if (this.phase === "pinching") {
        this.lostSince ??= ts;
        this.tapAllowed = false;
        if (ts - this.lostSince < this.config.pinch.lostGraceMs) return events;
      }
      this.lostSince = null;
      this.endPinch(ts, events);
      if (this.clutched) {
        this.clutched = false;
        if (ctx.engaged)
          events.push({ type: "clutch.end", ts, confidence: this.confidence, hand: this.hand });
      }
      this.fistSince = null;
      this.notFistSince = null;
      this.lastPosture = "other";
      return events;
    }
    this.lostSince = null;
    this.confidence = obs.confidence;
    this.lastPosture = obs.posture;

    if (obs.posture === "fist") {
      if (this.phase === "candidate") this.phase = "idle"; // the touch belonged to the fist forming
      this.notFistSince = null;
      this.fistSince ??= ts;
      if (!this.clutched && ts - this.fistSince >= this.config.clutch.debounceMs) {
        this.clutched = true;
        // End any drag so the resumed one starts fresh at the new position: no jump.
        this.endPinch(ts, events, { silent: !this.dragStarted });
        if (ctx.engaged)
          events.push({ type: "clutch.start", ts, confidence: obs.confidence, hand: this.hand });
      }
      return events; // fist frames never advance the pinch: a fist must not read as a pinch or a tap
    }

    this.fistSince = null;
    this.notFistSince ??= ts;
    if (this.clutched) {
      if (ts - this.notFistSince < this.config.clutch.debounceMs) return events;
      this.clutched = false;
      if (ctx.engaged) events.push({ type: "clutch.end", ts, confidence: obs.confidence, hand: this.hand });
    }

    this.advancePinch(obs, ts, ctx, events);
    return events;
  }

  /** Two-hand gesture took over: end any single-hand drag and stay quiet until resumed. */
  suppress(ts: number): GestureEvent[] {
    const events: GestureEvent[] = [];
    if (this.phase === "pinching" && this.valid && this.dragStarted && !this.suppressed) {
      events.push(this.event("pinch.drag.end", ts));
    }
    this.suppressed = true;
    this.dragStarted = false;
    return events;
  }

  /** Two-hand gesture ended while this hand still pinches: continue as a fresh drag from here. */
  resume(ts: number): void {
    this.suppressed = false;
    if (this.phase !== "pinching") return;
    this.startTs = ts;
    this.startPos = this.lastPos;
    this.lastEmittedPos = this.lastPos;
    this.maxMove = 0;
    this.dragStarted = false;
    this.tapAllowed = false;
  }

  /** Ends any pinch (e.g. on disengage), emitting drag end if a drag was running. */
  cancel(ts: number): GestureEvent[] {
    const events: GestureEvent[] = [];
    this.endPinch(ts, events, { silent: !this.dragStarted });
    return events;
  }

  private advancePinch(obs: HandObservation, ts: number, ctx: HandContext, events: GestureEvent[]) {
    const p = this.config.pinch;
    const aspect = obs.aspect ?? DEFAULT_ASPECT;
    const touching = obs.ratio < p.press && obs.others >= p.othersMin;
    switch (this.phase) {
      case "idle":
        if (touching) {
          this.phase = "candidate";
          this.candidateSince = ts;
        }
        return;
      case "candidate":
        if (!touching) {
          this.phase = "idle"; // a brief touch is not a pinch
          return;
        }
        if (ts - this.candidateSince < p.minHoldMs) return;
        this.phase = "pinching";
        this.startTs = this.candidateSince;
        this.startPos = obs.position;
        this.lastPos = obs.position;
        this.lastEmittedPos = obs.position;
        this.maxMove = 0;
        this.dragStarted = false;
        this.tapAllowed = true;
        this.valid = ctx.engaged;
        return;
      case "pinching": {
        if (obs.ratio > p.release) {
          this.endPinch(ts, events);
          return;
        }
        this.lastPos = obs.position;
        this.maxMove = Math.max(this.maxMove, screenDistance(this.startPos, obs.position, aspect));
        if (!this.valid || this.suppressed || !ctx.engaged) return;
        if (!this.dragStarted && (ts - this.startTs > p.tapMaxMs || this.maxMove >= p.tapMaxMove)) {
          this.dragStarted = true;
          events.push(this.event("pinch.drag.start", ts, this.startPos));
          this.lastEmittedPos = this.startPos;
        }
        if (this.dragStarted) events.push(this.dragUpdate(ts));
        return;
      }
    }
  }

  private endPinch(ts: number, events: GestureEvent[], opts: { silent?: boolean } = {}) {
    const wasPinching = this.phase === "pinching";
    this.phase = "idle";
    if (!wasPinching || !this.valid || this.suppressed || opts.silent) {
      this.dragStarted = false;
      this.suppressed = false;
      return;
    }
    const p = this.config.pinch;
    if (this.dragStarted) {
      events.push(this.event("pinch.drag.end", ts));
    } else if (this.tapAllowed && ts - this.startTs <= p.tapMaxMs && this.maxMove < p.tapMaxMove) {
      events.push(this.event("pinch.tap", ts, this.startPos));
    } else if (this.maxMove >= p.tapMaxMove) {
      // Short but moving: still a drag.
      events.push(this.event("pinch.drag.start", ts, this.startPos));
      this.lastEmittedPos = this.startPos;
      events.push(this.dragUpdate(ts));
      events.push(this.event("pinch.drag.end", ts));
    }
    this.dragStarted = false;
  }

  private dragUpdate(ts: number): GestureEvent {
    const delta: Point2 = [
      this.lastPos[0] - this.lastEmittedPos[0],
      this.lastPos[1] - this.lastEmittedPos[1],
    ];
    this.lastEmittedPos = this.lastPos;
    return {
      type: "pinch.drag.update",
      ts,
      confidence: this.confidence,
      hand: this.hand,
      position: this.lastPos,
      delta,
    };
  }

  private event(
    type: "pinch.tap" | "pinch.drag.start" | "pinch.drag.end",
    ts: number,
    position: Point2 = this.lastPos,
  ): GestureEvent {
    return { type, ts, confidence: this.confidence, hand: this.hand, position };
  }
}

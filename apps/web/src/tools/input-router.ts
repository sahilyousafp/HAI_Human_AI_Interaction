import {
  actionFor,
  DEFAULT_BINDINGS,
  type FeatureId,
  type GestureAction,
  type GestureBindings,
  type GestureEvent,
  type Hand,
  type Point2,
} from "@hai/protocol";
import type { Ring } from "./controller.ts";
import { HoldMachine, type HoldOutcome, RING_AFTER_MS } from "./hold.ts";

export type DragMode = "orbit" | "pan";

/** Where routed gestures go. Positions are the gesture's own (camera frame, mirrored like the preview). */
export interface RouterTargets {
  palette: {
    readonly isOpen: boolean;
    /** Opens a ring at the hand; `hidden` until `show` (a held pinch shows it only when silent or flicking). */
    open(position: Point2, ring: Ring, hand: Hand, hidden?: boolean): void;
    show?(): void;
    /** Width / height of the space hand positions are in. */
    aspect?(): number;
    steer(position: Point2): void;
    release(): void;
    cancel(): void;
  };
  tool: {
    tap(position: Point2, hand: Hand): void;
    /** True if the controller takes the drag (a press, a scroll or the active tool); otherwise it navigates. */
    dragStart(position: Point2, hand: Hand): boolean;
    drag(position: Point2, hand: Hand): void;
    dragEnd(position: Point2, hand: Hand): void;
    /** Drops a hand's drag (every hand's when none is given). */
    dragCancel(hand?: Hand): void;
    /** Yes to the tool's open question. */
    nod(): void;
    /** No to the open question, or cancel. */
    shake(): void;
    /** A fist closed or opened; `held` runs once it has been held (cancel back to Select by default). */
    clutch(closed: boolean, held?: () => void): void;
    /** Selects the element at a position, whatever the active tool. */
    select(position: Point2): void;
    undo(): void;
    redo(): void;
    cancel(): void;
  };
  /** The view navigation controller (orbit, zoom, pan); a one-hand drag orbits or pans. */
  navigation(event: GestureEvent, dragMode?: DragMode): void;
}

/** The agent's side of gestures: answer its only waiting approval card, stop it, or open its panel. */
export interface RouterAgent {
  /** Allows or denies the only waiting card; false if there is not exactly one. */
  answer(yes: boolean): boolean;
  stop(): void;
  ask(): void;
}

/**
 * Hold to talk, for a long pinch bound to `talk`: the app locks what is under the hand and listens while it is held.
 * The router tells it where the hand moves and how the hold ended; it tells the router when speech starts.
 */
export interface RouterTalk {
  /** The hold fired: lock the target and start listening. False if listening cannot start (the ring opens instead). */
  start(position: Point2, hand: Hand): boolean;
  /** The holding hand moved (it points while speaking). */
  move(position: Point2, hand: Hand): void;
  /** The hold ended: `send` what was said, or drop it. */
  end(hand: Hand, send: boolean): void;
  /** Calls `listener` when speech starts during a hold. Returns a function that stops calling it. */
  onSpeech(listener: (hand: Hand) => void): () => void;
}

/** How a held pinch ended, for the local counts in the Detection card. */
export type HoldReport = { outcome: HoldOutcome["kind"]; ring: Ring; spoke: boolean };

export interface RouterOptions {
  /** What each gesture does now (the user can change it in the settings). */
  bindings?: () => GestureBindings;
  agent?: RouterAgent;
  /** Whether a feature is switched on (Settings > Features); everything is on without it. */
  enabled?: (feature: FeatureId) => boolean;
  /** The ring a silent long pinch of a hand shows (by the dominant hand); the right hand's action ring without it. */
  ringOf?: (hand: Hand) => Ring;
  /** Hold to talk; without it a `talk` long pinch opens the hand's ring at once. */
  talk?: RouterTalk;
  /** Told how each held pinch ended. */
  onHold?: (report: HoldReport) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

type Owner = "palette" | "talk" | "tool" | "navigation" | "ignored";

const RINGS: Partial<Record<GestureAction, Ring>> = {
  "action-ring": "action",
  "reference-ring": "reference",
};

/**
 * Sends each gesture to exactly one place, through the gesture's binding for the hand that made it (what the user set
 * it to do), so navigation never needs to know about the palette or the tools. Both hands are equal pointers:
 * - a long pinch opens that hand's ring (the right hand's tools, the left hand's create tools by default); if that
 *   hand was orbiting, the orbit is ended first. While a ring is open it gets the drag of the hand that opened it;
 *   the other hand keeps tapping, pressing, scrolling and navigating. A long pinch while a tool holds something (an
 *   element being moved, the section plane) keeps holding it: holding still is not a request for a ring then;
 * - a drag goes to the controller if it takes it (a button press, a scroll, the active tool), else to navigation;
 * - a fist drag always goes to navigation, with the mode its hand's setting says (pan, orbit), unless that is nothing,
 *   another navigation is running (the other hand's drag, a two-hand pinch), a ring is open, or both hands are fists;
 *   it also drops the fist hold, so a moving fist never cancels;
 * - both hands closed into fists are the start of the stop gesture, so neither hand's fist action runs then;
 * - "yes" and "no" answer the agent's approval card when exactly one waits, else the tool's question.
 */
export class InputRouter {
  private readonly owners = new Map<Hand, Owner>();
  private paletteHand: Hand | null = null;
  private readonly fists = new Set<Hand>();
  /** Both hands were fists together: their fist actions stay off until both are open again. */
  private bothFists = false;
  private twoHand = false;
  /** The held pinch that is listening, if any (one at a time, like a ring). */
  private hold: { hand: Hand; machine: HoldMachine; ring: Ring; timer: unknown } | null = null;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(
    private readonly targets: RouterTargets,
    private readonly options: RouterOptions = {},
  ) {
    this.now = options.now ?? (() => performance.now());
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    options.talk?.onSpeech((hand) => this.speech(hand));
  }

  private get bindings(): GestureBindings {
    return this.options.bindings?.() ?? DEFAULT_BINDINGS;
  }

  private ringOf(hand: Hand): Ring {
    return this.options.ringOf?.(hand) ?? (hand === "Right" ? "action" : "reference");
  }

  private on(feature: FeatureId): boolean {
    return this.options.enabled?.(feature) ?? true;
  }

  /** A ring that can open now: rings are switched on. */
  private ringOpens(ring: Ring | undefined): ring is Ring {
    return !!ring && this.on("toolRings");
  }

  handle(event: GestureEvent): void {
    const { palette, tool } = this.targets;
    const b = this.bindings;
    switch (event.type) {
      case "pinch.hold": {
        const owner = this.owners.get(event.hand);
        if (owner === "tool" || palette.isOpen) return;
        const action = actionFor(b, "hold", event.hand);
        if (action === "talk" && this.startTalk(event, owner)) return;
        const ring = action === "talk" ? this.ringOf(event.hand) : RINGS[action];
        if (!this.ringOpens(ring)) {
          this.run(action, event.position, event.hand);
          return;
        }
        if (owner === "navigation") this.targets.navigation({ ...event, type: "pinch.drag.end" });
        palette.open(event.position, ring, event.hand);
        this.paletteHand = event.hand;
        this.owners.set(event.hand, "palette");
        return;
      }
      case "pinch.drag.start": {
        let owner: Owner = "ignored";
        const drag = actionFor(b, "drag", event.hand);
        if (drag === "tool-or-orbit")
          owner = tool.dragStart(event.position, event.hand) ? "tool" : "navigation";
        else if (drag !== "none") owner = "navigation";
        this.owners.set(event.hand, owner);
        if (owner === "navigation") this.targets.navigation(event, this.dragMode(event.hand));
        return;
      }
      case "pinch.drag.update":
      case "pinch.drag.end": {
        const owner = this.owners.get(event.hand) ?? "navigation";
        const end = event.type === "pinch.drag.end";
        if (end) this.owners.delete(event.hand);
        if (owner === "talk") {
          if (end) this.endTalk(event.hand);
          else this.moveTalk(event.position, event.hand);
        } else if (owner === "palette") {
          if (end) this.closePalette(true);
          else palette.steer(event.position);
        } else if (owner === "tool") {
          if (end) tool.dragEnd(event.position, event.hand);
          else tool.drag(event.position, event.hand);
        } else if (owner === "navigation") {
          this.targets.navigation(event, this.dragMode(event.hand));
        }
        return;
      }
      case "pinch.tap": {
        if (palette.isOpen && event.hand === this.paletteHand) return;
        const action = actionFor(b, "tap", event.hand);
        if (action === "use-tool") tool.tap(event.position, event.hand);
        else this.run(action, event.position, event.hand);
        return;
      }
      case "fist.drag.start":
      case "fist.drag.update":
      case "fist.drag.end":
        this.fistDrag(event);
        return;
      case "twohand.start":
      case "twohand.update":
      case "twohand.end":
        this.twoHand = event.type !== "twohand.end";
        if (actionFor(b, "twohand") === "none" || !this.on("twoHandNavigation")) return;
        if (!palette.isOpen || event.type === "twohand.end") this.targets.navigation(event);
        return;
      case "clutch.start":
      case "clutch.end":
        this.clutch(event.hand, event.type === "clutch.start");
        return;
      case "head.nod":
        if (this.on("headGestures")) this.run(actionFor(b, "nod"));
        return;
      case "head.shake":
        if (this.on("headGestures")) this.run(actionFor(b, "shake"));
        return;
      case "hands.stop":
        if (this.on("stopGesture")) this.run(actionFor(b, "stop"));
        return;
      case "disengaged":
        this.dropTalk();
        this.closePalette(false);
        if ([...this.owners.values()].includes("tool")) tool.dragCancel();
        this.owners.clear();
        this.fists.clear();
        this.bothFists = false;
        this.twoHand = false;
        this.targets.navigation(event);
        return;
      default:
        return;
    }
  }

  /**
   * A long pinch bound to talk: lock "this" and listen while held. The hand's ring opens hidden at once, so a flick
   * before any speech highlights a slot straight away; the ring is shown when the hand flicks or the hold has been
   * silent for `RING_AFTER_MS`. False when listening cannot start (the ring opens as before).
   */
  private startTalk(event: Extract<GestureEvent, { type: "pinch.hold" }>, owner: Owner | undefined): boolean {
    const { hand, position } = event;
    const talk = this.options.talk;
    if (!talk || this.hold || !talk.start(position, hand)) return false;
    if (owner === "navigation") this.targets.navigation({ ...event, type: "pinch.drag.end" });
    const ring = this.ringOf(hand);
    const { palette } = this.targets;
    const machine = new HoldMachine({ center: position, aspect: palette.aspect?.() ?? 4 / 3 }, this.now());
    if (this.ringOpens(ring)) palette.open(position, ring, hand, true);
    const timer = this.setTimer(() => this.showRing(), RING_AFTER_MS);
    this.hold = { hand, machine, ring, timer };
    this.owners.set(hand, "talk");
    return true;
  }

  private moveTalk(position: Point2, hand: Hand): void {
    const hold = this.hold;
    if (!hold || hold.hand !== hand) return;
    hold.machine.move(position);
    if (hold.machine.state(this.now()).phase !== "speaking" && this.targets.palette.isOpen) {
      this.targets.palette.steer(position);
      this.showRing();
    }
    this.options.talk?.move(position, hand);
  }

  /** Speech started during a hold: it wins, so the ring goes and the hand points from now on. */
  speech(hand: Hand): void {
    const hold = this.hold;
    if (!hold || hold.hand !== hand) return;
    hold.machine.speech();
    if (this.targets.palette.isOpen) this.targets.palette.cancel();
  }

  private showRing(): void {
    if (this.hold?.machine.state(this.now()).ringShown) this.targets.palette.show?.();
  }

  private endTalk(hand: Hand): void {
    const hold = this.hold;
    if (!hold || hold.hand !== hand) return;
    const spoke = hold.machine.state(this.now()).phase === "speaking";
    const outcome = hold.machine.release();
    this.clearTimer(hold.timer);
    this.hold = null;
    const { palette } = this.targets;
    if (palette.isOpen) {
      if (outcome.kind === "choose") palette.release();
      else palette.cancel();
    }
    this.options.talk?.end(hand, outcome.kind === "send");
    this.options.onHold?.({ outcome: outcome.kind, ring: hold.ring, spoke });
  }

  /** The user disengaged mid-hold: nothing is chosen or sent. */
  private dropTalk(): void {
    const hold = this.hold;
    if (!hold) return;
    this.clearTimer(hold.timer);
    this.hold = null;
    this.owners.delete(hold.hand);
    this.options.talk?.end(hold.hand, false);
    this.options.onHold?.({ outcome: "cancel", ring: hold.ring, spoke: false });
  }

  private dragMode(hand: Hand): DragMode {
    return actionFor(this.bindings, "drag", hand) === "pan" ? "pan" : "orbit";
  }

  /** A fist drag moves the view the way its hand's setting says; the rest of its rules are in the class comment. */
  private fistDrag(event: Extract<GestureEvent, { type: `fist.drag.${string}` }>): void {
    const action = actionFor(this.bindings, "fistdrag", event.hand);
    const mode: DragMode = action === "pan" ? "pan" : "orbit";
    if (event.type === "fist.drag.start") {
      const otherNavigates = [...this.owners].some(
        ([hand, owner]) => hand !== event.hand && owner === "navigation",
      );
      const free =
        action !== "none" &&
        !this.bothFists &&
        !this.twoHand &&
        !this.targets.palette.isOpen &&
        !otherNavigates;
      this.owners.set(event.hand, free ? "navigation" : "ignored");
      if (free) {
        this.targets.tool.clutch(false); // a fist that moves is not a hold: drop the pending cancel
        this.targets.navigation(event, mode);
      }
      return;
    }
    const owner = this.owners.get(event.hand);
    if (event.type === "fist.drag.end") this.owners.delete(event.hand);
    if (owner === "navigation") this.targets.navigation(event, mode);
  }

  /** One hand's fist runs its action once held; both fists together are the stop gesture's start instead. */
  private clutch(hand: Hand, closed: boolean): void {
    const { tool } = this.targets;
    if (closed) this.fists.add(hand);
    else this.fists.delete(hand);
    if (this.fists.size === 2) this.bothFists = true;
    if (this.bothFists) {
      tool.clutch(false); // drops a fist timer that may have started on the first hand
      if (this.fists.size === 0) this.bothFists = false;
      return;
    }
    const action = actionFor(this.bindings, "fist", hand);
    if (action === "none") return;
    if (action === "cancel") tool.clutch(closed);
    else tool.clutch(closed, () => this.run(action));
  }

  /** A one-shot action, from any discrete gesture. */
  private run(action: GestureAction, position?: Point2, hand: Hand = "Right"): void {
    const { tool } = this.targets;
    const agent = this.options.agent;
    switch (action) {
      case "use-tool":
        if (position) tool.tap(position, hand);
        return;
      case "select":
        if (position) tool.select(position);
        return;
      case "undo":
        tool.undo();
        return;
      case "redo":
        tool.redo();
        return;
      case "cancel":
        tool.cancel();
        return;
      case "yes":
        if (!agent?.answer(true)) tool.nod();
        return;
      case "no":
        if (!agent?.answer(false)) tool.shake();
        return;
      case "ask-agent":
        agent?.ask();
        return;
      case "stop-agent":
        agent?.stop();
        return;
      default:
        return; // "none", the rings (only a long pinch opens one), and the continuous actions drags take
    }
  }

  private closePalette(choose: boolean): void {
    if (!this.targets.palette.isOpen) return;
    if (choose) this.targets.palette.release();
    else this.targets.palette.cancel();
    this.paletteHand = null;
  }
}

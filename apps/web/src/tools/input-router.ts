import {
  DEFAULT_BINDINGS,
  type GestureAction,
  type GestureBindings,
  type GestureEvent,
  type Hand,
  type Point2,
} from "@aex/protocol";

export type DragMode = "orbit" | "pan";

/** Where routed gestures go. Positions are the gesture's own (camera frame, mirrored like the preview). */
export interface RouterTargets {
  palette: {
    readonly isOpen: boolean;
    open(position: Point2): void;
    steer(position: Point2): void;
    release(): void;
    cancel(): void;
  };
  tool: {
    tap(position: Point2): void;
    /** True if the active tool takes the drag; otherwise the drag navigates. */
    dragStart(position: Point2): boolean;
    drag(position: Point2): void;
    dragEnd(position: Point2): void;
    dragCancel(): void;
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

export interface RouterOptions {
  /** What each gesture does now (the user can change it in the settings). */
  bindings?: () => GestureBindings;
  agent?: RouterAgent;
}

type Owner = "palette" | "tool" | "navigation" | "ignored";

/**
 * Sends each gesture to exactly one place, through the gesture's binding (what the user set it to do), so
 * navigation never needs to know about the palette or the tools:
 * - while the palette is open, it gets the drag of the hand that opened it, and nothing navigates;
 * - otherwise a drag goes to the active tool if it takes it (Move on an element, Section), else to navigation;
 * - a long pinch opens the palette; if that hand was orbiting, the orbit is ended first. A long pinch while a tool
 *   holds something (an element being moved, the section plane) keeps holding it: holding still is not a request
 *   for the palette then;
 * - "yes" and "no" answer the agent's approval card when exactly one waits, else the tool's question.
 */
export class InputRouter {
  private readonly owners = new Map<Hand, Owner>();
  private paletteHand: Hand | null = null;

  constructor(
    private readonly targets: RouterTargets,
    private readonly options: RouterOptions = {},
  ) {}

  private get bindings(): GestureBindings {
    return this.options.bindings?.() ?? DEFAULT_BINDINGS;
  }

  handle(event: GestureEvent): void {
    const { palette, tool } = this.targets;
    const b = this.bindings;
    switch (event.type) {
      case "pinch.hold": {
        const owner = this.owners.get(event.hand);
        if (owner === "tool" || palette.isOpen) return;
        if (b.hold !== "palette") {
          this.run(b.hold, event.position);
          return;
        }
        if (owner === "navigation") this.targets.navigation({ ...event, type: "pinch.drag.end" });
        palette.open(event.position);
        this.paletteHand = event.hand;
        this.owners.set(event.hand, "palette");
        return;
      }
      case "pinch.drag.start": {
        if (palette.isOpen) {
          this.owners.set(event.hand, event.hand === this.paletteHand ? "palette" : "navigation");
          return;
        }
        let owner: Owner = "ignored";
        if (b.drag === "tool-or-orbit") owner = tool.dragStart(event.position) ? "tool" : "navigation";
        else if (b.drag !== "none") owner = "navigation";
        this.owners.set(event.hand, owner);
        if (owner === "navigation") this.targets.navigation(event, this.dragMode);
        return;
      }
      case "pinch.drag.update":
      case "pinch.drag.end": {
        const owner = this.owners.get(event.hand) ?? "navigation";
        const end = event.type === "pinch.drag.end";
        if (end) this.owners.delete(event.hand);
        if (owner === "palette") {
          if (end) this.closePalette(true);
          else palette.steer(event.position);
        } else if (owner === "tool") {
          if (end) tool.dragEnd(event.position);
          else tool.drag(event.position);
        } else if (owner === "navigation" && !palette.isOpen) {
          this.targets.navigation(event, this.dragMode);
        }
        return;
      }
      case "pinch.tap":
        if (palette.isOpen) return;
        if (b.tap === "use-tool") tool.tap(event.position);
        else this.run(b.tap, event.position);
        return;
      case "twohand.start":
      case "twohand.update":
      case "twohand.end":
        if (b.twohand === "none") return;
        if (!palette.isOpen || event.type === "twohand.end") this.targets.navigation(event);
        return;
      case "clutch.start":
      case "clutch.end":
        if (b.fist === "none") return;
        if (b.fist === "cancel") tool.clutch(event.type === "clutch.start");
        else tool.clutch(event.type === "clutch.start", () => this.run(b.fist));
        return;
      case "head.nod":
        this.run(b.nod);
        return;
      case "head.shake":
        this.run(b.shake);
        return;
      case "palms.stop":
        this.run(b.palms);
        return;
      case "disengaged":
        this.closePalette(false);
        if ([...this.owners.values()].includes("tool")) tool.dragCancel();
        this.owners.clear();
        this.targets.navigation(event);
        return;
      default:
        return;
    }
  }

  private get dragMode(): DragMode {
    return this.bindings.drag === "pan" ? "pan" : "orbit";
  }

  /** A one-shot action, from any discrete gesture. */
  private run(action: GestureAction, position?: Point2): void {
    const { tool } = this.targets;
    const agent = this.options.agent;
    switch (action) {
      case "use-tool":
        if (position) tool.tap(position);
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
        return; // "none", and the continuous actions that only drags and two-hand pinches take
    }
  }

  private closePalette(choose: boolean): void {
    if (!this.targets.palette.isOpen) return;
    if (choose) this.targets.palette.release();
    else this.targets.palette.cancel();
    this.paletteHand = null;
  }
}

import type { GestureEvent, Hand, Point2 } from "@aex/protocol";

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
    nod(): void;
    shake(): void;
    clutch(closed: boolean): void;
  };
  /** The view navigation controller (orbit, zoom, pan). */
  navigation(event: GestureEvent): void;
}

type Owner = "palette" | "tool" | "navigation";

/**
 * Sends each gesture to exactly one place, so navigation never needs to know about the palette or the tools:
 * - while the palette is open, it gets the drag of the hand that opened it, and nothing navigates;
 * - otherwise a drag goes to the active tool if it takes it (Move on an element, Section), else to navigation;
 * - a long pinch opens the palette; if that hand was orbiting, the orbit is ended first. A long pinch while a tool
 *   holds something (an element being moved, the section plane) keeps holding it: holding still is not a request
 *   for the palette then.
 */
export class InputRouter {
  private readonly owners = new Map<Hand, Owner>();
  private paletteHand: Hand | null = null;

  constructor(private readonly targets: RouterTargets) {}

  handle(event: GestureEvent): void {
    const { palette, tool } = this.targets;
    switch (event.type) {
      case "pinch.hold": {
        const owner = this.owners.get(event.hand);
        if (owner === "tool" || palette.isOpen) return;
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
        const owner: Owner = tool.dragStart(event.position) ? "tool" : "navigation";
        this.owners.set(event.hand, owner);
        if (owner === "navigation") this.targets.navigation(event);
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
        } else if (!palette.isOpen) {
          this.targets.navigation(event);
        }
        return;
      }
      case "pinch.tap":
        if (!palette.isOpen) tool.tap(event.position);
        return;
      case "twohand.start":
      case "twohand.update":
      case "twohand.end":
        if (!palette.isOpen || event.type === "twohand.end") this.targets.navigation(event);
        return;
      case "clutch.start":
      case "clutch.end":
        tool.clutch(event.type === "clutch.start");
        return;
      case "head.nod":
        tool.nod();
        return;
      case "head.shake":
        tool.shake();
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

  private closePalette(choose: boolean): void {
    if (!this.targets.palette.isOpen) return;
    if (choose) this.targets.palette.release();
    else this.targets.palette.cancel();
    this.paletteHand = null;
  }
}

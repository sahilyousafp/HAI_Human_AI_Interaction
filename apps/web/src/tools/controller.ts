import { DEFAULT_GESTURES } from "@aex/perception";
import type { GestureEvent, Point2, Point3Mm, SceneDocument, SceneOp } from "@aex/protocol";
import type { DragMode, RouterTargets } from "./input-router.ts";
import { PaletteMachine, type PaletteSpace, type PaletteState, SLOT_COUNT } from "./palette.ts";
import type { ToolRegistry } from "./registry.ts";
import { EMPTY_OVERLAY, type Hit, type Tool, type ToolContext, type ToolOverlay } from "./types.ts";

/** Holding a fist this long returns to Select (the fist is recognised after the clutch debounce). */
export const FIST_RESET_MS = 600;
/** How long a passing message (undo, agent not connected) stays. */
export const FLASH_MS = 4000;
export const DEFAULT_TOOL = "select";

/** What the viewer provides: the scene, picking, and how to turn hand positions into viewer positions. */
export interface ToolEnvironment {
  doc(): SceneDocument | null;
  apply(label: string, ops: SceneOp[]): void;
  undo(): void;
  redo(): void;
  select(ids: string[]): void;
  pick(at: Point2): Hit | null;
  ground(at: Point2, heightMm?: number): Point3Mm | null;
  bounds(): { min: Point3Mm; max: Point3Mm };
  onSectionLine(at: Point2): boolean;
  /** Camera-frame position (mirrored like the preview) to viewer position. */
  handToViewer(position: Point2): Point2;
  /** Width / height of the camera frame. */
  handAspect(): number;
  /** View navigation for gestures no tool takes; a one-hand drag orbits or pans. */
  navigate(event: GestureEvent, dragMode?: DragMode): void;
  /** Presses the on-screen button at a viewer position, if there is one (hands can press HUD buttons). */
  press(at: Point2): boolean;
  /** Whether there is an on-screen button at a viewer position. */
  isButton(at: Point2): boolean;
  /** Opens the agent panel ready for a request; returns why it cannot, or null. */
  askAgent(): string | null;
}

export interface ToolSnapshot {
  activeId: string;
  /** Tool id per slot, clockwise from the top; null is an empty slot. */
  layout: Array<string | null>;
  /** Open palette, in viewer coordinates for drawing. */
  palette: { center: Point2; highlighted: number | null } | null;
  overlay: ToolOverlay;
  /** The question waiting for a yes or no, if any. */
  question: string | null;
  /** Bumped when tools are registered, so lists of available tools refresh. */
  registryVersion: number;
}

/**
 * The active tool, the palette and everything tools draw, as one small store the viewer renders. Gestures arrive
 * through the input router (`routerTargets`); mouse and keyboard call the same methods with viewer positions.
 */
export class ToolController {
  private readonly palette = new PaletteMachine();
  private paletteSource: "hand" | "pointer" = "pointer";
  private env: ToolEnvironment | null = null;
  private dragging = false;
  /** A pinch began on an on-screen button: it presses the button when released there, however long it lasted. */
  private pressing = false;
  private lastDragAt: Point2 = [0, 0];
  private answer: ((yes: boolean) => void) | null = null;
  private fistTimer: ReturnType<typeof setTimeout> | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private snapshot: ToolSnapshot;
  private readonly listeners = new Set<() => void>();
  /** Called when the user changes the layout (to persist it). */
  onLayoutChange: (layout: Array<string | null>) => void = () => {};

  constructor(
    readonly registry: ToolRegistry,
    layout: Array<string | null>,
  ) {
    this.snapshot = {
      activeId: DEFAULT_TOOL,
      layout: normaliseLayout(layout),
      palette: null,
      overlay: EMPTY_OVERLAY,
      question: null,
      registryVersion: 0,
    };
    registry.onChange(() => this.update({ registryVersion: this.snapshot.registryVersion + 1 }));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ToolSnapshot => this.snapshot;

  attach(env: ToolEnvironment): void {
    this.env = env;
  }

  get active(): Tool | undefined {
    return this.registry.get(this.snapshot.activeId);
  }

  /** Activates a tool, or runs an instant one and keeps the current tool. */
  choose(id: string): void {
    const tool = this.registry.get(id);
    const ctx = this.ctx();
    if (!tool || !ctx) return;
    if (tool.instant) {
      tool.run?.(ctx);
      return;
    }
    if (id === this.snapshot.activeId) return;
    this.cancelDrag();
    this.closeQuestion(false);
    this.active?.deactivate?.(ctx);
    this.update({ activeId: id, overlay: { ...this.snapshot.overlay, notice: null } });
    tool.activate?.(ctx);
  }

  setLayout(layout: Array<string | null>): void {
    this.update({ layout: normaliseLayout(layout) });
    this.onLayoutChange(this.snapshot.layout);
  }

  /** Applies a layout that came from elsewhere (settings loaded from the bridge) without echoing it back. */
  loadLayout(layout: Array<string | null>): void {
    this.update({ layout: normaliseLayout(layout) });
  }

  // Palette

  get paletteOpen(): boolean {
    return this.palette.isOpen;
  }

  openPalette(space: PaletteSpace, source: "hand" | "pointer"): void {
    this.cancelDrag();
    this.paletteSource = source;
    this.palette.open(space);
    this.publishPalette();
  }

  steerPalette(point: Point2): void {
    this.palette.steer(point);
    this.publishPalette();
  }

  /** Closes the palette and activates the highlighted tool; released in the centre, nothing changes. */
  releasePalette(): void {
    const slot = this.palette.release();
    this.publishPalette();
    const id = slot === null ? null : this.snapshot.layout[slot];
    if (id) this.choose(id);
  }

  cancelPalette(): void {
    this.palette.cancel();
    this.publishPalette();
  }

  // Pointer input, in viewer coordinates

  tap(at: Point2): void {
    const ctx = this.ctx();
    if (!ctx || this.env?.press(at)) return;
    // Tapping the section's outline selects the section, except with Delete, which removes it (its own tap).
    if (this.onSectionLine(at) && this.snapshot.activeId !== "delete") {
      this.choose("section");
      return;
    }
    this.active?.onTap?.(ctx, at, ctx.pick(at));
  }

  /**
   * Hover feedback. The section outline responds in every tool (it lights up and the pointer shows grab), so the
   * section can be picked up whatever tool is active.
   */
  hover(at: Point2): void {
    const ctx = this.ctx();
    if (!ctx || this.dragging) return;
    const line = this.onSectionLine(at);
    const ownHover = this.active?.onHover;
    ownHover?.call(this.active, ctx, at);
    // A tool with its own hover (Section) may light the section up for other reasons too; the line always does.
    const hover = ownHover ? this.snapshot.overlay.sectionHover || line : line;
    if (hover !== this.snapshot.overlay.sectionHover) this.setOverlay({ sectionHover: hover });
  }

  private onSectionLine(at: Point2): boolean {
    return this.snapshot.overlay.sectionMm !== null && (this.env?.onSectionLine(at) ?? false);
  }

  /**
   * One way back out of anything: closes the palette, answers no to a question, drops a drag in progress, or else
   * returns to Select. Escape, a head shake and the cancel button all do this.
   */
  cancel(): void {
    if (this.palette.isOpen) this.cancelPalette();
    else if (this.answer) this.closeQuestion(false);
    else if (this.dragging) this.cancelDrag();
    else this.choose(DEFAULT_TOOL);
  }

  /** True if the active tool takes the drag; otherwise the caller navigates. */
  dragStart(at: Point2): boolean {
    const ctx = this.ctx();
    if (!ctx) return false;
    if (this.env?.isButton(at)) {
      // Pinches longer than a quick tap arrive as drags; on a button they are presses, never grabs or orbits.
      this.pressing = true;
      return true;
    }
    // A drag that starts on the section's outline grabs the section from any tool.
    if (this.onSectionLine(at) && this.snapshot.activeId !== "section") this.choose("section");
    this.dragging = this.active?.onDragStart?.(ctx, at, ctx.pick(at)) ?? false;
    this.lastDragAt = at;
    return this.dragging;
  }

  drag(at: Point2): void {
    const ctx = this.ctx();
    if (!ctx || !this.dragging || this.pressing) return;
    const delta: Point2 = [at[0] - this.lastDragAt[0], at[1] - this.lastDragAt[1]];
    this.lastDragAt = at;
    this.active?.onDrag?.(ctx, at, delta);
  }

  dragEnd(at: Point2): void {
    if (this.pressing) {
      this.pressing = false;
      this.env?.press(at);
      return;
    }
    const ctx = this.ctx();
    if (!ctx || !this.dragging) return;
    this.dragging = false;
    this.active?.onDragEnd?.(ctx, at);
  }

  cancelDrag(): void {
    this.pressing = false;
    const ctx = this.ctx();
    if (!ctx || !this.dragging) return;
    this.dragging = false;
    this.active?.onDragCancel?.(ctx);
  }

  // Confirmation: nod or Enter answers yes, shake or Escape no.

  respond(yes: boolean): void {
    this.closeQuestion(yes);
  }

  /** A fist held for FIST_RESET_MS runs `held`: by default, back to Select from any tool. */
  fist(closed: boolean, held: () => void = () => this.choose(DEFAULT_TOOL)): void {
    if (this.fistTimer) clearTimeout(this.fistTimer);
    this.fistTimer = null;
    if (!closed) return;
    const remaining = FIST_RESET_MS - DEFAULT_GESTURES.clutch.debounceMs;
    this.fistTimer = setTimeout(() => {
      this.fistTimer = null;
      held();
    }, remaining);
  }

  /** Selects the element at a viewer position (or clears the selection over empty space), whatever the tool. */
  selectAt(at: Point2): void {
    const hit = this.env?.pick(at);
    this.env?.select(hit ? [hit.elementId] : []);
  }

  clearSection(): void {
    this.setOverlay({ sectionMm: null });
  }

  /** The input router's view of this controller: hand positions are mapped to viewer positions here. */
  get routerTargets(): RouterTargets {
    const toViewer = (p: Point2) => this.env?.handToViewer(p) ?? p;
    const controller = this;
    return {
      palette: {
        get isOpen() {
          return controller.paletteOpen;
        },
        open: (position) =>
          this.openPalette({ center: position, aspect: this.env?.handAspect() ?? 4 / 3 }, "hand"),
        steer: (position) => this.steerPalette(position),
        release: () => this.releasePalette(),
        cancel: () => this.cancelPalette(),
      },
      tool: {
        tap: (p) => this.tap(toViewer(p)),
        dragStart: (p) => this.dragStart(toViewer(p)),
        drag: (p) => this.drag(toViewer(p)),
        dragEnd: (p) => this.dragEnd(toViewer(p)),
        dragCancel: () => this.cancelDrag(),
        nod: () => this.respond(true),
        shake: () => this.cancel(),
        clutch: (closed, held) => this.fist(closed, held),
        select: (p) => this.selectAt(toViewer(p)),
        undo: () => this.env?.undo(),
        redo: () => this.env?.redo(),
        cancel: () => this.cancel(),
      },
      navigation: (event, dragMode) => this.env?.navigate(event, dragMode),
    };
  }

  private ctx(): ToolContext | null {
    const env = this.env;
    if (!env) return null;
    return {
      doc: () => env.doc(),
      apply: (label, ops) => env.apply(label, ops),
      undo: () => env.undo(),
      redo: () => env.redo(),
      select: (ids) => env.select(ids),
      pick: (at) => env.pick(at),
      ground: (at, heightMm) => env.ground(at, heightMm),
      bounds: () => env.bounds(),
      onSectionLine: (at) => env.onSectionLine(at),
      overlay: () => this.snapshot.overlay,
      setOverlay: (partial) => this.setOverlay(partial),
      flash: (message) => this.flash(message),
      confirm: (question, answer) => {
        this.closeQuestion(false);
        this.answer = answer;
        this.update({ question });
      },
      askAgent: () => env.askAgent(),
    };
  }

  private setOverlay(partial: Partial<ToolOverlay>): void {
    this.update({ overlay: { ...this.snapshot.overlay, ...partial } });
  }

  private flash(message: string): void {
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.setOverlay({ notice: message });
    this.flashTimer = setTimeout(() => {
      this.flashTimer = null;
      if (this.snapshot.overlay.notice === message) this.setOverlay({ notice: null });
    }, FLASH_MS);
  }

  private closeQuestion(yes: boolean): void {
    const answer = this.answer;
    if (!answer) return;
    this.answer = null;
    this.update({ question: null });
    answer(yes);
  }

  private publishPalette(): void {
    const state: PaletteState | null = this.palette.state;
    if (!state) {
      this.update({ palette: null });
      return;
    }
    const center =
      this.paletteSource === "hand" ? (this.env?.handToViewer(state.center) ?? state.center) : state.center;
    this.update({ palette: { center, highlighted: state.highlighted } });
  }

  private update(partial: Partial<ToolSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    for (const listener of this.listeners) listener();
  }
}

function normaliseLayout(layout: Array<string | null>): Array<string | null> {
  return Array.from({ length: SLOT_COUNT }, (_, i) => layout[i] ?? null);
}

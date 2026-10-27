import { DEFAULT_GESTURES } from "@hai/perception";
import {
  DEFAULT_DRAWING_AIDS,
  type DrawingAids,
  type GestureEvent,
  type Hand,
  type HeldTarget,
  type Point2,
  type Point3Mm,
  type Ring,
  ringFor,
  type SceneDocument,
  type SceneOp,
} from "@hai/protocol";
import {
  buildSnapIndex,
  emptySnapIndex,
  type Projector,
  type Resolved,
  resolvePoint,
  type SnapIndex,
  type SnapKind,
} from "@hai/scene";
import type { DragMode, RouterTargets } from "./input-router.ts";
import { PaletteMachine, type PaletteSpace, type PaletteState, SLOT_COUNT } from "./palette.ts";
import { ReferenceLayer } from "./reference-layer.ts";
import type { ToolRegistry } from "./registry.ts";
import { EMPTY_OVERLAY, type Hit, type Tool, type ToolContext, type ToolOverlay } from "./types.ts";

/**
 * Holding a fist still this long returns to Select (the fist is recognised after the clutch debounce). A fist that
 * moves is a fist drag, which pans the view and drops this timer.
 */
export const FIST_RESET_MS = 1500;
/** How long a passing message (undo, agent not connected) stays. */
export const FLASH_MS = 4000;
export const DEFAULT_TOOL = "select";
/**
 * A pinch-drag that starts on a button inside a scrolled area presses the button, unless it moves this far up or
 * down first (a share of the viewer's height): then it scrolls the area instead.
 */
export const SCROLL_SLOP = 0.02;

export type { Ring };
/** Who is pointing: a hand, or the mouse. Each has its own press, scroll and ring; one of them drags a tool. */
export type PointerSource = Hand | "mouse";

/** A scrolled area a hand has grabbed: it follows the hand and coasts on when released quickly. */
export interface ScrollGrab {
  /** The hand moved by this much of the viewer's height (positive is down). */
  move(dy: number): void;
  release(): void;
}

/** What a pointer's pinch-drag is doing: pressing a button, scrolling an area, or the active tool. */
type Grab =
  | { kind: "press"; start: Point2 }
  | { kind: "scroll"; scroll: ScrollGrab; last: Point2 }
  | { kind: "tool"; last: Point2 };

/** What the viewer provides: the scene, picking, and how to turn hand positions into viewer positions. */
export interface ToolEnvironment {
  doc(): SceneDocument | null;
  apply(label: string, ops: SceneOp[]): void;
  undo(): void;
  redo(): void;
  select(ids: string[]): void;
  /** What is at a viewer position; for a hand (`source`) the nearest model in reach when none is exactly there. */
  pick(at: Point2, source?: PointerSource): Hit | null;
  ground(at: Point2, heightMm?: number): Point3Mm | null;
  /** The size of the view, px, and where a scene point is on it: the camera, for matching snaps on screen. */
  screenSize?(): Point2;
  projector?(): Projector | null;
  /** Which drawing aids are on; without it only Grid is. */
  aids?(): DrawingAids;
  bounds(): { min: Point3Mm; max: Point3Mm };
  onSectionLine(at: Point2): boolean;
  /** Camera-frame position (mirrored like the preview) to viewer position. */
  handToViewer(position: Point2): Point2;
  /** Width / height of the camera frame. */
  handAspect(): number;
  /** View navigation for gestures no tool takes; a one-hand drag orbits or pans. */
  navigate(event: GestureEvent, dragMode?: DragMode): void;
  /**
   * Presses the on-screen button at a viewer position, if there is one (hands can press HUD buttons). A hand's
   * pointer that is snapped to a button presses that button, wherever `at` is.
   */
  press(at: Point2, source?: PointerSource): boolean;
  /** Whether there is an on-screen button at a viewer position (or the pointer of `source` is snapped to one). */
  isButton(at: Point2, source?: PointerSource): boolean;
  /**
   * A pinch began on a control that has a drag of its own (a slider in a generated panel); `press` follows when it
   * lets go. `pressMove` follows the pointer meanwhile, and `pressCancel` drops it (the pinch became a scroll, or
   * was cancelled).
   */
  pressStart?(at: Point2, source: PointerSource): void;
  pressMove?(at: Point2, source: PointerSource): void;
  pressCancel?(source: PointerSource): void;
  /** Grabs the scrolled area at a viewer position (one with more to show), or null if there is none. */
  scrollAt(at: Point2): ScrollGrab | null;
  /** Opens the agent panel ready for a request; returns why it cannot, or null. */
  askAgent(): string | null;
}

export interface ToolSnapshot {
  activeId: string;
  /** Each ring's tool id per slot, clockwise from the top; null is an empty slot. */
  layouts: Record<Ring, Array<string | null>>;
  /** The hand the user draws with: its silent long pinch shows the action ring, the other hand's the reference ring. */
  dominantHand: Hand;
  /**
   * Open palette, in viewer coordinates for drawing, with which ring it is and the hand that opened it. A held pinch
   * opens it `hidden`: it steers and chooses as usual, and is shown once the hold is silent or the hand flicks.
   */
  palette: {
    center: Point2;
    highlighted: number | null;
    ring: Ring;
    hand: Hand | null;
    hidden: boolean;
  } | null;
  /** What a held pinch locked ("this"), shown until the hold ends, and the hand that holds it. */
  held: { target: HeldTarget; hand: Hand } | null;
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
  /** Sketches and markers: what the user pointed out for the agent, beside the model. */
  readonly references = new ReferenceLayer();
  private paletteSource: "hand" | "pointer" = "pointer";
  private paletteRing: Ring = "action";
  private paletteHand: Hand | null = null;
  private paletteHidden = false;
  private env: ToolEnvironment | null = null;
  /** What moved the pointer in the latest tap, hover or drag start: a hand snaps to models, the mouse does not. */
  private pickSource: PointerSource = "mouse";
  /**
   * Each pointer's drag. A pinch that began on an on-screen button presses it when released, however long it
   * lasted; one that began on a scrolled area scrolls it; otherwise the active tool may take it, for one pointer at
   * a time.
   */
  private readonly grabs = new Map<PointerSource, Grab>();
  private answer: ((yes: boolean) => void) | null = null;
  private fistTimer: ReturnType<typeof setTimeout> | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private snapshot: ToolSnapshot;
  private readonly listeners = new Set<() => void>();
  /** Called when the user changes a ring's layout (to persist it). */
  onLayoutChange: (layout: Array<string | null>, ring: Ring) => void = () => {};
  /** Called when the user changes the dominant hand (to persist it). */
  onDominantHandChange: (hand: Hand) => void = () => {};

  constructor(
    readonly registry: ToolRegistry,
    layouts: Record<Ring, Array<string | null>>,
  ) {
    this.snapshot = {
      activeId: DEFAULT_TOOL,
      layouts: { action: normaliseLayout(layouts.action), reference: normaliseLayout(layouts.reference) },
      dominantHand: "Right",
      held: null,
      palette: null,
      overlay: EMPTY_OVERLAY,
      question: null,
      registryVersion: 0,
    };
    registry.onChange(() => {
      // A tool switched off while in use hands back to Select.
      if (!registry.isAvailable(this.snapshot.activeId)) this.choose(DEFAULT_TOOL);
      this.update({ registryVersion: this.snapshot.registryVersion + 1 });
    });
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
    if (!tool || !ctx || !this.registry.isAvailable(id)) return;
    if (tool.instant) {
      tool.run?.(ctx);
      return;
    }
    if (id === this.snapshot.activeId) return;
    this.cancelToolDrag();
    this.closeQuestion(false);
    this.active?.deactivate?.(ctx);
    this.clearSnap();
    this.update({ activeId: id, overlay: { ...this.snapshot.overlay, notice: null } });
    tool.activate?.(ctx);
  }

  setLayout(layout: Array<string | null>, ring: Ring = "action"): void {
    this.update({ layouts: { ...this.snapshot.layouts, [ring]: normaliseLayout(layout) } });
    this.onLayoutChange(this.snapshot.layouts[ring], ring);
  }

  /** Applies a layout that came from elsewhere (settings loaded from the bridge) without echoing it back. */
  loadLayout(layout: Array<string | null>, ring: Ring = "action"): void {
    this.update({ layouts: { ...this.snapshot.layouts, [ring]: normaliseLayout(layout) } });
  }

  setDominantHand(hand: Hand): void {
    this.update({ dominantHand: hand });
    this.onDominantHandChange(hand);
  }

  /** Applies the dominant hand from the bridge's settings without echoing it back. */
  loadDominantHand(hand: Hand): void {
    this.update({ dominantHand: hand });
  }

  /** A hand position (camera frame, mirrored like the preview) as a viewer position. */
  viewerOf(position: Point2): Point2 {
    return this.env?.handToViewer(position) ?? position;
  }

  /** The ring a silent long pinch of this hand shows. */
  ringOf(hand: Hand): Ring {
    return ringFor(hand, this.snapshot.dominantHand);
  }

  // Palette

  get paletteOpen(): boolean {
    return this.palette.isOpen;
  }

  /** Opens a ring at a point (`hidden` until `showPalette`); a hand that opens it gives up its own drag first. */
  openPalette(
    space: PaletteSpace,
    source: "hand" | "pointer",
    ring: Ring = "action",
    hand: Hand | null = null,
    hidden = false,
  ): void {
    this.cancelDrag(hand ?? "mouse");
    this.paletteSource = source;
    this.paletteRing = ring;
    this.paletteHand = hand;
    this.paletteHidden = hidden;
    this.palette.open(space);
    this.publishPalette();
  }

  /** Shows a ring a held pinch opened hidden. */
  showPalette(): void {
    if (!this.palette.isOpen || !this.paletteHidden) return;
    this.paletteHidden = false;
    this.publishPalette();
  }

  // Held pinch

  /**
   * What a held pinch at a viewer position means by "this": the element there (a hand's pointer snaps to the nearest
   * model in reach), else the point the drawing aids resolve there, else the ground point. It is shown until
   * `releaseTarget`. Null when the view points away from the ground and nothing is there.
   */
  lockTarget(at: Point2, hand: Hand): HeldTarget | null {
    const env = this.env;
    if (!env) return null;
    const hit = env.pick(at, hand);
    const element = hit ? env.doc()?.elements[hit.elementId] : undefined;
    let target: HeldTarget | null = null;
    if (element) {
      target = { kind: "element", id: element.id, type: element.type, name: element.name };
    } else {
      const resolved = this.resolveSnap(env, at);
      this.clearSnap();
      const snapped = resolved && resolved.kind !== null && resolved.kind !== "grid" ? resolved.label : null;
      const point = snapped && resolved ? resolved.point : env.ground(at);
      if (point) {
        const [x, y, z] = point;
        target = {
          kind: "point",
          point: [Math.round(x), Math.round(y), Math.round(z)],
          aid: snapped ?? null,
        };
      }
    }
    this.update({ held: target ? { target, hand } : null });
    return target;
  }

  releaseTarget(): void {
    if (this.snapshot.held) this.update({ held: null });
  }

  /**
   * The point a hand rests on while it holds and speaks: the drawing aids' point there, in whole millimetres, and the
   * element under it if there is one. Null when the view points away from the ground.
   */
  pointAt(at: Point2, hand: Hand): { point: Point3Mm; elementId: string | null } | null {
    const env = this.env;
    if (!env) return null;
    const hit = env.pick(at, hand);
    const resolved = this.resolveSnap(env, at);
    this.clearSnap();
    const point = resolved?.point ?? env.ground(at);
    if (!point) return null;
    const [x, y, z] = point;
    return { point: [Math.round(x), Math.round(y), Math.round(z)], elementId: hit?.elementId ?? null };
  }

  steerPalette(point: Point2): void {
    this.palette.steer(point);
    this.publishPalette();
  }

  /** Closes the palette and activates the highlighted tool; released in the centre, nothing changes. */
  releasePalette(): void {
    const slot = this.palette.release();
    this.publishPalette();
    const id = slot === null ? null : this.snapshot.layouts[this.paletteRing][slot];
    if (id) this.choose(id);
  }

  cancelPalette(): void {
    this.palette.cancel();
    this.publishPalette();
  }

  // Pointer input, in viewer coordinates

  tap(at: Point2, source: PointerSource = "mouse"): void {
    this.pickSource = source;
    const ctx = this.ctx();
    if (!ctx || this.env?.press(at, source)) return;
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
  hover(at: Point2, source: PointerSource = "mouse"): void {
    this.pickSource = source;
    const ctx = this.ctx();
    if (!ctx || this.toolDragger !== null) return;
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
    else if (this.toolDragger !== null) this.cancelToolDrag();
    else {
      const ctx = this.ctx();
      if (ctx && this.active?.onCancel?.(ctx)) return;
      this.choose(DEFAULT_TOOL);
    }
  }

  /** The pointer whose drag the active tool has, if any. */
  private get toolDragger(): PointerSource | null {
    for (const [source, grab] of this.grabs) if (grab.kind === "tool") return source;
    return null;
  }

  /**
   * True if the controller takes the drag (a button press, a scroll, or the active tool); otherwise the caller
   * navigates. The active tool takes one pointer's drag at a time: while one hand moves an element or draws a wall,
   * the other hand's drag navigates.
   */
  dragStart(at: Point2, source: PointerSource = "mouse"): boolean {
    this.pickSource = source;
    const ctx = this.ctx();
    if (!ctx) return false;
    this.cancelDrag(source);
    if (this.env?.isButton(at, source)) {
      // Pinches longer than a quick tap arrive as drags; on a button they are presses, never grabs or orbits.
      this.grabs.set(source, { kind: "press", start: at });
      this.env.pressStart?.(at, source);
      return true;
    }
    const scroll = this.env?.scrollAt(at) ?? null;
    if (scroll) {
      this.grabs.set(source, { kind: "scroll", scroll, last: at });
      return true;
    }
    if (this.toolDragger !== null) return false;
    // A drag that starts on the section's outline grabs the section from any tool.
    if (this.onSectionLine(at) && this.snapshot.activeId !== "section") this.choose("section");
    if (!this.active?.onDragStart?.(ctx, at, ctx.pick(at))) return false;
    this.grabs.set(source, { kind: "tool", last: at });
    return true;
  }

  drag(at: Point2, source: PointerSource = "mouse"): void {
    const grab = this.grabs.get(source);
    if (!grab) return;
    if (grab.kind === "press") {
      this.env?.pressMove?.(at, source);
      // Moving up or down from a button in a scrolled area scrolls it instead of pressing.
      if (Math.abs(at[1] - grab.start[1]) < SCROLL_SLOP) return;
      const scroll = this.env?.scrollAt(grab.start) ?? null;
      if (!scroll) return;
      this.env?.pressCancel?.(source);
      this.grabs.set(source, { kind: "scroll", scroll, last: grab.start });
      this.drag(at, source);
      return;
    }
    const delta: Point2 = [at[0] - grab.last[0], at[1] - grab.last[1]];
    grab.last = at;
    if (grab.kind === "scroll") {
      grab.scroll.move(delta[1]);
      return;
    }
    const ctx = this.ctx();
    if (ctx) this.active?.onDrag?.(ctx, at, delta);
  }

  dragEnd(at: Point2, source: PointerSource = "mouse"): void {
    const grab = this.grabs.get(source);
    this.grabs.delete(source);
    if (grab?.kind === "press") this.env?.press(at, source);
    else if (grab?.kind === "scroll") grab.scroll.release();
    else if (grab?.kind === "tool") {
      const ctx = this.ctx();
      if (ctx) this.active?.onDragEnd?.(ctx, at);
      this.clearSnap();
    }
  }

  /** Drops a pointer's drag (every pointer's when none is given), committing nothing. */
  cancelDrag(source?: PointerSource): void {
    for (const [s, grab] of [...this.grabs]) {
      if (source !== undefined && s !== source) continue;
      this.grabs.delete(s);
      if (grab.kind === "scroll") grab.scroll.release();
      if (grab.kind === "press") this.env?.pressCancel?.(s);
      if (grab.kind === "tool") {
        const ctx = this.ctx();
        if (ctx) this.active?.onDragCancel?.(ctx);
        this.clearSnap();
      }
    }
  }

  /** Drops the active tool's drag, whichever pointer has it. */
  private cancelToolDrag(): void {
    const dragger = this.toolDragger;
    if (dragger !== null) this.cancelDrag(dragger);
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
    const hit = this.env?.pick(at, "Right"); // only a hand selects this way
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
        open: (position, ring, hand, hidden) =>
          this.openPalette(
            { center: position, aspect: this.env?.handAspect() ?? 4 / 3 },
            "hand",
            ring,
            hand,
            hidden ?? false,
          ),
        show: () => this.showPalette(),
        aspect: () => this.env?.handAspect() ?? 4 / 3,
        steer: (position) => this.steerPalette(position),
        release: () => this.releasePalette(),
        cancel: () => this.cancelPalette(),
      },
      tool: {
        tap: (p, hand) => this.tap(toViewer(p), hand),
        dragStart: (p, hand) => this.dragStart(toViewer(p), hand),
        drag: (p, hand) => this.drag(toViewer(p), hand),
        dragEnd: (p, hand) => this.dragEnd(toViewer(p), hand),
        dragCancel: (hand) => this.cancelDrag(hand),
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
      pick: (at) => env.pick(at, this.pickSource),
      ground: (at, heightMm) => env.ground(at, heightMm),
      aids: () => env.aids?.() ?? DEFAULT_DRAWING_AIDS,
      resolve: (at, options) => this.resolveSnap(env, at, options),
      clearSnap: () => this.clearSnap(),
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
      references: this.references,
      toScreen: (point) => {
        const project = env.projector?.();
        const out: [number, number] = [0, 0];
        return project?.(point, out) ? out : null;
      },
      toPixels: ([x, y]) => {
        const [width, height] = env.screenSize?.() ?? [1, 1];
        return [x * width, y * height];
      },
      hand: () => (this.pickSource === "mouse" ? null : this.pickSource),
    };
  }

  /** The snap index of the scene, rebuilt only when the scene or the excluded elements change. */
  private snapCache: { doc: SceneDocument; exclude: string; index: SnapIndex } | null = null;

  private snapIndex(doc: SceneDocument, exclude: string[]): SnapIndex {
    const key = exclude.join(",");
    if (this.snapCache?.doc !== doc || this.snapCache.exclude !== key) {
      this.snapCache = { doc, exclude: key, index: buildSnapIndex(doc, new Set(exclude)) };
    }
    return this.snapCache.index;
  }

  private resolveSnap(
    env: ToolEnvironment,
    at: Point2,
    options: { anchor?: Point3Mm | null; exclude?: string[]; probe?: Point3Mm } = {},
  ): Resolved | null {
    const doc = env.doc();
    const aids = env.aids?.() ?? DEFAULT_DRAWING_AIDS;
    const project = env.projector?.() ?? null;
    const [width, height] = env.screenSize?.() ?? [1, 1];
    let pointer: Point2 = [at[0] * width, at[1] * height];
    const probe = options.probe;
    if (probe && project) {
      const out: [number, number] = [0, 0];
      if (project(probe, out)) pointer = out;
    }
    const result = resolvePoint({
      pointer,
      ground: (heightMm) => (probe ? [probe[0], probe[1], heightMm] : env.ground(at, heightMm)),
      anchor: options.anchor ?? null,
      aids,
      index: doc ? this.snapIndex(doc, options.exclude ?? []) : emptySnapIndex(),
      project,
    });
    if (!result) {
      this.clearSnap();
      return null;
    }
    // Grid on its own is the old behaviour and needs no marker; anything else the user switched on is shown.
    const shown = result.kind !== null && (result.kind !== "grid" || result.ortho);
    const label = result.kind === "grid" ? "Ortho" : (result.label ?? "");
    const current = this.snapshot.overlay.snap;
    if (!shown) {
      if (current) this.setOverlay({ snap: null });
    } else if (
      !current ||
      current.point[0] !== result.point[0] ||
      current.point[1] !== result.point[1] ||
      current.point[2] !== result.point[2] ||
      current.label !== label ||
      current.ortho !== result.ortho
    ) {
      this.setOverlay({
        snap: { point: result.point, kind: result.kind as SnapKind, label, ortho: result.ortho },
      });
    }
    return result;
  }

  private clearSnap(): void {
    if (this.snapshot.overlay.snap) this.setOverlay({ snap: null });
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
    this.update({
      palette: {
        center,
        highlighted: state.highlighted,
        ring: this.paletteRing,
        hand: this.paletteHand,
        hidden: this.paletteHidden,
      },
    });
  }

  private update(partial: Partial<ToolSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    for (const listener of this.listeners) listener();
  }
}

function normaliseLayout(layout: Array<string | null>): Array<string | null> {
  return Array.from({ length: SLOT_COUNT }, (_, i) => layout[i] ?? null);
}

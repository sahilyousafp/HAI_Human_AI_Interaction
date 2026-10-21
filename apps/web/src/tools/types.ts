import type { Element, Point2, Point3Mm, SceneDocument, SceneOp } from "@aex/protocol";

/** What is under a viewer position: an element and the surface point that was hit, millimetres. */
export interface Hit {
  elementId: string;
  point: Point3Mm;
}

/** Everything a tool may draw or say, rendered by the viewer. Lengths are millimetres. */
export interface ToolOverlay {
  /** A short instruction or message shown at the top of the viewer. */
  notice: string | null;
  /** Measure: the picked points (0 to 2). */
  measure: Point3Mm[];
  /** Section: the height of the horizontal cut; geometry above it is hidden. Stays after leaving the tool. */
  sectionMm: number | null;
  /** Move: the element being dragged and how far, before the move is committed. */
  movePreview: {
    id: string;
    offsetMm: [number, number];
    /** The element as it was when the drag began; the preview applies only while the element still matches. */
    from: string;
  } | null;
  /** Delete: the element waiting for confirmation. */
  marked: string | null;
  /** Section: the pointer is over the section plane, so a pinch would grab it. */
  sectionHover: boolean;
  /** Create tools and Copy: the element being drawn or placed, shown before it is created. */
  draft: Element | null;
}

export const EMPTY_OVERLAY: ToolOverlay = {
  notice: null,
  measure: [],
  sectionMm: null,
  movePreview: null,
  marked: null,
  sectionHover: false,
  draft: null,
};

/** What a tool can do. Positions are viewer coordinates: 0..1 across and down the 3D view. */
export interface ToolContext {
  doc(): SceneDocument | null;
  apply(label: string, ops: SceneOp[]): void;
  undo(): void;
  redo(): void;
  select(ids: string[]): void;
  pick(at: Point2): Hit | null;
  /** Where the view ray at `at` meets the horizontal plane at `heightMm`, or null if it points away. */
  ground(at: Point2, heightMm?: number): Point3Mm | null;
  /** Bounding box of the scene, millimetres. */
  bounds(): { min: Point3Mm; max: Point3Mm };
  /** Whether a viewer position is on the section's outline on screen (within a finger's width). */
  onSectionLine(at: Point2): boolean;
  overlay(): ToolOverlay;
  setOverlay(partial: Partial<ToolOverlay>): void;
  /** Shows a passing message for a few seconds. */
  flash(message: string): void;
  /** Asks for a yes or no: nod or Enter answers yes, shake or Escape no. */
  confirm(question: string, answer: (yes: boolean) => void): void;
  /** Opens the agent panel ready for a request; returns why it cannot, or null. */
  askAgent(): string | null;
}

/**
 * A tool in the palette. Tools are plain objects, registered in the tool registry, so the Rhino connector and
 * plugins can add their own.
 */
export interface Tool {
  id: string;
  label: string;
  /** SVG path data for a 24 x 24 stroked icon. */
  icon: string;
  /** A single key, lowercase. */
  shortcut: string;
  /** Instant tools (undo, redo, ask agent) run once and leave the previous tool active. */
  instant?: boolean;
  run?(ctx: ToolContext): void;
  activate?(ctx: ToolContext): void;
  deactivate?(ctx: ToolContext): void;
  onTap?(ctx: ToolContext, at: Point2, hit: Hit | null): void;
  /** The pointer moved (hand or mouse), for hover feedback. */
  onHover?(ctx: ToolContext, at: Point2): void;
  /** Return true to take the drag; otherwise it orbits the view. */
  onDragStart?(ctx: ToolContext, at: Point2, hit: Hit | null): boolean;
  onDrag?(ctx: ToolContext, at: Point2, delta: Point2): void;
  onDragEnd?(ctx: ToolContext, at: Point2): void;
  /** The drag was taken over (the palette opened) or the user disengaged: undo any preview, commit nothing. */
  onDragCancel?(ctx: ToolContext): void;
}

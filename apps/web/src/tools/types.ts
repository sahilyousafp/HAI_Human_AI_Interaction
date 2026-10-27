import type {
  DrawingAids,
  Element,
  FeatureId,
  Point2,
  Point3Mm,
  SceneDocument,
  SceneOp,
} from "@hai/protocol";
import type { Resolved, SnapKind } from "@hai/scene";
import type { ReferenceLayer } from "./reference-layer.ts";

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
  /** Create tools and Move: the point a drawing aid snapped to, with the aid's name; shown as a marker. */
  snap: { point: Point3Mm; kind: SnapKind; label: string; ortho: boolean } | null;
}

export const EMPTY_OVERLAY: ToolOverlay = {
  notice: null,
  measure: [],
  sectionMm: null,
  movePreview: null,
  marked: null,
  sectionHover: false,
  draft: null,
  snap: null,
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
  /** Which drawing aids are on (Settings > Drawing aids). */
  aids(): DrawingAids;
  /**
   * Where the point under a viewer position lands once the drawing aids that are on have had their say (see
   * `resolvePoint`): a point in 3D, at the height it snapped to, or on the horizontal plane at the anchor's height.
   * `anchor` is where the line or the move began, for Ortho and Perpendicular; `exclude` lists elements that must not
   * be snapped to (the ones being moved); `probe` stands in for the pointer (a moved element's reference point), its
   * place on screen matching candidates and its plan position being the free point. Null when the view points away
   * from the ground and nothing snapped. The snapped point is shown as a marker until `clearSnap` or the next call.
   */
  resolve(
    at: Point2,
    options?: { anchor?: Point3Mm | null; exclude?: string[]; probe?: Point3Mm },
  ): Resolved | null;
  /** Removes the snap marker. */
  clearSnap(): void;
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
  /** The sketches and markers the user pointed out for the agent (not part of the model). */
  references: ReferenceLayer;
  /** Where a model point appears on screen, px, or null when it is behind the camera or the view is unknown. */
  toScreen(point: Point3Mm): [number, number] | null;
  /** A viewer position on screen, px. */
  toPixels(at: Point2): [number, number];
  /** The hand that made the current tap, hover or drag, or null for the mouse. */
  hand(): "Left" | "Right" | null;
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
  /**
   * What can be said to pick the tool without the agent, lower case; the first is shown in its ring slot. Without
   * it the tool is picked by its label.
   */
  spoken?: string[];
  /** Instant tools (undo, redo, ask agent) run once and leave the previous tool active. */
  instant?: boolean;
  /** The feature that switches this tool on and off (Settings > Features); without one it is always available. */
  feature?: FeatureId;
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
  /** Escape or a shake with nothing else pending: return true to have handled it, else it goes back to Select. */
  onCancel?(ctx: ToolContext): boolean;
}

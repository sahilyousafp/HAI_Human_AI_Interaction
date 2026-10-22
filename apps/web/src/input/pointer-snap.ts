import type { Point2 } from "@hai/protocol";

/** A hand pointer within this distance (px) of a control's edge snaps to it. */
export const SNAP_CAPTURE_PX = 28;
/** A snapped pointer stays on its control until the hand is this far (px) from it. */
export const SNAP_RELEASE_PX = 44;
/** A nearer control must beat the snapped one by this much (px) to take over, so neighbours do not flicker. */
export const SNAP_SWITCH_PX = 8;
/** A pinch that began on a control keeps it this long (ms) after the fingers open, so the tap that follows finds it. */
export const SNAP_LATCH_MS = 250;
/** A control up to this size (px) across pulls the pointer to its centre; a larger one only holds it inside. */
export const SNAP_CENTRE_MAX_PX = 48;

/** A control's rectangle on screen, px. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SnapControl<T> {
  key: T;
  rect: Rect;
}

/** The distance from a point to a rectangle, px; zero inside it. */
export function distanceToRect([x, y]: Point2, rect: Rect): number {
  const dx = Math.max(rect.left - x, 0, x - rect.right);
  const dy = Math.max(rect.top - y, 0, y - rect.bottom);
  return Math.hypot(dx, dy);
}

/** Where a snapped pointer is drawn: the centre of a small control, else the pointer itself kept inside it. */
export function snappedPoint([x, y]: Point2, rect: Rect): Point2 {
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  if (width <= SNAP_CENTRE_MAX_PX && height <= SNAP_CENTRE_MAX_PX) {
    return [(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2];
  }
  return [Math.min(rect.right, Math.max(rect.left, x)), Math.min(rect.bottom, Math.max(rect.top, y))];
}

/**
 * The nearest control within `reach` px of a point, closest first. `usable` lets the caller refuse a control that
 * is not really under the pointer (hidden behind a panel) without measuring every control.
 */
export function nearestControl<T>(
  point: Point2,
  controls: ReadonlyArray<SnapControl<T>>,
  reach: number,
  usable: (control: SnapControl<T>) => boolean = () => true,
): { control: SnapControl<T>; distance: number } | null {
  const near = controls
    .map((control) => ({ control, distance: distanceToRect(point, control.rect) }))
    .filter((c) => c.distance <= reach)
    .sort((a, b) => a.distance - b.distance);
  return near.find((c) => usable(c.control)) ?? null;
}

/** What one hand is snapped to, and until when a pinch that began there keeps it. */
export interface HandSnap<T> {
  target: SnapControl<T> | null;
  /** Timestamp (ms) until which the target is held after a pinch; 0 when none. */
  latchUntil: number;
}

export const NO_SNAP: HandSnap<never> = { target: null, latchUntil: 0 };

export interface SnapInput<T> {
  /** The hand's pointer, px on screen. */
  point: Point2;
  /** Now, ms. */
  now: number;
  controls: ReadonlyArray<SnapControl<T>>;
  /** Whether snapping is on and the hand is engaged. */
  enabled: boolean;
  /** The fingers are closing into a pinch (or closed): the target is held, and nothing new is taken. */
  closing: boolean;
  /** A ring is open: it owns the hand. */
  ringOpen: boolean;
  usable?: (control: SnapControl<T>) => boolean;
}

/**
 * One hand's snap, one frame on. The pointer snaps to the nearest control within 28 px and lets go beyond 44 px
 * (the gap keeps it from flickering). While the fingers close, the target is held however far the hand drifts, and
 * a quarter second beyond the pinch so the tap that ends it finds the same control; a pinch that began away from any
 * control takes none, so a drag on the model is never captured on the way past a button.
 */
export function stepHandSnap<T>(prev: HandSnap<T>, input: SnapInput<T>): HandSnap<T> {
  const { point, now, controls, enabled, closing, ringOpen } = input;
  if (!enabled || ringOpen) return NO_SNAP;
  // The control may have been redrawn or removed since the last frame: look it up again by its key.
  const held = prev.target ? (controls.find((c) => c.key === prev.target?.key) ?? null) : null;
  if (closing) return held ? { target: held, latchUntil: now + SNAP_LATCH_MS } : NO_SNAP;
  if (held && now < prev.latchUntil) return { target: held, latchUntil: prev.latchUntil };

  const nearest = nearestControl(point, controls, SNAP_CAPTURE_PX, input.usable);
  if (held) {
    const heldDistance = distanceToRect(point, held.rect);
    if (heldDistance <= SNAP_RELEASE_PX) {
      const beaten =
        nearest && nearest.control.key !== held.key && nearest.distance + SNAP_SWITCH_PX < heldDistance;
      return beaten ? { target: nearest.control, latchUntil: 0 } : { target: held, latchUntil: 0 };
    }
  }
  return nearest ? { target: nearest.control, latchUntil: 0 } : NO_SNAP;
}

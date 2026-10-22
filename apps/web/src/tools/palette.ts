import type { Point2 } from "@hai/protocol";

/** A flat ring of 8 slots keeps every direction memorable (marking menu); slot 0 is up, then clockwise. */
export const SLOT_COUNT = 8;
export const SLOT_NAMES = [
  "Top",
  "Top right",
  "Right",
  "Bottom right",
  "Bottom",
  "Bottom left",
  "Left",
  "Top left",
];
/** The centre of the ring, as a share of the width of the space the palette was opened in: release here cancels. */
export const DEAD_ZONE = 0.04;

/**
 * Where a palette is open, in the coordinates of whatever opened it: the camera frame for a hand (0..1 both axes,
 * mirrored like the preview), the viewer for the mouse. `aspect` is that space's width / height, so distances and
 * angles are measured in widths on both axes.
 */
export interface PaletteSpace {
  center: Point2;
  aspect: number;
}

export interface PaletteState extends PaletteSpace {
  /** Slot under the pointer, or null inside the dead zone. */
  highlighted: number | null;
}

/**
 * The slot in the direction of `point` from the centre, once beyond the dead zone: round(angle / 45 deg) mod 8,
 * with the angle measured clockwise from straight up.
 */
export function slotAt(space: PaletteSpace, point: Point2): number | null {
  const dx = point[0] - space.center[0];
  const dy = (point[1] - space.center[1]) / space.aspect;
  if (Math.hypot(dx, dy) <= DEAD_ZONE) return null;
  const degrees = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return ((Math.round(degrees / (360 / SLOT_COUNT)) % SLOT_COUNT) + SLOT_COUNT) % SLOT_COUNT;
}

/** closed -> open (centre) -> highlighting (slot) -> closed by release (choose) or cancel. */
export class PaletteMachine {
  private current: PaletteState | null = null;

  get state(): PaletteState | null {
    return this.current;
  }

  get isOpen(): boolean {
    return this.current !== null;
  }

  open(space: PaletteSpace): void {
    this.current = { ...space, highlighted: null };
  }

  steer(point: Point2): void {
    if (this.current) this.current = { ...this.current, highlighted: slotAt(this.current, point) };
  }

  /** Closes the palette; returns the chosen slot, or null when released in the centre. */
  release(): number | null {
    const slot = this.current?.highlighted ?? null;
    this.current = null;
    return slot;
  }

  cancel(): void {
    this.current = null;
  }
}

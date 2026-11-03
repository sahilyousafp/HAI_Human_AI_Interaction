/** A box on screen, px. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** How far above the point it is pinned to a panel floats, px. */
const FLOAT_PX = 18;
/** How far a panel keeps from the edge of the view and from other panels, px. */
const MARGIN_PX = 8;

const overlaps = (a: Box, b: Box): boolean =>
  a.left < b.left + b.width &&
  b.left < a.left + a.width &&
  a.top < b.top + b.height &&
  b.top < a.top + a.height;

/**
 * Where a panel pinned to a point goes: centred above the point when that is free, else the nearest place inside the
 * view that covers no other panel. If nowhere is free it stays inside the view, as near the point as it can.
 */
export function placePanel(
  anchor: readonly [number, number],
  size: { width: number; height: number },
  view: { width: number; height: number },
  obstacles: readonly Box[],
): { left: number; top: number } {
  const clampX = (x: number) => Math.max(MARGIN_PX, Math.min(view.width - size.width - MARGIN_PX, x));
  const clampY = (y: number) => Math.max(MARGIN_PX, Math.min(view.height - size.height - MARGIN_PX, y));
  const ideal = {
    left: clampX(anchor[0] - size.width / 2),
    top: clampY(anchor[1] - size.height - FLOAT_PX),
  };
  const free = (left: number, top: number) =>
    !obstacles.some((box) => overlaps({ left, top, width: size.width, height: size.height }, box));
  if (free(ideal.left, ideal.top)) return ideal;

  // Beside any panel is a place to try: each edge of each panel, at the ideal place along the other axis or the corner.
  const lefts = [ideal.left];
  const tops = [ideal.top];
  for (const box of obstacles) {
    lefts.push(clampX(box.left - size.width - MARGIN_PX), clampX(box.left + box.width + MARGIN_PX));
    tops.push(clampY(box.top - size.height - MARGIN_PX), clampY(box.top + box.height + MARGIN_PX));
  }
  let best: { left: number; top: number } | null = null;
  let nearest = Number.POSITIVE_INFINITY;
  for (const left of lefts) {
    for (const top of tops) {
      if (!free(left, top)) continue;
      const distance = Math.hypot(left - ideal.left, top - ideal.top);
      if (distance < nearest) {
        nearest = distance;
        best = { left, top };
      }
    }
  }
  return best ?? ideal;
}

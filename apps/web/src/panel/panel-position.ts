/** The gap kept between a panel and the window's edge. */
const EDGE = 8;
/** The space a panel's header and footer take around its frame, for keeping it in the window. */
const CHROME_HEIGHT = 112;

/** A position inside the window for a panel of this size. */
export function clampToWindow(
  at: { x: number; y: number },
  size: { width: number; height: number },
  windowSize: { width: number; height: number },
): { x: number; y: number } {
  const maxX = Math.max(EDGE, windowSize.width - size.width - EDGE);
  const maxY = Math.max(EDGE, windowSize.height - size.height - CHROME_HEIGHT - EDGE);
  return { x: Math.min(maxX, Math.max(EDGE, at.x)), y: Math.min(maxY, Math.max(EDGE, at.y)) };
}

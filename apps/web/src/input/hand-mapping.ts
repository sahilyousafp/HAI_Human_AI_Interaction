import type { Point2 } from "@aex/protocol";

/** Hands rarely reach the frame edges comfortably, so the pointer amplifies motion around the centre. */
export const POINTER_GAIN = 1.3;

/** Where a hand points across the workspace (0..1, y down) from its pinch point in camera-frame coordinates. */
export function handToWorkspace([x, y]: Point2): Point2 {
  const map = (v: number) => Math.min(1, Math.max(0, 0.5 + (v - 0.5) * POINTER_GAIN));
  return [map(x), map(y)];
}

/**
 * The space hand pointers span: the whole window, so the hands reach everything the mouse does, from the toolbar's
 * settings button to the camera view and the settings sheet.
 */
export function pointerSpace(): DOMRect {
  return new DOMRect(0, 0, innerWidth, innerHeight);
}

/** Where a hand's pointer is on screen, px. */
export function handClient(hand: Point2, ws: DOMRect): Point2 {
  const [u, v] = handToWorkspace(hand);
  return [ws.left + u * ws.width, ws.top + v * ws.height];
}

/** A hand's pointer as a viewer position (0..1 across the viewer; beyond it outside the model) and on screen (px). */
export function handPointer(wrapper: HTMLElement | null, hand: Point2): { at: Point2; client: Point2 } {
  const ws = pointerSpace();
  const viewer = wrapper?.getBoundingClientRect();
  if (!viewer || viewer.width === 0 || viewer.height === 0) {
    return { at: handToWorkspace(hand), client: [0, 0] };
  }
  const client = handClient(hand, ws);
  return { at: [(client[0] - viewer.left) / viewer.width, (client[1] - viewer.top) / viewer.height], client };
}

/** The pinch point (camera frame) whose pointer lands on a viewer position: `handPointer` inverted. */
export function viewerToHand(wrapper: HTMLElement | null, [x, y]: Point2): Point2 {
  const ws = pointerSpace();
  const viewer = wrapper?.getBoundingClientRect();
  if (!viewer) return [x, y];
  const u = (viewer.left + x * viewer.width - ws.left) / ws.width;
  const v = (viewer.top + y * viewer.height - ws.top) / ws.height;
  return [0.5 + (u - 0.5) / POINTER_GAIN, 0.5 + (v - 0.5) / POINTER_GAIN];
}

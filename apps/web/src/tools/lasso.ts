import type { Point2 } from "@hai/protocol";
import { elementBounds } from "@hai/scene";
import type { Tool, ToolContext } from "./types.ts";

/** A point joins the loop once the hand has moved this far from the last one, in viewer widths. */
const STEP = 0.004;
/** A loop smaller than this share of the view is a slip, not a selection. */
const MIN_AREA = 0.0005;

/** The area inside a loop, in viewer units squared (shoelace). */
export function loopArea(loop: Point2[]): number {
  let twice = 0;
  loop.forEach(([x0, y0], i) => {
    const [x1, y1] = loop[(i + 1) % loop.length] as Point2;
    twice += x0 * y1 - x1 * y0;
  });
  return Math.abs(twice) / 2;
}

/** Whether a point is inside a loop (ray casting). */
export function insideLoop([x, y]: Point2, loop: Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, yi] = loop[i] as Point2;
    const [xj, yj] = loop[j] as Point2;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The elements whose middle is inside the loop as drawn on screen: the middle of an element's box, where the view
 * shows it. Hidden elements and those the section has cut away are left out, as a click would miss them.
 */
export function idsInsideLoop(ctx: ToolContext, loop: Point2[]): string[] {
  const doc = ctx.doc();
  if (!doc) return [];
  const pixels = loop.map((point) => ctx.toPixels(point));
  const hidden = ctx.hidden();
  const cut = ctx.overlay().sectionMm;
  const ids: string[] = [];
  for (const element of Object.values(doc.elements)) {
    if (hidden.has(element.id)) continue;
    const { min, max } = elementBounds(element, doc.levels);
    if (cut !== null && min[2] >= cut) continue;
    const onScreen = ctx.toScreen([(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]);
    if (onScreen && insideLoop(onScreen, pixels)) ids.push(element.id);
  }
  return ids.sort();
}

/**
 * Lasso select: pinch and drag a loop around what to select. On release the loop closes, what is inside it is
 * selected, and the tool turns itself off (back to Select). A loop too small to mean anything keeps the tool, with a
 * message, so the next try needs no new pick.
 */
export function lassoTool(): Tool {
  let loop: Point2[] | null = null;
  return {
    id: "lasso",
    label: "Lasso select",
    spoken: ["lasso", "lasso select"],
    icon: "M12 5c4.4 0 8 1.8 8 4s-3.6 4-8 4-8-1.8-8-4 3.6-4 8-4zM9 13c-.2 2-.8 3.5-2.5 5",
    shortcut: "g",
    activate(ctx) {
      ctx.setOverlay({ notice: "Pinch and drag a loop around what to select." });
    },
    deactivate(ctx) {
      loop = null;
      ctx.setOverlay({ notice: null, lasso: null });
    },
    onDragStart(ctx, at) {
      loop = [at];
      ctx.setOverlay({ lasso: loop });
      return true;
    },
    onDrag(ctx, at) {
      const last = loop?.at(-1);
      if (!loop || (last && Math.hypot(at[0] - last[0], at[1] - last[1]) < STEP)) return;
      loop = [...loop, at];
      ctx.setOverlay({ lasso: loop });
    },
    onDragEnd(ctx, at) {
      const drawn = loop ? [...loop, at] : null;
      loop = null;
      ctx.setOverlay({ lasso: null });
      if (!drawn || drawn.length < 3 || loopArea(drawn) < MIN_AREA) {
        ctx.flash("Draw a loop around what to select.");
        return;
      }
      const ids = idsInsideLoop(ctx, drawn);
      ctx.select(ids);
      ctx.flash(ids.length === 0 ? "Nothing inside the loop." : `${ids.length} selected.`);
      ctx.choose("select");
    },
    onDragCancel(ctx) {
      loop = null;
      ctx.setOverlay({ lasso: null });
    },
  };
}
